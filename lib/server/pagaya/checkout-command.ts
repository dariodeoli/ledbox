import { createHash } from "node:crypto";
import { PagaYaError, type PagaYaCheckoutInput } from "./pagaya-server.mjs";
import type { PagaYaBillingContext } from "./catalog-checkout";

/** Server checkout from an already approved, durable owner enrollment.
 * This function never creates/approves a customer, price or entitlement. */
export async function submitApprovedCheckout(context: PagaYaBillingContext, enrollmentId: string, intentId: string) {
  if (typeof window !== "undefined" || !context.client.config.checkoutWrite) {
    throw new PagaYaError("permission_denied", { status: 403 });
  }
  if (!intentId || intentId.length > 160) throw new PagaYaError("invalid_request", { status: 400 });
  const enrollment = await context.repository.getOwnedEnrollment(context.owner, enrollmentId);
  const customer = enrollment.customer;
  const provenance = enrollment.customerProvenance;
  if (enrollment.organizationId !== context.owner.organizationId || enrollment.adminUserId !== context.owner.adminUserId ||
      enrollment.appId !== context.owner.appId || enrollment.mode !== context.owner.mode) {
    throw new PagaYaError("not_found", { status: 404 });
  }
  if (!customer?.name || !customer.email || !/^\+[1-9]\d{6,14}$/.test(customer.phone) ||
      !provenance?.sourceReference || provenance.approvedByAdminUserId !== context.owner.adminUserId ||
      !Number.isFinite(Date.parse(provenance.approvedAt)) || !enrollment.approvedPriceVersionId || !enrollment.externalReference) {
    throw new PagaYaError("billing_customer_unavailable", { status: 503 });
  }
  const input: PagaYaCheckoutInput = {
    priceVersionId: enrollment.approvedPriceVersionId,
    externalReference: enrollment.externalReference,
    customer: { name: customer.name, email: customer.email, phone: customer.phone },
  };
  const reserved = await context.repository.reserveCommand(context.owner, enrollmentId,
    { intentId, kind: "CHECKOUT", body: input });
  const command = await context.repository.getOwnedCommand(context.owner, enrollmentId, reserved.id);
  if (command.commandKey !== reserved.commandKey || command.requestBody !== reserved.requestBody || command.bodySHA256 !== reserved.bodySHA256) {
    throw new PagaYaError("idempotency_conflict", { status: 409 });
  }
  function verify(commandBody: string, bodySHA256: string): PagaYaCheckoutInput {
    const parsed: unknown = JSON.parse(commandBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PagaYaError("idempotency_conflict", { status: 409 });
    const body = parsed as Record<string, unknown>;
    const contact = body.customer;
    if (!contact || typeof contact !== "object" || Array.isArray(contact)) throw new PagaYaError("idempotency_conflict", { status: 409 });
    const stored = contact as Record<string, unknown>;
    if (Object.keys(body).sort().join(",") !== "customer,externalReference,priceVersionId" ||
        Object.keys(stored).sort().join(",") !== "email,name,phone" || body.priceVersionId !== input.priceVersionId ||
        body.externalReference !== input.externalReference || stored.name !== customer.name ||
        stored.email !== customer.email || stored.phone !== customer.phone ||
        createHash("sha256").update(commandBody).digest("hex") !== bodySHA256) {
      throw new PagaYaError("idempotency_conflict", { status: 409 });
    }
    // Return parsed persisted bytes, not newly ordered browser/body data.
    return parsed as PagaYaCheckoutInput;
  }
  verify(command.requestBody, command.bodySHA256);
  if (command.kind !== "CHECKOUT" || command.enrollmentId !== enrollmentId || command.resourceId !== null) {
    throw new PagaYaError("idempotency_conflict", { status: 409 });
  }
  if (command.state !== "PREPARED") return { commandId: command.id, state: command.state, applied: false };
  const claimed = await context.repository.claimCommand(context.owner, enrollmentId, command.id, command.version);
  if (!claimed) throw new PagaYaError("checkout_in_progress", { status: 409 });
  if (claimed.id !== command.id || claimed.enrollmentId !== enrollmentId || claimed.kind !== "CHECKOUT" ||
      claimed.resourceId !== null || claimed.state !== "SUBMITTING" || claimed.requestBody !== command.requestBody ||
      claimed.commandKey !== command.commandKey || claimed.bodySHA256 !== command.bodySHA256) {
    throw new PagaYaError("idempotency_conflict", { status: 409 });
  }
  const persistedInput = verify(claimed.requestBody, claimed.bodySHA256);
  let response;
  try {
    response = await context.client.connector.createCheckout(persistedInput, claimed.commandKey);
  } catch (error) {
    const unknown = !(error instanceof PagaYaError) || error.outcomeUnknown;
    const saved = await context.repository.recordCommandOutcome(context.owner, enrollmentId, claimed.id, claimed.version,
      { state: unknown ? "UNKNOWN" : "FAILED", responseBody: { error: error instanceof PagaYaError ? error.code : "transport_error", outcomeUnknown: unknown } });
    if (!saved) throw new PagaYaError("checkout_persistence_pending", { status: 503, outcomeUnknown: true });
    throw error instanceof PagaYaError ? error : new PagaYaError("transport_error", { outcomeUnknown: true });
  }
  // A response/redirect is not independent GET correlation or paid-period
  // proof. Preserve it for reconciliation; never grant access or auto-retry.
  const saved = await context.repository.recordCommandOutcome(context.owner, enrollmentId, claimed.id, claimed.version,
    { state: "UNKNOWN", responseBody: response });
  if (!saved) throw new PagaYaError("checkout_persistence_pending", { status: 503, outcomeUnknown: true });
  return { commandId: saved.id, state: saved.state, applied: false };
}
