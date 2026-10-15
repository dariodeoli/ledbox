import { Prisma } from "@prisma/client";
import { catalogAudienceWhere, type PriceList } from "@/lib/catalog-audience";
import {
  RESPONDABLE_STATUSES,
  isQuoteItemState,
  isQuoteRequestStatus,
  quoteItemActive,
  rentalDaysBetween,
  type QuoteItemState,
} from "@/lib/catalog-public";
import { publicConfig } from "@/lib/public-config";
import { deliveryFee, orderPieces } from "@/lib/delivery-zones";
import { portalAuditContext, recordAudit } from "./audit";
import { db } from "./db";
import {
  MAINTENANCE_UNITS_SELECT,
  availabilityForRange,
  findSubstitutes,
  isComboItem,
  maintenanceUnits,
  resolveRentalBuffers,
  loadRentalSettings,
  type InventorySubstitute,
} from "./inventory-availability";
import { catalogLineAmounts, loadPricedItems } from "./line-pricing";
import { markPriceOfferApproved } from "./quote-price-request";
import { sendMail, type MailActor } from "./mail";
import { buildOrderProposalMail, buildOrderRejectedMail } from "./mail/catalog";
import { mailBrandFor } from "./mail/org-brand";
import { dayKeyOf } from "./notifications";
import type { AdminContext } from "./tenancy";

/**
 * Respuesta de la empresa a un pedido del catálogo, desde el panel:
 *
 * - **Rechazar con motivo** (`rejectQuoteRequest`): el pedido pasa a «Declinado», el motivo queda
 *   en el pedido y el cliente lo ve en su seguimiento (`/pedido/<token>`) y por correo.
 * - **Modificar antes de aceptar** (`modifyQuoteRequest`): cambiar cantidades, quitar una línea,
 *   marcar «ya no lo tengo disponible» o sustituir un producto por otro (los candidatos salen de
 *   `findSubstitutes`, la misma lógica de la reserva). El pedido pasa a «Propuesta enviada» y el
 *   cliente la aprueba o rechaza desde su seguimiento. **Nunca se propone más de lo que hay**: cada
 *   línea se verifica contra la disponibilidad real del período (con los tiempos y retenciones del
 *   motor); lo que no alcanza responde 409 con la lista de faltantes.
 * - **Aceptar** no se duplica: sigue siendo `convertQuoteRequest` (+ retención con el candado del
 *   motor). La conversión ignora las líneas quitadas o no disponibles y exige que el cliente haya
 *   aprobado una propuesta pendiente.
 *
 * Todo se scopea a la empresa activa: un pedido de otra empresa responde 404.
 */

export const REJECT_REASON_MIN = 3;
export const REJECT_REASON_MAX = 500;
export const PROPOSAL_NOTE_MAX = 500;
export const PORTAL_PROPOSAL_STOCK_MESSAGE = "Hay piezas sin disponibilidad para esas fechas; el equipo te contacta con otra propuesta.";

export type ResponseFailure = { ok: false; status: number; error: string };

const origin = () => publicConfig.siteUrl;
const trackingUrl = (token: string | null) => (token ? `${origin()}/pedido/${token}` : origin());

/** Texto limpio del motivo; `null` si no cumple el mínimo. */
export function parseRejectReason(value: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (reason.length < REJECT_REASON_MIN) return { ok: false, error: "Contale al cliente el motivo del rechazo (al menos 3 caracteres): lo va a ver en su pedido." };
  if (reason.length > REJECT_REASON_MAX) return { ok: false, error: `El motivo no puede superar los ${REJECT_REASON_MAX} caracteres.` };
  return { ok: true, reason };
}

// ── Rechazar ─────────────────────────────────────────────────────────────────

