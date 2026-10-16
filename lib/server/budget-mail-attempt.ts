import { createHash } from "node:crypto";
import type { SendMailResult } from "./mail";
import type { SimulatedMail } from "../mail-preview";
import type { AdminContext } from "./tenancy";
import { db } from "./db";
import { recordAudit } from "./audit";
import { withIdempotency, IDEMPOTENCY_HEADER } from "./idempotency";
import { withQuoteCommercialEdit } from "./quote-comparison";
import type { BudgetMailReply, MailCommercialState } from "../budget-mail-receipt";

const SCOPE = "budget:mail-attempt:v1";
type Outcome = Omit<SendMailResult, "preview">;
type StoredAttempt = { version: 1; budgetId: string; actorId: string; originalUpdatedAt: string; reply: BudgetMailReply; outcome: Outcome | null };

/** La clave no contiene el JWT, el HTML ni el código público del presupuesto. */
export function budgetMailAttemptId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function readBudgetMailAttempt(context: AdminContext, budgetId: string, attemptId: string): Promise<StoredAttempt | null> {
  if (!/^[a-f0-9]{64}$/.test(attemptId)) return null;
  const row = await db.idempotencyKey.findUnique({
    where: { organizationId_scope_key: { organizationId: context.organizationId, scope: SCOPE, key: attemptId } },
    select: { response: true, expiresAt: true },
  });
  if (!row || row.expiresAt <= new Date()) return null;
  const data = row.response as unknown as StoredAttempt | null;
  if (!data || data.version !== 1 || data.budgetId !== budgetId || data.actorId !== context.user.id) return null;
  if (!data.reply || data.reply.attemptId !== attemptId || !["sent", "failed", "skipped", "pending", "unknown"].includes(data.reply.status)) {
    throw new Error("El recibo de correo no se puede interpretar; no se reenviará automáticamente.");
  }
  return data;
}

function stored(data: StoredAttempt) {
  // Únicamente metadata/resultado acotados: nunca se persiste preview/HTML/token.
  return JSON.parse(JSON.stringify(data));
}

/** Conciliar un acuse aceptado nunca vuelve a ejecutar el transporte. */
export async function reconcileBudgetMailAttempt(context: AdminContext, data: StoredAttempt): Promise<BudgetMailReply> {
  if (data.reply.status !== "sent" || data.reply.commercialState !== "reconciliation_pending") return data.reply;
  try {
    return await withQuoteCommercialEdit(data.budgetId, context.organizationId, false, async tx => {
      const current = await tx.budget.findFirst({
        where: { id: data.budgetId, organizationId: context.organizationId, deletedAt: null },
        select: { id: true, title: true, status: true, updatedAt: true, approvedAt: true, archivedAt: true },
      });
      let state: MailCommercialState = "preserved_status";
      if (current?.status === "SENT") state = "already_sent";
      else if (current?.status === "DRAFT" && !current.approvedAt && !current.archivedAt) {
        if (current.updatedAt.toISOString() !== data.originalUpdatedAt) state = "stale_revision";
        else {
          const signed = await tx.signatureRequest.count({ where: { budgetId: current.id, status: { in: ["SIGNED", "VALIDATED"] } } });
          if (!signed) {
            const changed = await tx.budget.updateMany({
              where: { id: current.id, organizationId: context.organizationId, status: "DRAFT", updatedAt: current.updatedAt, approvedAt: null, archivedAt: null, deletedAt: null },
              data: { status: "SENT" },
            });
            state = changed.count === 1 ? "transitioned" : "stale_revision";
            if (changed.count) await recordAudit({ context, action: "status", entity: "Budget", entityId: current.id,
              summary: `Presupuesto «${current.title}» marcado Enviado tras aceptación del correo por el proveedor`,
              detail: { changes: { status: { from: "DRAFT", to: "SENT" } }, fields: { attemptId: data.reply.attemptId } },
            }, tx);
          }
        }
      }
      const reply: BudgetMailReply = { ...data.reply, commercialState: state,
        ...(current ? { budgetStatus: state === "transitioned" ? "SENT" : current.status } : {}) };
      await tx.idempotencyKey.update({
        where: { organizationId_scope_key: { organizationId: context.organizationId, scope: SCOPE, key: data.reply.attemptId } },
        data: { status: 200, response: stored({ ...data, reply }) },
      });
      return reply;
    });
  } catch {
    // El acuse ya se guardó antes. Queda recuperable sin volver a mandar correo.
    return { ...data.reply, commercialState: "reconciliation_pending" };
  }
}

