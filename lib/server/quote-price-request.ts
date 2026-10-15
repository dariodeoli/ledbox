import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { RESPONDABLE_STATUSES, isQuoteRequestStatus } from "@/lib/catalog-public";
import {
  PRICE_REQUESTS_PER_ORDER,
  PRICE_REQUEST_ORDER_STATUSES,
  isPriceRequestStatus,
  parsePriceRequest,
  parsePriceResponse,
  type PriceRequestInput,
  type PriceRequestStatus,
} from "@/lib/price-request";
import type { MailActor } from "./mail";
import { portalAuditContext, recordAudit } from "./audit";
import { db } from "./db";
import type { AdminContext } from "./tenancy";

/**
 * «Pedir un mejor precio» dentro de un pedido del catálogo.
 *
 * - El cliente pide desde el carrito (al enviar el pedido) o desde el seguimiento (`/pedido/<token>`),
 *   con un comentario y, si quiere, el monto que querría pagar. **El monto nunca se aplica solo**: es
 *   un dato para la empresa.
 * - La empresa responde desde el panel: **aceptar** (toma el monto pedido), **contraofertar** (su
 *   propio monto) o **rechazar** (con motivo). Aceptar o contraofertar deja el pedido en «Propuesta
 *   enviada» —el mismo flujo de la respuesta al pedido— y **el cliente aprueba la versión final**
 *   desde su seguimiento (`respondToProposal`). Todo se scopea a la empresa activa: un pedido o una
 *   solicitud de otra empresa responde 404.
 * - El monto acordado queda en la solicitud; no cambia las líneas del pedido ni la conversión a
 *   presupuesto (el equipo aplica el descuento al armar el presupuesto).
 */

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;

export type PriceRequestView = {
  id: string;
  status: PriceRequestStatus;
  comment: string;
  desiredAmount: number | null;
  originalTotal: number | null;
  offeredAmount: number | null;
  responseNote: string | null;
  createdAt: string;
  respondedAt: string | null;
  clientApprovedAt: string | null;
};

type Row = {
  id: string;
  status: string;
  comment: string;
  desiredAmount: number | null;
  originalTotal: number | null;
  offeredAmount: number | null;
  responseNote: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  clientApprovedAt: Date | null;
};

export const PRICE_REQUEST_SELECT = {
  id: true,
  status: true,
  comment: true,
  desiredAmount: true,
  originalTotal: true,
  offeredAmount: true,
  responseNote: true,
  createdAt: true,
  respondedAt: true,
  clientApprovedAt: true,
} as const;

export function priceRequestView(row: Row): PriceRequestView {
  return {
    id: row.id,
    status: isPriceRequestStatus(row.status) ? row.status : "OPEN",
    comment: row.comment,
    desiredAmount: row.desiredAmount,
    originalTotal: row.originalTotal,
    offeredAmount: row.offeredAmount,
    responseNote: row.responseNote,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    clientApprovedAt: row.clientApprovedAt?.toISOString() ?? null,
  };
}

export type PriceFailure = { ok: false; status: number; error: string };

/** Alta dentro de la transacción del pedido (al enviar el carrito con «Pedir un mejor precio»). */
export async function createPriceRequestInTx(
  tx: Pick<Prisma.TransactionClient, "quotePriceRequest">,
  target: { organizationId: string; quoteRequestId: string; originalTotal: number | null },
  input: PriceRequestInput,
): Promise<void> {
  await tx.quotePriceRequest.create({
    data: { id: randomUUID(), organizationId: target.organizationId, quoteRequestId: target.quoteRequestId, comment: input.comment, desiredAmount: input.desiredAmount, originalTotal: target.originalTotal },
  });
}