export async function rejectQuoteRequest(
  context: AdminContext,
  quoteRequestId: string,
  rawReason: unknown,
  actor: MailActor,
): Promise<ResponseFailure | { ok: true; mail: { status: "sent" | "failed" | "skipped"; error?: string }; previousStatus: string }> {
  const parsed = parseRejectReason(rawReason);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { organizationId } = context;

  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuoteRequest" WHERE "id" = ${quoteRequestId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const found = await tx.quoteRequest.findFirst({
      where: { id: quoteRequestId, organizationId },
      select: { id: true, status: true, publicToken: true, leadId: true, budget: { select: { id: true } }, lead: { select: { name: true, email: true } } },
    });
    if (!found) return { ok: false as const, status: 404, error: "El pedido no existe en esta empresa." };
    if (found.budget || found.status === "CONVERTED") return { ok: false as const, status: 409, error: "El pedido ya se convirtió en presupuesto: rechazalo desde el presupuesto." };
    if (found.status === "DECLINED" || found.status === "EXPIRED") return { ok: false as const, status: 409, error: "Este pedido ya está cerrado." };
    await tx.quoteRequest.update({
      where: { id: found.id },
      data: { status: "DECLINED", declineReason: parsed.reason, declinedAt: new Date(), declinedBy: "COMPANY" },
    });
    return { ok: true as const, quote: found };
  });
  if (!outcome.ok) return outcome;
  const quote = outcome.quote;

  await recordAudit({
    context,
    action: "status",
    entity: "Lead",
    entityId: quote.leadId ?? quote.id,
    summary: "Rechazó un pedido del catálogo con motivo",
    detail: { changes: { quoteRequestStatus: { from: quote.status, to: "DECLINED" } }, fields: { reason: parsed.reason } },
  });

  let mail: { status: "sent" | "failed" | "skipped"; error?: string } = { status: "skipped", error: "El pedido no tiene un correo de contacto." };
  if (quote.lead?.email) {
    const content = buildOrderRejectedMail({
      organizationName: context.organization.name,
      name: quote.lead.name,
      reason: parsed.reason,
      trackingUrl: trackingUrl(quote.publicToken),
      brand: await mailBrandFor(organizationId),
    });
    const sent = await sendMail({
      to: quote.lead.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      category: "catalog",
      organizationId,
      entity: "QuoteRequest",
      entityId: quote.id,
      actor,
    });
    mail = { status: sent.status, error: sent.error };
    if (sent.status === "failed") console.error("pedido: no se pudo enviar el correo del rechazo", { quoteRequestId: quote.id, error: sent.error });
  }
  return { ok: true, mail, previousStatus: quote.status };
}

// ── Modificar ────────────────────────────────────────────────────────────────

export const MODIFY_ACTIONS = ["keep", "quantity", "remove", "unavailable", "substitute"] as const;
export type ModifyAction = (typeof MODIFY_ACTIONS)[number];
export type ModifyLineInput = { itemId: string; action: ModifyAction; quantity?: number; substituteInventoryId?: string };

const MAX_QUANTITY = 99;

/** Valida el cuerpo del panel: líneas únicas, acciones cerradas y cantidades enteras de 1 a 99. */
export function parseModifyInput(body: unknown): { ok: true; lines: ModifyLineInput[]; note: string | null } | { ok: false; error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!Array.isArray(record.lines) || record.lines.length === 0 || record.lines.length > 60) return { ok: false, error: "Indicá qué hacer con las líneas del pedido." };
  const seen = new Set<string>();
  const lines: ModifyLineInput[] = [];
  for (const raw of record.lines) {
    const line = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const itemId = typeof line.itemId === "string" ? line.itemId.trim() : "";
    if (!itemId || itemId.length > 64 || seen.has(itemId)) return { ok: false, error: "Hay una línea repetida o sin identificar." };
    seen.add(itemId);
    const action = line.action;
    if (typeof action !== "string" || !(MODIFY_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: "La acción de una línea no es válida." };
    const entry: ModifyLineInput = { itemId, action: action as ModifyAction };
    if (action === "quantity" || action === "substitute") {
      if (line.quantity !== undefined) {
        const quantity = line.quantity;
        if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
          return { ok: false, error: `La cantidad tiene que ser un entero de 1 a ${MAX_QUANTITY}.` };
        }
        entry.quantity = quantity;
      } else if (action === "quantity") {
        return { ok: false, error: "Indicá la nueva cantidad." };
      }
    }
    if (action === "substitute") {
      const substitute = typeof line.substituteInventoryId === "string" ? line.substituteInventoryId.trim() : "";
      if (!substitute || substitute.length > 64) return { ok: false, error: "Elegí el producto que reemplaza a la línea." };
      entry.substituteInventoryId = substitute;
    }
    lines.push(entry);
  }
  const note = typeof record.note === "string" ? record.note.trim().replace(/\s+/g, " ") : "";
  if (note.length > PROPOSAL_NOTE_MAX) return { ok: false, error: `La nota no puede superar los ${PROPOSAL_NOTE_MAX} caracteres.` };
  return { ok: true, lines, note: note || null };
}

