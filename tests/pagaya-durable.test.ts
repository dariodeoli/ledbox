import assert from "node:assert/strict";
import { test } from "node:test";
import { PagaYaRepository, PagaYaPersistenceError, pagayaCommandBody, type PagaYaDatabase, type PagaYaTx } from "../lib/server/pagaya/repository";
import { persistPagaYaInboxEvent, receivePagaYaWebhook } from "../lib/server/pagaya/inbox";
import { confirmedPagaYaPeriod, reconcilePagaYaPeriodAccess } from "../lib/server/pagaya/period-access";
import type { PagaYaCommand, PagaYaEnrollment, PagaYaInboxEvent, PagaYaOwner, PagaYaSubscriptionRead, PagaYaWebhookAdapter } from "../lib/server/pagaya/types";

const owner: PagaYaOwner = { organizationId: "tenant", adminUserId: "user", appId: "app", mode: "test" };
const enrollment: PagaYaEnrollment = { ...owner, id: "enrollment", externalReference: "opaque-enrollment",
  approvedPriceVersionId: "approved-price", customer: { name: "Ana", email: "ana@example.com", phone: "+595981123456" },
  customerProvenance: { sourceReference: "owner-approved-profile", approvedByAdminUserId: "user", approvedAt: "2026-10-12T00:00:00Z" },
  checkoutId: null, subscriptionId: null };
const body = { priceVersionId: enrollment.approvedPriceVersionId, externalReference: enrollment.externalReference, customer: enrollment.customer };
const event: PagaYaInboxEvent = { id: "event", type: "invoice.paid", appId: "app", mode: "test",
  externalReference: enrollment.externalReference, checkoutId: null, subscriptionId: null };
type State = { enrollment: PagaYaEnrollment; commands: PagaYaCommand[]; events: Record<string, { enrollmentId: string; appId: string; mode: string; payloadSHA256: string }>; periods: { startsAt: Date; endsAt: Date }[] };

/** Parameterized-SQL transaction double with rollback/commit gate and modeled
 * unique/CAS results. This is NOT native SQL, constraint or durability proof.
 * The production repository contains no memory implementation or fallback. */