/** Cliente: pide un mejor precio desde el seguimiento de su pedido. Una abierta a la vez y hasta 3 por pedido. */
export async function requestBetterPrice(token: string, body: unknown): Promise<PriceFailure | { ok: true; request: PriceRequestView }> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, status: 404, error: "Pedido no encontrado." };
  const quote = await db.quoteRequest.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, organizationId: true, referenceTotal: true, leadId: true, lead: { select: { name: true, email: true } }, budget: { select: { id: true } } },
  });
  if (!quote?.organizationId) return { ok: false, status: 404, error: "Pedido no encontrado." };
  const organizationId = quote.organizationId;
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true } });
  if (organization?.isDemo) return { ok: false, status: 403, error: "Esta es una demo: el pedido de precio no se guarda." };
  if (quote.budget || !(PRICE_REQUEST_ORDER_STATUSES as readonly string[]).includes(quote.status)) {
    return { ok: false, status: 409, error: "Este pedido ya no admite pedir un mejor precio. Escribinos por WhatsApp." };
  }
  const parsed = parsePriceRequest(body, { total: quote.referenceTotal });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuoteRequest" WHERE "id" = ${quote.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const existing = await tx.quotePriceRequest.findMany({ where: { quoteRequestId: quote.id, organizationId }, select: { status: true } });
    if (existing.some((row) => row.status === "OPEN")) return { ok: false as const, status: 409, error: "Ya tenés un pedido de precio esperando respuesta." };
    if (existing.length >= PRICE_REQUESTS_PER_ORDER) return { ok: false as const, status: 409, error: "Ya hiciste varios pedidos de precio en este pedido. Escribinos por WhatsApp para seguir hablando." };
    const row = await tx.quotePriceRequest.create({
      data: { id: randomUUID(), organizationId, quoteRequestId: quote.id, comment: parsed.value.comment, desiredAmount: parsed.value.desiredAmount, originalTotal: quote.referenceTotal },
      select: PRICE_REQUEST_SELECT,
    });
    return { ok: true as const, row };
  });
  if (!outcome.ok) return outcome;

  await recordAudit({
    context: portalAuditContext(organizationId, quote.lead?.name ?? "", quote.lead?.email),
    action: "create",
    entity: "Lead",
    entityId: quote.leadId ?? quote.id,
    summary: "El cliente pidió un mejor precio en su pedido del catálogo",
    detail: { fields: { monto: parsed.value.desiredAmount, comentario: parsed.value.comment } },
  });
  return { ok: true, request: priceRequestView(outcome.row) };
}

