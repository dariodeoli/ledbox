import { PagaYaPersistenceError, pagayaCommandBody, pagayaDigest, type PagaYaRepository } from "./repository";
import type { PagaYaEnrollment, PagaYaInboxEvent, PagaYaReadAdapter, PagaYaWebhookAdapter } from "./types";
import { reconcilePagaYaPeriodAccess } from "./period-access";

const EVENT_TYPES = new Set(["payment.succeeded", "payment.failed", "invoice.paid", "invoice.payment_failed",
  "subscription.updated", "subscription.cancelled", "refund.processed"]);
function validateEvent(event: PagaYaInboxEvent) {
  if (!event || typeof event.id !== "string" || !event.id || typeof event.appId !== "string" || !event.appId
    || !EVENT_TYPES.has(event.type) || !["test", "live"].includes(event.mode)
    || ![event.externalReference, event.checkoutId, event.subscriptionId].some(value => typeof value === "string" && value.length > 0)) {
    throw new PagaYaPersistenceError("invalid_webhook_envelope", 400);
  }
  for (const field of [event.externalReference, event.checkoutId, event.subscriptionId]) {
    if (field !== null && (typeof field !== "string" || !field)) throw new PagaYaPersistenceError("invalid_webhook_correlation", 400);
  }
}

/** PENDING is the durable work item in this same insert/transaction. Returning
 * from this function means COMMIT succeeded; no 2xx on a failed transaction. */
export function persistPagaYaInboxEvent(repository: PagaYaRepository, event: PagaYaInboxEvent, raw: Uint8Array, payload: unknown) {
  validateEvent(event);
  const payloadSHA256 = pagayaDigest(pagayaCommandBody(payload));
  return repository.database.$transaction(async tx => {
    const rows = await tx.$queryRaw<PagaYaEnrollment[]>`
      SELECT * FROM "PagaYaEnrollment" WHERE "appId"=${event.appId} AND "mode"=${event.mode}
        AND ((${event.externalReference}::text IS NOT NULL AND "externalReference"=${event.externalReference})
          OR (${event.checkoutId}::text IS NOT NULL AND "checkoutId"=${event.checkoutId})
          OR (${event.subscriptionId}::text IS NOT NULL AND "subscriptionId"=${event.subscriptionId}))
        AND (${event.externalReference}::text IS NULL OR "externalReference"=${event.externalReference})
        AND (${event.checkoutId}::text IS NULL OR "checkoutId"=${event.checkoutId})
        AND (${event.subscriptionId}::text IS NULL OR "subscriptionId"=${event.subscriptionId}) FOR UPDATE
    `;
    if (rows.length !== 1) throw new PagaYaPersistenceError("webhook_correlation_not_ready");
    const enrollment = rows[0];
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "PagaYaInboxEvent" ("id","enrollmentId","appId","mode","eventType","rawBody","rawSHA256","payloadSHA256","normalized","state","version","createdAt","updatedAt")
      VALUES (${event.id},${enrollment.id},${event.appId},${event.mode},${event.type},${Buffer.from(raw)},${pagayaDigest(raw)},${payloadSHA256},
        ${pagayaCommandBody(event)}::jsonb,'PENDING',0,NOW(),NOW()) ON CONFLICT ("id") DO NOTHING RETURNING "id"
    `;
    if (inserted.length) return { duplicate: false };
    const previous = await tx.$queryRaw<{ enrollmentId: string; payloadSHA256: string; appId: string; mode: string }[]>`
      SELECT "enrollmentId","payloadSHA256","appId","mode" FROM "PagaYaInboxEvent" WHERE "id"=${event.id}
    `;
    if (!previous[0] || previous[0].enrollmentId !== enrollment.id || previous[0].payloadSHA256 !== payloadSHA256
      || previous[0].appId !== event.appId || previous[0].mode !== event.mode) {
      throw new PagaYaPersistenceError("immutable_webhook_event_conflict");
    }
    return { duplicate: true };
  });
}

export async function receivePagaYaWebhook(request: Request, repository: PagaYaRepository, adapter: PagaYaWebhookAdapter) {
  // Bound original-byte capture without parsing/reserializing or logging it.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 1_048_576) { await reader.cancel(); return new Response("Payload too large", { status: 413 }); }
      chunks.push(chunk.value);
    }
  } catch { return new Response("Invalid body", { status: 400 }); }
  const raw = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  if (!adapter.verifyPagaYaWebhook(raw, request.headers.get("x-pagaya-signature"), adapter.webhookSecret,
    { nowMs: Date.now(), toleranceSeconds: 300 })) return new Response("Invalid signature", { status: 400 });
  let payload: unknown, event: PagaYaInboxEvent;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    event = adapter.decodeEvent(payload);
    validateEvent(event);
    if (event.appId !== adapter.expectedAppId || event.mode !== adapter.expectedMode) {
      return new Response("Invalid app or mode", { status: 400 });
    }
  } catch { return new Response("Invalid envelope", { status: 400 }); }
  try {
    await persistPagaYaInboxEvent(repository, event, raw, payload);
    return new Response(null, { status: 204 });
  } catch {
    // Includes commit failure and pending/mismatched local correlation. Keep
    // provider delivery retryable; never acknowledge an unpersisted event.
    return new Response("Webhook persistence unavailable", { status: 503 });
  }
}

/** One explicitly invoked work item, not a new scheduler/loop. Production
 * requires FIN's checked app-scoped read adapter and operational delivery proof.
 * A crash leaves PROCESSING durable for explicit reconciliation, not new charge.
 */
export async function processPagaYaInboxEvent(repository: PagaYaRepository, id: string, version: number, adapter: PagaYaReadAdapter) {
  const work = await repository.database.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ enrollmentId: string; appId: string; mode: "test" | "live"; version: number }[]>`
      UPDATE "PagaYaInboxEvent" SET "state"='PROCESSING',"version"="version"+1,"updatedAt"=NOW()
      WHERE "id"=${id} AND "state"='PENDING' AND "version"=${version} RETURNING "enrollmentId","appId","mode","version"
    `;
    return rows[0] ?? null;
  });
  if (!work) return { processed: false };
  try {
    const owners = await repository.database.$transaction(tx => tx.$queryRaw<PagaYaEnrollment[]>`
      SELECT * FROM "PagaYaEnrollment" WHERE "id"=${work.enrollmentId} AND "appId"=${work.appId} AND "mode"=${work.mode}
    `);
    const enrollment = owners[0];
    if (!enrollment) throw new PagaYaPersistenceError("enrollment_not_owned", 404);
    await reconcilePagaYaPeriodAccess(repository, enrollment, enrollment.id, adapter);
    const completed = await repository.database.$transaction(tx => tx.$executeRaw`
      UPDATE "PagaYaInboxEvent" SET "state"='PROCESSED',"version"="version"+1,"lastError"=NULL,"updatedAt"=NOW()
      WHERE "id"=${id} AND "state"='PROCESSING' AND "version"=${work.version}
    `);
    return { processed: completed === 1 };
  } catch {
    await repository.database.$transaction(tx => tx.$executeRaw`
      UPDATE "PagaYaInboxEvent" SET "state"='PENDING',"version"="version"+1,"lastError"='READ_RECONCILIATION_REQUIRED',"updatedAt"=NOW()
      WHERE "id"=${id} AND "state"='PROCESSING' AND "version"=${work.version}
    `);
    throw new PagaYaPersistenceError("read_reconciliation_required");
  }
}
