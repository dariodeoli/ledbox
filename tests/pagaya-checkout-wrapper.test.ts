import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { submitApprovedCheckout } from "../lib/server/pagaya/checkout-command";
import { PagaYaError } from "../lib/server/pagaya/pagaya-server.mjs";

/** Wrapper orchestration doubles only: no SQL transaction or provider proof. */
function fixture() {
  const calls: string[] = [];
  const owner = { organizationId: "org", adminUserId: "admin", appId: "app", mode: "test" as const };
  const enrollment = { ...owner, id: "enrollment", externalReference: "approved-local-reference", approvedPriceVersionId: "approved-catalog-version",
    customer: { name: "Approved User", email: "approved@example.invalid", phone: "+595991000000" },
    customerProvenance: { sourceReference: "persisted-approval", approvedByAdminUserId: "admin", approvedAt: "2026-10-12T15:00:00Z" },
    checkoutId: null, subscriptionId: null };
  let body = "";
  let state = "PREPARED";
  let version = 0;
  let posts = 0;
  const command = () => ({ id: "command", enrollmentId: enrollment.id, intentId: "intent", kind: "CHECKOUT", commandKey: "persisted-key-182",
    resourceId: null, requestBody: body, bodySHA256: createHash("sha256").update(body).digest("hex"), state, version, responseBody: null });
  const repository = {
    async getOwnedEnrollment(actual: unknown, id: string) { calls.push("owned"); assert.deepEqual(actual, owner); assert.equal(id, enrollment.id); return enrollment; },
    async reserveCommand(_owner: unknown, _id: string, input: { body: unknown }) {
      calls.push("reserve-committed");
      // A deterministic canonical body fixture, not an implementation of PF SQL.
      const value = input.body as typeof enrollment & { priceVersionId: string };
      body = JSON.stringify({ customer: { email: value.customer.email, name: value.customer.name, phone: value.customer.phone }, externalReference: value.externalReference, priceVersionId: value.priceVersionId });
      return command();
    },
    async getOwnedCommand() { calls.push("command-owned"); return command(); },
    async claimCommand(_owner: unknown, _id: string, _command: string, expected: number) {
      calls.push("claim-committed"); if (state !== "PREPARED" || expected !== version) return null;
      state = "SUBMITTING"; version++; return command();
    },
    async recordCommandOutcome(_owner: unknown, _id: string, _command: string, _version: number, outcome: { state: string; responseBody: unknown }) {
      calls.push("outcome-committed"); state = outcome.state; version++; return { ...command(), responseBody: outcome.responseBody };
    },
  };
  const client = { config: { checkoutWrite: true }, connector: { async createCheckout(input: unknown, key: string) {
    calls.push("POST"); posts++; assert.equal(state, "SUBMITTING"); assert.equal(JSON.stringify(input), body); assert.equal(key, "persisted-key-182");
    return { checkout: { status: "pending" } };
  } } };
  // Deliberately partial doubles of dependencies; this is not a typecheck of
  // PF composition and never supplies a production fallback repository.
  const context = { owner, repository, client } as unknown as Parameters<typeof submitApprovedCheckout>[0];
  return { context, enrollment, repository, client, calls, posts: () => posts };
}

test("#182 checkout uses owned persisted approval, commits command and CAS before exactly one POST", async () => {
  const f = fixture();
  assert.deepEqual(await submitApprovedCheckout(f.context, "enrollment", "intent"), { commandId: "command", state: "UNKNOWN", applied: false });
  assert.deepEqual(f.calls, ["owned", "reserve-committed", "command-owned", "claim-committed", "POST", "outcome-committed"]);
  assert.equal(f.posts(), 1);
  await submitApprovedCheckout(f.context, "enrollment", "intent");
  assert.equal(f.posts(), 1, "UNKNOWN cannot claim or POST again");
});

test("#182 missing/foreign approval and missing phone fail before reservation or provider call", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.enrollment.customerProvenance.sourceReference = ""; },
    (f: ReturnType<typeof fixture>) => { f.enrollment.customerProvenance.approvedByAdminUserId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { f.enrollment.customer.phone = ""; },
    (f: ReturnType<typeof fixture>) => { f.enrollment.approvedPriceVersionId = ""; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(submitApprovedCheckout(f.context, "enrollment", "intent"), (error: unknown) => error instanceof PagaYaError && error.status === 503);
    assert.deepEqual(f.calls, ["owned"]); assert.equal(f.posts(), 0);
  }
});

test("#182 losing CAS race cannot submit a second charge", async () => {
  const f = fixture();
  f.repository.claimCommand = async () => { f.calls.push("lost-CAS"); return null; };
  await assert.rejects(submitApprovedCheckout(f.context, "enrollment", "intent"), (error: unknown) => error instanceof PagaYaError && error.status === 409);
  assert.equal(f.posts(), 0);
});

test("#182 concurrent wrapper calls produce one POST through the winning CAS only", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    submitApprovedCheckout(f.context, "enrollment", "intent"),
    submitApprovedCheckout(f.context, "enrollment", "intent"),
  ]);
  assert.equal(f.posts(), 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("#182 unknown checkout outcome remains recorded and cannot auto-submit again", async () => {
  const f = fixture();
  let attempts = 0;
  f.client.connector.createCheckout = async () => {
    attempts++; throw new PagaYaError("transport_error", { outcomeUnknown: true });
  };
  await assert.rejects(submitApprovedCheckout(f.context, "enrollment", "intent"), PagaYaError);
  assert.ok(f.calls.includes("outcome-committed"));
  assert.deepEqual(await submitApprovedCheckout(f.context, "enrollment", "intent"), { commandId: "command", state: "UNKNOWN", applied: false });
  assert.equal(attempts, 1);
});

test("#182 wrong owner cannot prepare a checkout from a foreign enrollment", async () => {
  const f = fixture(); f.enrollment.adminUserId = "foreign";
  await assert.rejects(submitApprovedCheckout(f.context, "enrollment", "intent"), (error: unknown) => error instanceof PagaYaError && error.status === 404);
  assert.deepEqual(f.calls, ["owned"]); assert.equal(f.posts(), 0);
});