function database(initial: PagaYaEnrollment = enrollment) {
  let state: State = { enrollment: structuredClone(initial), commands: [], events: {}, periods: [] };
  let tail = Promise.resolve();
  let failCommit = false;
  let beforeCommit: (() => Promise<void>) | undefined;
  const queries: string[] = [];
  const database: PagaYaDatabase = { async $transaction<T>(work: (tx: PagaYaTx) => Promise<T>) {
    const prior = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    const draft = structuredClone(state);
    const execute = async (strings: TemplateStringsArray, ...v: unknown[]) => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim();
      queries.push(sql);
      if (sql.startsWith("SELECT e.*")) {
        assert.match(sql, /FOR UPDATE OF e/);
        const e = draft.enrollment;
        return [e.id, e.organizationId, e.adminUserId, e.appId, e.mode].every((value, index) => value === v[index]) ? [structuredClone(e)] : [];
      }
      if (sql.startsWith('SELECT * FROM "PagaYaCommand"')) {
        return draft.commands.filter(c => sql.includes('"intentId"') ? c.enrollmentId === v[0] && c.kind === v[1] && c.intentId === v[2]
          : c.id === v[0] && c.enrollmentId === v[1]).map(c => structuredClone(c));
      }
      if (sql.startsWith('SELECT "id" FROM "PagaYaCommand"')) {
        return draft.commands.filter(c => c.enrollmentId === v[0] && c.kind === v[1] && ["PREPARED", "SUBMITTING", "UNKNOWN"].includes(c.state));
      }
      if (sql.startsWith('INSERT INTO "PagaYaCommand"')) {
        if (draft.commands.some(c => c.commandKey === v[6])) throw new Error("MOCK_UNIQUE_COMMAND_KEY");
        const c = { id: v[0], enrollmentId: v[1], intentId: v[4], kind: v[5], commandKey: v[6], resourceId: v[7],
          requestBody: v[8], bodySHA256: v[9], state: "PREPARED", version: 0, responseBody: null } as PagaYaCommand;
        draft.commands.push(c); return [structuredClone(c)];
      }
      if (sql.startsWith('UPDATE "PagaYaCommand"') && sql.includes("'SUBMITTING',")) {
        assert.match(sql, /"state"='PREPARED' AND "version"=\?/);
        const c = draft.commands.find(c => c.id === v[0] && c.enrollmentId === v[1] && c.state === "PREPARED" && c.version === v[2]);
        if (!c) return [];
        c.state = "SUBMITTING"; c.version++; return [structuredClone(c)];
      }
      if (sql.startsWith('UPDATE "PagaYaCommand"')) {
        const c = draft.commands.find(c => c.id === v[2] && c.enrollmentId === v[3] && c.version === v[4]
          && (c.state === "SUBMITTING" || (c.state === "UNKNOWN" && v[0] !== "UNKNOWN")));
        if (!c) return [];
        c.state = v[0] as PagaYaCommand["state"]; c.responseBody = JSON.parse(v[1] as string); c.version++; return [structuredClone(c)];
      }
      if (sql.startsWith('UPDATE "PagaYaEnrollment" SET "checkoutId"')) {
        draft.enrollment.checkoutId = v[0] as string; draft.enrollment.subscriptionId = v[1] as string | null;
        return [structuredClone(draft.enrollment)];
      }
      if (sql.startsWith('UPDATE "PagaYaEnrollment"')) return 1;
      if (sql.startsWith('SELECT * FROM "PagaYaEnrollment"')) {
        const e = draft.enrollment;
        return e.appId === v[0] && e.mode === v[1] && (v[2] === null || v[2] === e.externalReference)
          && (v[4] === null || v[4] === e.checkoutId) && (v[6] === null || v[6] === e.subscriptionId) ? [structuredClone(e)] : [];
      }
      if (sql.startsWith('INSERT INTO "PagaYaInboxEvent"')) {
        assert.match(sql, /ON CONFLICT \("id"\) DO NOTHING/);
        assert.match(sql, /'PENDING',0/);
        if (draft.events[v[0] as string]) return [];
        draft.events[v[0] as string] = { enrollmentId: v[1] as string, appId: v[2] as string, mode: v[3] as string, payloadSHA256: v[7] as string };
        return [{ id: v[0] }];
      }
      if (sql.startsWith('SELECT "enrollmentId"')) return [draft.events[v[0] as string]].filter(Boolean);
      if (sql.startsWith('INSERT INTO "PagaYaAccessPeriod"')) {
        assert.match(sql, /ON CONFLICT \("enrollmentId","startsAt","endsAt"\) DO NOTHING/);
        const start = v[6] as Date, end = v[7] as Date;
        if (draft.periods.some(p => +p.startsAt === +start && +p.endsAt === +end)) return 0;
        draft.periods.push({ startsAt: start, endsAt: end }); return 1;
      }
      if (sql.startsWith("SELECT COALESCE")) {
        const now = v[0] as Date;
        return [{ hasAccess: draft.periods.some(p => +p.startsAt <= +now && +p.endsAt > +now),
          confirmedThrough: draft.periods.length ? new Date(Math.max(...draft.periods.map(p => +p.endsAt))) : null }];
      }
      throw new Error("UNMODELED_QUERY:" + sql);
    };
    try {
      const result = await work({ $queryRaw: execute, $executeRaw: execute } as unknown as PagaYaTx);
      if (beforeCommit) await beforeCommit();
      if (failCommit) throw new Error("MOCK_STORAGE_COMMIT_FAILED");
      state = draft;
      return result;
    } finally { release(); }
  } };
  return { repository: new PagaYaRepository(database), queries, get state() { return state; },
    failCommit() { failCommit = true; }, beforeCommit(callback: () => Promise<void>) { beforeCommit = callback; } };
}
const code = (expected: string) => (error: unknown) => error instanceof PagaYaPersistenceError && error.code === expected;

test("immutable checkout intent retains exact body/key and rejects changed price or customer", async () => {
  const db = database();
  const c = await db.repository.reserveCommand(owner, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body });
  const replay = await db.repository.reserveCommand(owner, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body: { customer: body.customer, externalReference: body.externalReference, priceVersionId: body.priceVersionId } });
  assert.deepEqual(replay, c);
  await assert.rejects(db.repository.reserveCommand(owner, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body, commandKey: "different-key" }), code("immutable_command_conflict"));
  for (const changed of [{ ...body, priceVersionId: "browser-price" }, { ...body, customer: { ...body.customer, phone: "+595999999999" } }]) {
    await assert.rejects(db.repository.reserveCommand(owner, enrollment.id, { intentId: "other", kind: "CHECKOUT", body: changed }), code("checkout_enrollment_mismatch"));
  }
  assert.equal(db.state.commands.length, 1);
});

