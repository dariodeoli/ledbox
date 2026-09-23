import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { recordAudit, portalAuditContext } from "@/lib/server/audit";
import {
  loadPublicBudget,
  portalBudgetOpen,
  resolveDiscountProposal,
  resolveItemProposal,
  PORTAL_MAX_NAME,
  PORTAL_MAX_NOTE,
} from "@/lib/server/budget-portal";
import { isDemoOrganizationId } from "@/lib/server/demo-data";
import { jsonError, readJson } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { normalizeBudgetCode } from "@/lib/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EMAIL = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISCOUNT_NOTE = PORTAL_MAX_NOTE;

/**
 * `POST /api/portal/budget/[token]/propose` (issue #14): el cliente propone
 * cantidades y días sobre los ítems reales del presupuesto (`kind: "items"`) o
 * pide una rebaja (`kind: "discount"`), siempre con un motivo.
 *
 * Nada de lo que llega se aplica solo: queda como solicitud `pending` que el
 * panel acepta o rechaza. Los precios unitarios son fijos (el cliente no puede
 * mandar precios) y los topes salen de `lib/server/budget-portal.ts`.
 *
 * Si ya hay una solicitud pendiente del mismo tipo, se actualiza con la nueva
 * propuesta (el cliente cambió de idea) en vez de acumular duplicados.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:propose:${getClientIp(request)}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const { token } = await params;
  const code = normalizeBudgetCode(token);
  const budget = code
    ? await db.budget.findUnique({
        where: { publicToken: code },
        select: {
          id: true,
          title: true,
          status: true,
          approvedAt: true,
          subtotal: true,
          discount: true,
          organizationId: true,
          client: { select: { name: true, company: true, email: true } },
          items: { select: { id: true, name: true, quantity: true, days: true, unitPrice: true } },
        },
      })
    : null;
  if (!budget) return jsonError("No encontramos ese presupuesto.", 404);
  // Issue #52: la empresa demo no escribe; el portal simula la propuesta en el navegador.
  if (await isDemoOrganizationId(budget.organizationId)) return jsonError("Modo demo: solo lectura", 403);
  if (budget.approvedAt) return jsonError("Este presupuesto ya fue aprobado; el equipo de LedBox puede revisarlo.", 409);
  if (!portalBudgetOpen(budget.status)) return jsonError("Este presupuesto ya no está disponible.", 409);

  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = body.kind === "items" ? "items" : body.kind === "discount" ? "discount" : "";
  if (!kind) return jsonError("Indicá qué querés proponer: ítems o descuento.", 400);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (name.length < 3) return jsonError("Ingresá tu nombre y apellido.", 400);
  if (name.length > PORTAL_MAX_NAME) return jsonError(`El nombre no puede superar los ${PORTAL_MAX_NAME} caracteres.`, 400);
  if (email && (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email))) return jsonError("Revisá el correo ingresado.", 400);
  if (!note) return jsonError("Contanos el motivo de la propuesta.", 400);
  if (note.length > MAX_DISCOUNT_NOTE) return jsonError(`El motivo no puede superar los ${MAX_DISCOUNT_NOTE} caracteres.`, 400);

  let payload: Prisma.InputJsonObject;
  let summary: string;
  let detail: { fields: Record<string, unknown> };

  if (kind === "items") {
    const proposal = resolveItemProposal(budget.items, body.items);
    if (!proposal.ok) return jsonError(proposal.error, 400);
    if (!proposal.changed) return jsonError("La propuesta no cambia ninguna cantidad ni días.", 400);
    payload = { items: proposal.value };
    summary = `El cliente «${name}» propuso nuevos ítems para el presupuesto «${budget.title}» desde el portal`;
    detail = { fields: { items: proposal.value.length, propuesta: "ítems" } };
  } else {
    const proposal = resolveDiscountProposal(budget.subtotal, budget.discount, body.discount);
    if (!proposal.ok) return jsonError(proposal.error, 400);
    if (!proposal.changed) return jsonError("Ese descuento ya está aplicado en el presupuesto.", 400);
    payload = { discount: proposal.value };
    summary =
      proposal.value.type === "percent"
        ? `El cliente «${name}» pidió una rebaja del ${proposal.value.value} % para el presupuesto «${budget.title}»`
        : `El cliente «${name}» pidió una rebaja de ${proposal.value.amount} Gs. para el presupuesto «${budget.title}»`;
    detail = { fields: { discount: proposal.value.amount, pedido: proposal.value.type === "percent" ? `${proposal.value.value} %` : "monto" } };
  }

  const now = new Date();
  const existing = await db.budgetChangeRequest.findFirst({
    where: { budgetId: budget.id, kind, status: "pending" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  const requestId = existing?.id ?? randomUUID();
  const data = {
    payload,
    note,
    requestedByName: name,
    requestedByEmail: email || null,
    createdAt: now,
  };
  if (existing) {
    await db.budgetChangeRequest.update({ where: { id: existing.id }, data });
  } else {
    await db.budgetChangeRequest.create({
      data: {
        id: requestId,
        organizationId: budget.organizationId,
        budgetId: budget.id,
        kind,
        status: "pending",
        ...data,
      },
    });
  }

  const responsePayload = await loadPublicBudget(code);
  if (!responsePayload) return jsonError("No encontramos ese presupuesto.", 404);

  await recordAudit({
    context: portalAuditContext(budget.organizationId, name, email || budget.client?.email),
    action: existing ? "update" : "create",
    entity: "Budget",
    entityId: budget.id,
    summary,
    detail,
  });
  return Response.json({ budget: responsePayload, replaced: Boolean(existing) });
}