class PriceConflict extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Empresa: acepta, contraoferta o rechaza el pedido de precio. */
export async function respondToPriceRequest(
  context: AdminContext,
  quoteRequestId: string,
  requestId: string,
  body: unknown,
  actor: MailActor,
): Promise<PriceFailure | { ok: true; request: PriceRequestView; quoteStatus: string; mail: { status: "sent" | "failed" | "skipped"; error?: string } }> {
  const { organizationId } = context;
  const quote = await db.quoteRequest.findFirst({
    where: { id: quoteRequestId, organizationId },
    select: { id: true, status: true, referenceTotal: true, publicToken: true, startsAt: true, endsAt: true, leadId: true, lead: { select: { name: true, email: true } }, budget: { select: { id: true } } },
  });
  if (!quote) return { ok: false, status: 404, error: "El pedido no existe en esta empresa." };
  const request = await db.quotePriceRequest.findFirst({ where: { id: requestId, quoteRequestId: quote.id, organizationId }, select: PRICE_REQUEST_SELECT });
  if (!request) return { ok: false, status: 404, error: "El pedido de precio no existe en esta empresa." };
  if (request.status !== "OPEN") return { ok: false, status: 409, error: "Este pedido de precio ya fue respondido." };
  if (quote.budget || quote.status === "CONVERTED") return { ok: false, status: 409, error: "El pedido ya se convirtió en presupuesto: ajustá el precio desde el presupuesto." };
  if (!isQuoteRequestStatus(quote.status) || !RESPONDABLE_STATUSES.includes(quote.status)) return { ok: false, status: 409, error: "Este pedido está declinado o vencido." };

  const parsed = parsePriceResponse(body, { desiredAmount: request.desiredAmount, originalTotal: quote.referenceTotal });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { action, offeredAmount, note } = parsed.value;
  const status: PriceRequestStatus = action === "reject" ? "REJECTED" : action === "accept" ? "ACCEPTED" : "COUNTERED";
  const proposalNote = note ?? (offeredAmount ? `Precio acordado para tu pedido: ${money(offeredAmount)}.` : null);

  let row: Row;
  try {
    row = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "QuoteRequest" WHERE "id" = ${quote.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const fresh = await tx.quotePriceRequest.findFirst({ where: { id: request.id, organizationId }, select: { status: true } });
      if (!fresh || fresh.status !== "OPEN") throw new PriceConflict(409, "Este pedido de precio ya fue respondido.");
      const freshQuote = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, select: { status: true, budget: { select: { id: true } } } });
      if (freshQuote.budget || freshQuote.status === "CONVERTED") throw new PriceConflict(409, "El pedido ya se convirtió en presupuesto.");
      if (!isQuoteRequestStatus(freshQuote.status) || !RESPONDABLE_STATUSES.includes(freshQuote.status)) throw new PriceConflict(409, "Este pedido ya está cerrado.");
      const updated = await tx.quotePriceRequest.update({
        where: { id: request.id },
        data: { status, offeredAmount, responseNote: note, respondedAt: new Date(), respondedBy: actor.name ?? actor.email ?? null },
        select: PRICE_REQUEST_SELECT,
      });
      // Aceptar o contraofertar = el flujo de la propuesta: el cliente aprueba la versión final.
      if (action !== "reject") {
        await tx.quoteRequest.update({ where: { id: quote.id }, data: { status: "PROPOSED", proposedAt: new Date(), proposalNote, proposalApprovedAt: null } });
      }
      return updated;
    }, { timeout: 20_000 });
  } catch (error) {
    if (error instanceof PriceConflict) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  await recordAudit({
    context,
    action: "update",
    entity: "Lead",
    entityId: quote.leadId ?? quote.id,
    summary: action === "reject" ? "Rechazó el pedido de mejor precio de un pedido del catálogo" : action === "accept" ? "Aceptó el pedido de mejor precio y envió la propuesta" : "Contraofertó el precio de un pedido del catálogo",
    detail: { fields: { accion: action, montoPedido: request.desiredAmount, montoOfrecido: offeredAmount, totalAntes: quote.referenceTotal, nota: note } },
  });

  // Sin correo automático: el envío de correos tiene un inventario revisado aparte. El cliente ve la respuesta
  // en su seguimiento y la pantalla de la empresa le recuerda compartirle el link de su pedido.
  const mail: { status: "sent" | "failed" | "skipped"; error?: string } = { status: "skipped", error: "El aviso al cliente va por su link de seguimiento." };
  return { ok: true, request: priceRequestView(row), quoteStatus: action === "reject" ? quote.status : "PROPOSED", mail };
}

/** El cliente aprobó la propuesta: la oferta de precio vigente queda aprobada por él. */
export async function markPriceOfferApproved(quoteRequestId: string, organizationId: string): Promise<void> {
  await db.quotePriceRequest.updateMany({
    where: { quoteRequestId, organizationId, status: { in: ["ACCEPTED", "COUNTERED"] }, clientApprovedAt: null },
    data: { clientApprovedAt: new Date() },
  });
}

/** Pedidos de precio de un pedido, para el seguimiento público (más nuevo primero). */
export async function loadPriceRequests(quoteRequestId: string, organizationId: string): Promise<PriceRequestView[]> {
  const rows = await db.quotePriceRequest.findMany({ where: { quoteRequestId, organizationId }, orderBy: { createdAt: "desc" }, select: PRICE_REQUEST_SELECT });
  return rows.map(priceRequestView);
}