test("two CAS claims authorize only one submit; UNKNOWN cannot reset or mint another intent", async () => {
  const db = database();
  const c = await db.repository.reserveCommand(owner, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body });
  const claims = await Promise.all([db.repository.claimCommand(owner, enrollment.id, c.id, 0), db.repository.claimCommand(owner, enrollment.id, c.id, 0)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const unknown = await db.repository.recordCommandOutcome(owner, enrollment.id, c.id, 1, { state: "UNKNOWN", responseBody: { pending: true } });
  assert.equal(unknown?.commandKey, c.commandKey);
  assert.equal(unknown?.requestBody, c.requestBody);
  assert.equal(await db.repository.claimCommand(owner, enrollment.id, c.id, 2), null);
  await assert.rejects(db.repository.reserveCommand(owner, enrollment.id, { intentId: "new-charge", kind: "CHECKOUT", body }), code("command_reconciliation_required"));
});

test("owner tenant/user/app/mode mismatches deny before command writes", async () => {
  const db = database();
  for (const foreign of [{ ...owner, organizationId: "foreign" }, { ...owner, adminUserId: "foreign" }, { ...owner, appId: "foreign" }, { ...owner, mode: "live" as const }]) {
    await assert.rejects(db.repository.reserveCommand(foreign, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body }), code("enrollment_not_owned"));
  }
  assert.equal(db.state.commands.length, 0);
});

test("rollback loses a failed reservation, never returns an uncommitted key to a POST caller", async () => {
  const db = database(); db.failCommit();
  await assert.rejects(db.repository.reserveCommand(owner, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body }), /COMMIT_FAILED/);
  assert.equal(db.state.commands.length, 0);
});

test("billing customer must have explicit stored server approval; canonical JSON rejects lossy values", async () => {
  const db = database({ ...enrollment, customerProvenance: { ...enrollment.customerProvenance, sourceReference: "" } });
  await assert.rejects(db.repository.reserveCommand(owner, enrollment.id, { intentId: "intent", kind: "CHECKOUT", body }), code("billing_customer_unavailable"));
  for (const invalid of [undefined, NaN, new Date(), { unsupported: undefined }]) assert.throws(() => pagayaCommandBody(invalid), code("invalid_command_body"));
});

test("envelope id deduplicates across fresh deliveries, changed content with same id fails", async () => {
  const db = database(), payload = { id: event.id, type: event.type };
  assert.deepEqual(await persistPagaYaInboxEvent(db.repository, event, new TextEncoder().encode(JSON.stringify(payload)), payload), { duplicate: false });
  assert.deepEqual(await persistPagaYaInboxEvent(db.repository, event, new TextEncoder().encode('{ "type":"invoice.paid", "id":"event" }'), { type: event.type, id: event.id }), { duplicate: true });
  await assert.rejects(persistPagaYaInboxEvent(db.repository, event, new Uint8Array([1]), { ...payload, changed: true }), code("immutable_webhook_event_conflict"));
  assert.equal(Object.keys(db.state.events).length, 1);
});

function webhookAdapter(verify: PagaYaWebhookAdapter["verifyPagaYaWebhook"]): PagaYaWebhookAdapter {
  return { expectedAppId: "app", expectedMode: "test", webhookSecret: "offline-only", verifyPagaYaWebhook: verify, decodeEvent: () => event };
}
const request = () => new Request("https://example.invalid/api/webhooks/pagaya", { method: "POST", headers: { "x-pagaya-signature": "offline-header" }, body: '{ "id":"event" }' });

test("webhook passes original bytes and ±300 options to verifier before decode/store", async () => {
  const db = database();
  const adapter = webhookAdapter((raw, signature, secret, options) => {
    assert.equal(new TextDecoder().decode(raw), '{ "id":"event" }');
    assert.equal(signature, "offline-header"); assert.equal(secret, "offline-only"); assert.equal(options.toleranceSeconds, 300);
    return false;
  });
  adapter.decodeEvent = () => { throw new Error("must not decode invalid signature"); };
  assert.equal((await receivePagaYaWebhook(request(), db.repository, adapter)).status, 400);
  assert.equal(db.queries.length, 0);
});

