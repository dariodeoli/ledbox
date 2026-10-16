import { Prisma } from "@prisma/client";
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
  const auth = await requireAdminContext("org.manage", { sandbox: "deny" });
  if (!auth.ok) return auth.response;
  const { organizationId, user: actor } = auth.context;

  const input = await readJson(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) return jsonError("Indicá los datos de la solicitud.", 400);
  const body = input as Record<string, unknown>;
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  if (!planId) return jsonError("Elegí el plan al que querés cambiar.", 400);
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return jsonError("La nota debe ser texto.", 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX_LENGTH) {
    return jsonError(`La nota no puede superar ${NOTE_MAX_LENGTH} caracteres.`, 400);
  }

  const plan = await db.plan.findFirst({
    where: { id: planId, active: true },
    select: { id: true, code: true, name: true, priceMonthly: true },
  });
  if (!plan) return jsonError("Ese plan no está disponible en el catálogo.", 404);

  // Serializa las solicitudes de una empresa: dos pestañas actualizan la misma pendiente.
  const result = await db.$transaction(async (tx) => {
    const organizations = await tx.$queryRaw<Array<{ planId: string | null }>>(Prisma.sql`
      SELECT "planId" FROM "Organization" WHERE "id" = ${organizationId}
      AND NOT "isDemo" AND "slug" <> 'demo' FOR UPDATE`);
    if (!organizations.length) return { ok: false, error: "La empresa no está disponible.", status: 404 } as const;
    if (organizations[0].planId === plan.id) return { ok: false, error: `La empresa ya está en el plan «${plan.name}».`, status: 409 } as const;
    const pending = await tx.planChangeRequest.findFirst({
      where: { organizationId, status: "pending" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, planId: true },
    });
    const fields = {
      planId: plan.id, note: note || null,
      requestedById: actor.id, requestedByName: actor.name, requestedByEmail: actor.email,
      createdAt: new Date(),
    };
    const saved = pending
      ? await tx.planChangeRequest.update({ where: { id: pending.id }, data: fields })
      : await tx.planChangeRequest.create({ data: { id: randomUUID(), organizationId, ...fields } });
    return { ok: true, pending, saved } as const;
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const { pending, saved } = result;

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
