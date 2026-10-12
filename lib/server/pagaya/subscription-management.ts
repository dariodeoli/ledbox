import "server-only";
import { PagaYaError } from "./pagaya-server.mjs";
import { requirePagaYaCapability } from "./client";
import { pagayaCommandBody, pagayaDigest } from "./repository";
import type { PagaYaBillingContext } from "./catalog-checkout";

async function ownedSubscription(context: PagaYaBillingContext, enrollmentId: string, subscriptionId: string) {
  const enrollment = await context.repository.getOwnedEnrollment(context.owner, enrollmentId);
  if (!enrollment.checkoutId || !enrollment.subscriptionId || enrollment.subscriptionId !== subscriptionId) {
    throw new PagaYaError("not_found", { status: 404 });
  }
  return enrollment;
}

export async function getOwnedSubscription(context: PagaYaBillingContext, enrollmentId: string, subscriptionId: string) {
  requirePagaYaCapability(context.client, "subscriptionRead");
  await ownedSubscription(context, enrollmentId, subscriptionId);
  // No guessed period field or payment proof. PF's normalized read adapter
  // needs the actual wire contract before this projection can be exposed.
  throw new PagaYaError("wire_contract_unavailable", { status: 503 });
}

export async function setOwnedRenewal(context: PagaYaBillingContext, enrollmentId: string, subscriptionId: string,
  intentId: string, cancelAtPeriodEnd: boolean) {
  requirePagaYaCapability(context.client, "subscriptionWrite");
  await ownedSubscription(context, enrollmentId, subscriptionId);
  const reserved = await context.repository.reserveCommand(context.owner, enrollmentId,
    { intentId, kind: "RENEWAL", body: { cancelAtPeriodEnd } });
  const command = await context.repository.getOwnedCommand(context.owner, enrollmentId, reserved.id);
  if (command.commandKey !== reserved.commandKey || command.requestBody !== reserved.requestBody || command.bodySHA256 !== reserved.bodySHA256) {
    throw new PagaYaError("idempotency_conflict", { status: 409 });
  }
  const requestBody = pagayaCommandBody({ cancelAtPeriodEnd });
  if (command.resourceId !== subscriptionId || command.requestBody !== requestBody || command.bodySHA256 !== pagayaDigest(requestBody)) {
    throw new PagaYaError("idempotency_conflict", { status: 409 });
  }
  if (command.state !== "PREPARED") {
    return { commandId: command.id, state: command.state, applied: command.state === "SUCCEEDED" };
  }
  // Both reservation and CAS transactions have committed before any provider
  // POST. Concurrent/unknown commands never trigger an automatic resend.
  const claimed = await context.repository.claimCommand(context.owner, enrollmentId, command.id, command.version);
  if (!claimed) throw new PagaYaError("subscription_mutation_conflict", { status: 409 });
  if (claimed.resourceId !== subscriptionId || claimed.requestBody !== requestBody || claimed.bodySHA256 !== pagayaDigest(requestBody) ||
      claimed.commandKey !== command.commandKey || claimed.state !== "SUBMITTING") {
    throw new PagaYaError("idempotency_conflict", { status: 409 });
  }
  let result;
  try {
    result = await context.client.connector.setRenewal(subscriptionId, cancelAtPeriodEnd, claimed.commandKey);
  } catch (error) {
    // A bare thrown error after submission cannot prove a failed command.
    const unknown = !(error instanceof PagaYaError) || error.outcomeUnknown;
    const saved = await context.repository.recordCommandOutcome(context.owner, enrollmentId, claimed.id, claimed.version,
      { state: unknown ? "UNKNOWN" : "FAILED", responseBody: { error: error instanceof PagaYaError ? error.code : "transport_error", outcomeUnknown: unknown } });
    if (!saved) throw new PagaYaError("subscription_submission_persistence_pending", { status: 503, outcomeUnknown: true });
    throw error instanceof PagaYaError ? error : new PagaYaError("transport_error", { outcomeUnknown: true });
  }
  // The connector preserves the pending projection but not HTTP success
  // status. Without a qualified read/reconciliation adapter, even a 2xx must
  // remain UNKNOWN; never report 202 as applied or revoke a paid period.
  const saved = await context.repository.recordCommandOutcome(context.owner, enrollmentId, claimed.id, claimed.version,
    { state: "UNKNOWN", responseBody: result });
  if (!saved) throw new PagaYaError("subscription_submission_persistence_pending", { status: 503, outcomeUnknown: true });
  return { commandId: saved.id, state: saved.state, applied: false };
}

export async function createOwnedPortal(context: PagaYaBillingContext, enrollmentId: string, subscriptionId: string) {
  requirePagaYaCapability(context.client, "subscriptionWrite");
  await ownedSubscription(context, enrollmentId, subscriptionId);
  const result = await context.client.connector.createPortalSession(subscriptionId);
  if (typeof result.url !== "string") throw new PagaYaError("invalid_response", { status: 502, outcomeUnknown: true });
  let url: URL;
  try { url = new URL(result.url); } catch { throw new PagaYaError("invalid_response", { status: 502, outcomeUnknown: true }); }
  if (url.protocol !== "https:" || url.username || url.password) throw new PagaYaError("invalid_response", { status: 502, outcomeUnknown: true });
  return { url: result.url };
}