test("2xx waits for COMMIT; failed storage rolls back inbox and returns 5xx", async () => {
  const db = database(); let reach!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { reach = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  db.beforeCommit(async () => { reach(); await gate; });
  let responded = false;
  const response = receivePagaYaWebhook(request(), db.repository, webhookAdapter(() => true)).then(result => { responded = true; return result; });
  await reached; assert.equal(responded, false); assert.equal(Object.keys(db.state.events).length, 0);
  release(); assert.equal((await response).status, 204); assert.equal(Object.keys(db.state.events).length, 1);
  const failing = database(); failing.failCommit();
  assert.equal((await receivePagaYaWebhook(request(), failing.repository, webhookAdapter(() => true))).status, 503);
  assert.equal(Object.keys(failing.state.events).length, 0);
});

test("signed wrong app/mode or mismatched saved correlation never acknowledges or stores", async () => {
  for (const changed of [{ ...event, appId: "foreign" }, { ...event, mode: "live" as const }, { ...event, externalReference: "foreign" }]) {
    const db = database(), adapter = webhookAdapter(() => true); adapter.decodeEvent = () => changed;
    assert.ok((await receivePagaYaWebhook(request(), db.repository, adapter)).status >= 400);
    assert.equal(Object.keys(db.state.events).length, 0);
  }
});

const bound = { ...enrollment, checkoutId: "checkout", subscriptionId: "subscription" };
const snapshot: PagaYaSubscriptionRead = { id: "subscription", checkoutId: "checkout", appId: "app", mode: "test", externalReference: enrollment.externalReference,
  status: "active", cancelAtPeriodEnd: false, pendingRenewalMutation: null, paidPeriod: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" } };
const reads = (value: PagaYaSubscriptionRead) => ({ getCheckout: async () => ({ id: "checkout", subscriptionId: "subscription", appId: "app", mode: "test" as const, externalReference: enrollment.externalReference, priceVersionId: enrollment.approvedPriceVersionId }), getSubscription: async () => value });

test("payment+invoice reconciliations record one paid interval, retain it on cancellation/pending202", async () => {
  const db = database(bound), now = new Date("2026-10-12T00:00:00Z");
  assert.equal((await reconcilePagaYaPeriodAccess(db.repository, owner, enrollment.id, reads(snapshot), now)).hasAccess, true);
  const pending = { ...snapshot, cancelAtPeriodEnd: true, pendingRenewalMutation: { status: "submitted" } };
  assert.equal((await reconcilePagaYaPeriodAccess(db.repository, owner, enrollment.id, reads(pending), now)).hasAccess, true);
  assert.equal(db.state.periods.length, 1);
  assert.equal((await reconcilePagaYaPeriodAccess(db.repository, owner, enrollment.id, reads(pending), new Date("2026-11-01T00:00:00Z"))).hasAccess, false);
});

test("status alone grants no trial/access; out-of-order paid periods do not roll back confirmed-through", async () => {
  const db = database(bound), now = new Date("2026-10-12T00:00:00Z");
  assert.equal((await reconcilePagaYaPeriodAccess(db.repository, owner, enrollment.id, reads({ ...snapshot, paidPeriod: null }), now)).hasAccess, false);
  await reconcilePagaYaPeriodAccess(db.repository, owner, enrollment.id, reads(snapshot), now);
  const older = { ...snapshot, paidPeriod: { startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" } };
  const result = await reconcilePagaYaPeriodAccess(db.repository, owner, enrollment.id, reads(older), now);
  assert.equal(result.confirmedThrough, "2026-11-01T00:00:00.000Z"); assert.equal(result.hasAccess, true);
});

test("subscription ownership and actual interval boundaries fail closed without writes", () => {
  assert.throws(() => confirmedPagaYaPeriod(bound, { ...snapshot, checkoutId: "foreign" }), code("subscription_read_binding_mismatch"));
  assert.throws(() => confirmedPagaYaPeriod(bound, { ...snapshot, paidPeriod: { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" } }), code("invalid_paid_period"));
});

test("authoritative checkout must confirm the server-approved price version before binding", async () => {
  const db = database(bound);
  const checkout = await reads(snapshot).getCheckout();
  await assert.rejects(db.repository.saveCheckoutRead(owner, enrollment.id, { ...checkout, priceVersionId: "foreign-price" }), code("checkout_read_binding_mismatch"));
  assert.equal(db.state.enrollment.checkoutId, bound.checkoutId);
  assert.equal(db.state.periods.length, 0);
});