export async function sendBudgetMailAttempt(options: {
  request: Request; context: AdminContext; budgetId: string; updatedAt: Date; token: string; to: string; subject: string;
  deliver: () => Promise<SendMailResult>;
}): Promise<{ reply: BudgetMailReply; firstAttempt: boolean; preview?: SimulatedMail }> {
  const { context, budgetId } = options, attemptId = budgetMailAttemptId(options.token);
  const initial: StoredAttempt = { version: 1, budgetId, actorId: context.user.id, originalUpdatedAt: options.updatedAt.toISOString(), outcome: null,
    reply: { attemptId, to: options.to, subject: options.subject, status: "pending", commercialState: "not_applicable",
      error: "El intento está registrado y su resultado sigue pendiente o incierto. No se reenviará automáticamente." } };
  // El claim se confirma ANTES de la red. withIdempotency sólo contiene esta tx breve.
  const claim = await withIdempotency({
    request: new Request(options.request.url, { method: "POST", headers: { [IDEMPOTENCY_HEADER]: attemptId } }),
    organizationId: context.organizationId, scope: SCOPE,
    body: { budgetId, actorId: context.user.id, originalUpdatedAt: initial.originalUpdatedAt, attemptId },
  }, async tx => {
    const current = await tx.budget.findFirst({ where: { id: budgetId, organizationId: context.organizationId, deletedAt: null }, select: { id: true, updatedAt: true } });
    if (!current || current.updatedAt.toISOString() !== initial.originalUpdatedAt) throw new Error("El presupuesto cambió antes de registrar el intento. Previsualizá de nuevo.");
    return { status: 202, body: stored(initial) };
  });
  if (claim.headers.get("Idempotent-Replay") === "true" || !claim.ok) {
    const prior = await readBudgetMailAttempt(context, budgetId, attemptId);
    if (!prior) throw new Error("No se pudo recuperar el intento de correo; no se reenviará automáticamente.");
    return { reply: await reconcileBudgetMailAttempt(context, prior), firstAttempt: false };
  }
  let result: SendMailResult;
  try { result = await options.deliver(); }
  catch {
    const reply: BudgetMailReply = { ...initial.reply, status: "unknown", error: "No se pudo confirmar el resultado del proveedor. Revisá el historial antes de crear otro envío." };
    try { await db.idempotencyKey.update({ where: { organizationId_scope_key: { organizationId: context.organizationId, scope: SCOPE, key: attemptId } }, data: { status: 200, response: stored({ ...initial, reply }) } }); } catch { /* El claim previo conserva la incertidumbre. */ }
    return { reply, firstAttempt: true };
  }
  const { preview, ...outcome } = result;
  const reply: BudgetMailReply = { ...initial.reply, status: result.uncertain ? "unknown" : result.status, error: result.error?.slice(0, 300) ?? null,
    providerId: result.providerId ?? null, logId: result.logId ?? null, ...(result.simulated ? { simulated: true } : {}),
    ...(result.status === "sent" && !result.uncertain ? { sentAt: new Date().toISOString() } : {}),
    commercialState: result.status === "sent" && !result.uncertain ? "reconciliation_pending" : "not_applicable" };
  const accepted = { ...initial, outcome, reply };
  try {
    // Un acuse aceptado se guarda antes de intentar cambiar el estado comercial.
    await db.idempotencyKey.update({ where: { organizationId_scope_key: { organizationId: context.organizationId, scope: SCOPE, key: attemptId } }, data: { status: 200, response: stored(accepted) } });
  } catch {
    return { reply: { ...reply, error: result.status === "sent" ? "El proveedor aceptó el correo; falta guardar el resultado y conciliar el estado. No lo reenvíes." : reply.error }, firstAttempt: true, ...(preview ? { preview } : {}) };
  }
  return { reply: await reconcileBudgetMailAttempt(context, accepted), firstAttempt: true, ...(preview ? { preview } : {}) };
}
