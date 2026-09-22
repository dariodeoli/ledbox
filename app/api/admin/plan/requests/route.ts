import { randomUUID } from "node:crypto";
import { formatMoney } from "@/lib/admin-format";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Largo máximo de la nota de la solicitud (regla de descripciones del panel). */
const NOTE_MAX_LENGTH = 400;

/**
 * Solicitud de cambio de plan (issue #42): la registra OWNER/ADMIN
 * (`org.manage`) y queda auditada con el actor real.
 *
 * El plan vigente **no** cambia desde acá: el cambio efectivo lo hace Owncoding
 * (todavía no hay pasarela de pago, y la UI lo dice). Una sola solicitud
 * pendiente por empresa: pedir otro plan actualiza la existente en lugar de
 * acumular filas. La demo responde 403 «Modo demo: solo lectura» desde la capa
 * de tenancy, sin llegar a escribir.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, user: actor } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  if (!planId) return jsonError("Elegí el plan al que querés cambiar.", 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX_LENGTH) {
    return jsonError(`La nota no puede superar ${NOTE_MAX_LENGTH} caracteres.`, 400);
  }

  const plan = await db.plan.findFirst({
    where: { id: planId, active: true },
    select: { id: true, code: true, name: true, priceMonthly: true },
  });
  if (!plan) return jsonError("Ese plan no está disponible en el catálogo.", 404);

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { planId: true },
  });
  if (organization?.planId === plan.id) {
    return jsonError(`La empresa ya está en el plan «${plan.name}».`, 409);
  }

  const pending = await db.planChangeRequest.findFirst({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "desc" },
    select: { id: true, planId: true },
  });
  const fields = {
    planId: plan.id,
    note: note || null,
    requestedById: actor.id,
    requestedByName: actor.name,
    requestedByEmail: actor.email,
    // La fecha de la solicitud es la del pedido vigente (una sola pendiente).
    createdAt: new Date(),
  };
  const saved = pending
    ? await db.planChangeRequest.update({ where: { id: pending.id }, data: fields })
    : await db.planChangeRequest.create({ data: { id: randomUUID(), organizationId, ...fields } });

  await recordAudit({
    context: auth.context,
    action: pending ? "update" : "create",
    entity: "PlanChangeRequest",
    entityId: saved.id,
    summary: pending && pending.planId === plan.id
      ? `Actualizó la solicitud pendiente del plan «${plan.name}» (${formatMoney(plan.priceMonthly)} por mes)`
      : `Solicitó el cambio al plan «${plan.name}» (${formatMoney(plan.priceMonthly)} por mes)`,
    detail: {
      fields: {
        planCode: plan.code,
        planName: plan.name,
        priceMonthly: plan.priceMonthly,
        note: note || null,
        replacedPending: Boolean(pending),
      },
    },
  });

  return Response.json(
    {
      request: {
        id: saved.id,
        planId: saved.planId,
        planCode: plan.code,
        planName: plan.name,
        status: saved.status,
        note: saved.note,
        requestedByName: saved.requestedByName,
        requestedByEmail: saved.requestedByEmail,
        decidedAt: saved.decidedAt?.toISOString() ?? null,
        decidedByName: saved.decidedByName,
        createdAt: saved.createdAt.toISOString(),
      },
    },
    { status: pending ? 200 : 201 },
  );
}