type PlannedLine = {
  id: string;
  state: QuoteItemState;
  quantity: number;
  inventoryId: string | null;
  productName: string;
  productSlug: string;
  billingUnit: "DAILY" | "EVENT";
  unitPrice: number | null;
  subtotal: number | null;
  originalName: string | null;
  originalQuantity: number | null;
};

class ModifyConflict extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Faltantes reales de las líneas activas en el período del pedido (combos no se calculan acá). */
async function stockShortages(options: { organizationId: string; lines: ReadonlyArray<{ inventoryId: string | null; quantity: number }>; startsAt: Date; endsAt: Date }): Promise<string[]> {
  const totals = new Map<string, number>();
  for (const line of options.lines) if (line.inventoryId) totals.set(line.inventoryId, (totals.get(line.inventoryId) ?? 0) + line.quantity);
  if (totals.size === 0) return [];
  const rows = await db.inventoryItem.findMany({
    where: { organizationId: options.organizationId, id: { in: [...totals.keys()] } },
    omit: { imageData: true },
    include: { _count: { select: MAINTENANCE_UNITS_SELECT } },
  });
  const settings = await loadRentalSettings(options.organizationId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems: string[] = [];
  for (const [inventoryId, quantity] of totals) {
    const row = byId.get(inventoryId);
    if (!row) {
      problems.push("Un artículo del pedido ya no existe en el inventario");
      continue;
    }
    if (row.status === "MAINTENANCE" || row.status === "RETIRED") {
      problems.push(`«${row.name}» no está disponible para alquilar`);
      continue;
    }
    if (await isComboItem(db, options.organizationId, inventoryId)) continue;
    const availability = await availabilityForRange({
      organizationId: options.organizationId,
      item: { id: row.id, name: row.name, quantity: row.quantity, status: row.status, maintenance: maintenanceUnits(row), buffers: resolveRentalBuffers(settings, row) },
      startsAt: options.startsAt,
      endsAt: options.endsAt,
    });
    if (availability.blocked || quantity > availability.available) problems.push(`«${row.name}» (piden ${quantity}, hay ${Math.max(0, availability.available)})`);
  }
  return problems;
}

/** Sustitutos reales de una línea: misma categoría, con stock libre en el período y visibles en ese catálogo. */
export async function listQuoteItemSubstitutes(context: AdminContext, quoteRequestId: string, itemId: string): Promise<ResponseFailure | { ok: true; substitutes: InventorySubstitute[] }> {
  const { organizationId } = context;
  const quote = await db.quoteRequest.findFirst({
    where: { id: quoteRequestId, organizationId },
    select: { startsAt: true, endsAt: true, priceList: true, items: { where: { id: itemId }, select: { inventoryId: true } } },
  });
  if (!quote) return { ok: false, status: 404, error: "El pedido no existe en esta empresa." };
  const item = quote.items[0];
  if (!item) return { ok: false, status: 404, error: "La línea no existe en este pedido." };
  if (!item.inventoryId || !quote.startsAt || !quote.endsAt) return { ok: true, substitutes: [] };
  const inventory = await db.inventoryItem.findFirst({ where: { id: item.inventoryId, organizationId }, select: { id: true, category: true, status: true } });
  if (!inventory) return { ok: true, substitutes: [] };
  const all = await findSubstitutes({ organizationId, item: inventory, startsAt: quote.startsAt, endsAt: quote.endsAt, limit: 20 });
  const list: PriceList = quote.priceList === "WHOLESALE" ? "WHOLESALE" : "RETAIL";
  const visible = await db.inventoryItem.findMany({
    where: { organizationId, id: { in: all.map((entry) => entry.id) }, archivedAt: null, ...catalogAudienceWhere(list) },
    select: { id: true },
  });
  const ok = new Set(visible.map((row) => row.id));
  return { ok: true, substitutes: all.filter((entry) => ok.has(entry.id)) };
}

export async function modifyQuoteRequest(
  context: AdminContext,
  quoteRequestId: string,
  input: { lines: ModifyLineInput[]; note: string | null },
  actor: MailActor,
): Promise<
  | ResponseFailure
  | { ok: true; status: "PROPOSED"; total: number | null; changes: string[]; mail: { status: "sent" | "failed" | "skipped"; error?: string } }
> {
  const { organizationId } = context;
  const quote = await db.quoteRequest.findFirst({
    where: { id: quoteRequestId, organizationId },
    include: { items: { orderBy: { productName: "asc" } }, lead: { select: { name: true, email: true } }, budget: { select: { id: true } } },
  });
  if (!quote) return { ok: false, status: 404, error: "El pedido no existe en esta empresa." };
  if (quote.budget || quote.status === "CONVERTED") return { ok: false, status: 409, error: "El pedido ya se convirtió en presupuesto: modificalo desde el presupuesto." };
  if (!isQuoteRequestStatus(quote.status) || !RESPONDABLE_STATUSES.includes(quote.status)) return { ok: false, status: 409, error: "Este pedido está declinado o vencido: reabrilo antes de modificarlo." };
  if (!quote.startsAt || !quote.endsAt) return { ok: false, status: 422, error: "El pedido no tiene fechas: no se puede verificar el stock sin un período." };
  const startsAt = quote.startsAt;
  const endsAt = quote.endsAt;
  const days = rentalDaysBetween(dayKeyOf(startsAt), dayKeyOf(endsAt));
  const list: PriceList = quote.priceList === "WHOLESALE" ? "WHOLESALE" : "RETAIL";
  const settings = await db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { publicShowPrices: true } });
  const showPrices = settings?.publicShowPrices ?? true;

  const edits = new Map(input.lines.map((line) => [line.itemId, line]));
  for (const id of edits.keys()) if (!quote.items.some((item) => item.id === id)) return { ok: false, status: 404, error: "Una de las líneas no existe en este pedido." };

  // Sustitutos permitidos por línea: salen de la lógica de la reserva (misma categoría, con stock libre).
  const substituteRows = new Map<string, { id: string; name: string; sku: string | null; billingUnit: "DAILY" | "EVENT" }>();
  for (const edit of input.lines.filter((line) => line.action === "substitute")) {
    const allowed = await listQuoteItemSubstitutes(context, quote.id, edit.itemId);
    if (!allowed.ok) return allowed;
    if (!allowed.substitutes.some((entry) => entry.id === edit.substituteInventoryId)) {
      return { ok: false, status: 409, error: "Ese producto no es un reemplazo disponible para esas fechas (misma categoría, visible en este catálogo y con stock libre)." };
    }
    const row = await db.inventoryItem.findFirst({
      where: { id: edit.substituteInventoryId, organizationId },
      select: { id: true, name: true, sku: true, billingUnit: true },
    });
    if (!row) return { ok: false, status: 409, error: "El producto de reemplazo ya no existe." };
    substituteRows.set(edit.itemId, { ...row, billingUnit: row.billingUnit === "EVENT" ? "EVENT" : "DAILY" });
  }

  const changes: string[] = [];
  const planned: PlannedLine[] = quote.items.map((item) => {
    const edit = edits.get(item.id);
    const current = (isQuoteItemState(item.state) ? item.state : "KEEP") as QuoteItemState;
    const originalName = item.originalName ?? item.productName;
    const originalQuantity = item.originalQuantity ?? item.quantity;
    const base: PlannedLine = {
      id: item.id,
      state: current,
      quantity: item.quantity,
      inventoryId: item.inventoryId,
      productName: item.productName,
      productSlug: item.productSlug,
      billingUnit: item.billingUnit === "EVENT" ? "EVENT" : "DAILY",
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      originalName: item.originalName,
      originalQuantity: item.originalQuantity,
    };
    if (!edit || edit.action === "keep" || !quoteItemActive(current)) return base;
    const remember = { originalName, originalQuantity };
    if (edit.action === "remove") {
      changes.push(`Quitamos ${originalName}`);
      return { ...base, ...remember, state: "REMOVED", subtotal: 0 };
    }
    if (edit.action === "unavailable") {
      changes.push(`${originalName}: ya no está disponible`);
      return { ...base, ...remember, state: "UNAVAILABLE", subtotal: 0 };
    }
    if (edit.action === "quantity") {
      const quantity = edit.quantity ?? item.quantity;
      if (quantity === item.quantity) return base;
      changes.push(`${originalName}: ${originalQuantity} → ${quantity}`);
      // El importe se recalcula más abajo con la regla única de precio de línea.
      return { ...base, ...remember, state: current === "SUBSTITUTED" ? "SUBSTITUTED" : "CHANGED", quantity };
    }
    const substitute = substituteRows.get(item.id)!;
    const quantity = edit.quantity ?? item.quantity;
    changes.push(`${originalName} → ${substitute.name}${quantity !== originalQuantity ? ` (${quantity})` : ""}`);
    return {
      ...base,
      ...remember,
      state: "SUBSTITUTED",
      quantity,
      inventoryId: substitute.id,
      productName: substitute.name,
      productSlug: substitute.sku || substitute.id,
      billingUnit: substitute.billingUnit,
      // El precio del sustituto sale de su lista (escalones incluidos) más abajo; no hereda el del original.
      unitPrice: null,
      subtotal: null,
    };
  });

  // Precio de las líneas activas: MISMA función que la conversión (`catalogLineAmounts`), con los
  // escalones vigentes de la lista del pedido y los días del pedido. Así `referenceTotal` y el
  // subtotal de la propuesta coinciden al peso con el presupuesto que sale al convertir.
  const pricedItems = await loadPricedItems(organizationId, planned.flatMap((line) => (quoteItemActive(line.state) && line.inventoryId ? [line.inventoryId] : [])));
  if (showPrices) {
    for (const line of planned) {
      if (!quoteItemActive(line.state)) continue;
      const amounts = catalogLineAmounts(line.inventoryId ? pricedItems.get(line.inventoryId) : undefined, line.unitPrice, line.quantity, days, list);
      line.unitPrice = amounts.unitPrice > 0 ? amounts.unitPrice : null;
      line.subtotal = amounts.unitPrice > 0 ? amounts.subtotal : null;
    }
  }

  const active = planned.filter((line) => quoteItemActive(line.state));
  if (active.length === 0) return { ok: false, status: 422, error: "No queda ninguna línea en el pedido. Si no tenés nada de esto disponible, rechazalo con un motivo." };
  if (changes.length === 0 && quote.status === "PROPOSED") return { ok: false, status: 409, error: "No hay cambios respecto de la propuesta ya enviada." };

  // Stock real: nada se propone por encima de lo que hay en el período.
  const problems = await stockShortages({ organizationId, lines: active, startsAt, endsAt });
  if (problems.length > 0) return { ok: false, status: 409, error: `No alcanza el stock para esas fechas: ${problems.join(" · ")}.` };

  // Flete de la zona: igual que la conversión (línea aparte según las piezas); si la zona se borró, no se inventa.
  const zone = quote.deliveryZoneId
    ? await db.deliveryZone.findFirst({ where: { id: quote.deliveryZoneId, organizationId }, select: { basePrice: true, volumeThreshold: true, extraPrice: true, name: true } })
    : null;
  const fee = zone ? deliveryFee(zone, orderPieces(active.map((line) => ({ quantity: line.quantity, inventoryId: pricedItems.has(line.inventoryId ?? "") ? line.inventoryId : null })))) : 0;
  const total = showPrices && active.every((line) => line.subtotal !== null) ? active.reduce((sum, line) => sum + (line.subtotal ?? 0), 0) + fee : null;
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "QuoteRequest" WHERE "id" = ${quote.id} FOR UPDATE`;
      const fresh = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, select: { status: true, budget: { select: { id: true } } } });
      if (fresh.budget || fresh.status === "CONVERTED") throw new ModifyConflict(409, "El pedido ya se convirtió en presupuesto.");
      if (!isQuoteRequestStatus(fresh.status) || !RESPONDABLE_STATUSES.includes(fresh.status)) throw new ModifyConflict(409, "Este pedido ya está cerrado.");
      for (const line of planned) {
        await tx.quoteItem.update({
          where: { id: line.id },
          data: {
            state: line.state,
            quantity: line.quantity,
            inventoryId: line.inventoryId,
            productName: line.productName,
            productSlug: line.productSlug,
            billingUnit: line.billingUnit,
            unitPrice: line.unitPrice,
            subtotal: line.subtotal,
            originalName: line.originalName,
            originalQuantity: line.originalQuantity,
          },
        });
      }
      await tx.quoteRequest.update({
        where: { id: quote.id },
        data: { status: "PROPOSED", proposedAt: new Date(), proposalNote: input.note, proposalApprovedAt: null, referenceTotal: total },
      });
    }, { timeout: 20_000 });
  } catch (error) {
    if (error instanceof ModifyConflict) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  await recordAudit({
    context,
    action: "update",
    entity: "Lead",
    entityId: quote.leadId ?? quote.id,
    summary: "Modificó un pedido del catálogo y envió la propuesta al cliente",
    detail: { changes: { quoteRequestStatus: { from: quote.status, to: "PROPOSED" } }, fields: { cambios: changes, nota: input.note, total } },
  });

  let mail: { status: "sent" | "failed" | "skipped"; error?: string } = { status: "skipped", error: "El pedido no tiene un correo de contacto." };
  if (quote.lead?.email) {
    const content = buildOrderProposalMail({
      organizationName: context.organization.name,
      name: quote.lead.name,
      trackingUrl: trackingUrl(quote.publicToken),
      note: input.note,
      changes,
      startsAt,
      endsAt,
      brand: await mailBrandFor(organizationId),
    });
    const sent = await sendMail({
      to: quote.lead.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      category: "catalog",
      organizationId,
      entity: "QuoteRequest",
      entityId: quote.id,
      actor,
    });
    mail = { status: sent.status, error: sent.error };
    if (sent.status === "failed") console.error("pedido: no se pudo enviar el correo de la propuesta", { quoteRequestId: quote.id, error: sent.error });
  }
  return { ok: true, status: "PROPOSED", total, changes, mail };
}

// ── Respuesta del cliente a la propuesta ─────────────────────────────────────

export type ClientResponseResult =
  | { ok: true; status: "APPROVED" | "DECLINED" }
  | { ok: false; status: number; error: string };

/**
 * El cliente aprueba o rechaza la propuesta desde su seguimiento (`/pedido/<token>`). Al aprobar se
 * **vuelve a verificar el stock** del período: si en el medio otro cliente tomó piezas, no se
 * aprueba (409), el pedido vuelve a «En revisión» y el equipo lo ve. Aprobar no reserva: la
 * retención la hace la empresa al aceptar. Idempotente: repetir la misma respuesta no cambia nada.
 */
export async function respondToProposal(token: string, action: "approve" | "decline", rawNote?: unknown): Promise<ClientResponseResult> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, status: 404, error: "Pedido no encontrado." };
  const quote = await db.quoteRequest.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, organizationId: true, startsAt: true, endsAt: true, leadId: true, lead: { select: { name: true, email: true } }, items: { select: { inventoryId: true, quantity: true, state: true } } },
  });
  if (!quote?.organizationId) return { ok: false, status: 404, error: "Pedido no encontrado." };
  const organizationId = quote.organizationId;
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true, isDemo: true } });
  if (organization?.isDemo) return { ok: false, status: 403, error: "Esta es una demo: la respuesta no se guarda." };
  if (action === "approve" && quote.status === "APPROVED") return { ok: true, status: "APPROVED" };
  if (action === "decline" && quote.status === "DECLINED") return { ok: true, status: "DECLINED" };
  if (quote.status !== "PROPOSED") return { ok: false, status: 409, error: "Este pedido no tiene una propuesta pendiente de tu respuesta." };

  const actor = portalAuditContext(organizationId, quote.lead?.name ?? "", quote.lead?.email);
  const note = typeof rawNote === "string" ? rawNote.trim().replace(/\s+/g, " ").slice(0, 300) : "";

  if (action === "decline") {
    const moved = await db.quoteRequest.updateMany({
      where: { id: quote.id, status: "PROPOSED" },
      data: { status: "DECLINED", declinedAt: new Date(), declinedBy: "CLIENT", declineReason: note || "El cliente no aceptó la propuesta." },
    });
    if (moved.count === 0) return { ok: false, status: 409, error: "Este pedido ya cambió de estado: recargá la página." };
    await recordAudit({ context: actor, action: "status", entity: "Lead", entityId: quote.leadId ?? quote.id, summary: "El cliente rechazó la propuesta del pedido", detail: { changes: { quoteRequestStatus: { from: "PROPOSED", to: "DECLINED" } }, fields: { nota: note || null } } });
    return { ok: true, status: "DECLINED" };
  }

  const activeLines = quote.items.filter((item) => quoteItemActive(item.state));
  if (quote.startsAt && quote.endsAt && activeLines.length > 0) {
    const problems = await stockShortages({ organizationId, lines: activeLines, startsAt: quote.startsAt, endsAt: quote.endsAt });
    if (problems.length > 0) {
      await db.quoteRequest.updateMany({ where: { id: quote.id, status: "PROPOSED" }, data: { status: "REVIEWING" } });
      await recordAudit({ context: actor, action: "status", entity: "Lead", entityId: quote.leadId ?? quote.id, summary: "La propuesta del pedido ya no tiene stock: vuelve a revisión", detail: { fields: { faltantes: problems } } });
      return { ok: false, status: 409, error: PORTAL_PROPOSAL_STOCK_MESSAGE };
    }
  }
  const moved = await db.quoteRequest.updateMany({ where: { id: quote.id, status: "PROPOSED" }, data: { status: "APPROVED", proposalApprovedAt: new Date() } });
  if (moved.count === 0) return { ok: false, status: 409, error: "Este pedido ya cambió de estado: recargá la página." };
  // Si la propuesta traía un precio acordado (aceptado o contraofertado), el cliente acaba de aprobarlo.
  await markPriceOfferApproved(quote.id, organizationId);
  await recordAudit({ context: actor, action: "status", entity: "Lead", entityId: quote.leadId ?? quote.id, summary: "El cliente aprobó la propuesta del pedido", detail: { changes: { quoteRequestStatus: { from: "PROPOSED", to: "APPROVED" } } } });
  return { ok: true, status: "APPROVED" };
}
