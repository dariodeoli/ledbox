import { randomUUID } from "node:crypto";
import { PagaYaPersistenceError, pagayaCommandBody, type PagaYaRepository } from "./repository";
import type { PagaYaEnrollment, PagaYaOwner, PagaYaReadAdapter, PagaYaSubscriptionRead } from "./types";

export function confirmedPagaYaPeriod(enrollment: PagaYaEnrollment, snapshot: PagaYaSubscriptionRead) {
  if (snapshot.id !== enrollment.subscriptionId || snapshot.checkoutId !== enrollment.checkoutId
    || snapshot.appId !== enrollment.appId || snapshot.mode !== enrollment.mode
    || snapshot.externalReference !== enrollment.externalReference) {
    throw new PagaYaPersistenceError("subscription_read_binding_mismatch");
  }
  if (!snapshot.status || typeof snapshot.cancelAtPeriodEnd !== "boolean") {
    throw new PagaYaPersistenceError("subscription_wire_contract_unavailable", 400);
  }
  if (snapshot.paidPeriod === null) return null;
  if (!snapshot.paidPeriod || ![snapshot.paidPeriod.startsAt, snapshot.paidPeriod.endsAt].every(value =>
    typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))) {
    throw new PagaYaPersistenceError("confirmed_paid_period_unavailable", 400);
  }
  const startsAt = new Date(snapshot.paidPeriod.startsAt), endsAt = new Date(snapshot.paidPeriod.endsAt);
  if (endsAt.getTime() <= startsAt.getTime()) throw new PagaYaPersistenceError("invalid_paid_period", 400);
  return { startsAt, endsAt };
}

/** Server only, with FIN's real app-scoped read adapter. No event-status or
 * redirect path calls this policy. Append intervals rather than issuing credits:
 * duplicate invoices/payment events and older periods cannot double-grant.
 * A paid interval remains valid at period-end cancellation/pending202; no
 * invented trial, grace period, refund revocation or Plan42 quota is applied.
 */
export async function reconcilePagaYaPeriodAccess(
  repository: PagaYaRepository, owner: PagaYaOwner, enrollmentId: string, adapter: PagaYaReadAdapter, now = new Date(),
) {
  if (!Number.isFinite(now.getTime())) throw new PagaYaPersistenceError("invalid_access_clock", 400);
  let enrollment = await repository.getOwnedEnrollment(owner, enrollmentId);
  if (!enrollment.checkoutId) throw new PagaYaPersistenceError("checkout_read_binding_pending");
  const checkout = await adapter.getCheckout(enrollment.checkoutId);
  if (checkout.id !== enrollment.checkoutId) throw new PagaYaPersistenceError("checkout_read_binding_mismatch");
  enrollment = await repository.saveCheckoutRead(owner, enrollmentId, checkout);
  if (!enrollment.subscriptionId) throw new PagaYaPersistenceError("subscription_read_binding_pending");
  const snapshot = await adapter.getSubscription(enrollment.subscriptionId);
  const period = confirmedPagaYaPeriod(enrollment, snapshot);
  return repository.database.$transaction(async tx => {
    // Read the real association again after external reads and before writes.
    const current = await repository.ownedInTransaction(tx, owner, enrollmentId);
    confirmedPagaYaPeriod(current, snapshot);
    await tx.$executeRaw`
      UPDATE "PagaYaEnrollment" SET "subscriptionSnapshot"=${pagayaCommandBody(snapshot)}::jsonb,
        "snapshotObservedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=${enrollmentId}
    `;
    if (period) {
      await tx.$executeRaw`
        INSERT INTO "PagaYaAccessPeriod" ("id","enrollmentId","appId","mode","checkoutId","subscriptionId","startsAt","endsAt","createdAt")
        VALUES (${randomUUID()},${enrollmentId},${owner.appId},${owner.mode},${snapshot.checkoutId},${snapshot.id},${period.startsAt},${period.endsAt},NOW())
        ON CONFLICT ("enrollmentId","startsAt","endsAt") DO NOTHING
      `;
    }
    const rows = await tx.$queryRaw<{ hasAccess: boolean; confirmedThrough: Date | null }[]>`
      SELECT COALESCE(BOOL_OR("startsAt"<=${now} AND "endsAt">${now}),FALSE) AS "hasAccess",MAX("endsAt") AS "confirmedThrough"
      FROM "PagaYaAccessPeriod" WHERE "enrollmentId"=${enrollmentId}
    `;
    return { hasAccess: rows[0]?.hasAccess === true, confirmedThrough: rows[0]?.confirmedThrough?.toISOString() ?? null,
      status: snapshot.status, cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd, pendingRenewalMutation: snapshot.pendingRenewalMutation };
  });
}
