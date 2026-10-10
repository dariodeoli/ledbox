import assert from "node:assert/strict";
import { test } from "node:test";
import { TARGET, OWNER_SESSION, readPlan, validateCapture, runReadOnlyCase } from "../scripts/pilot-ops-calendar-flow.mjs";
import { HEAVY_ISSUER } from "../scripts/pilot-differential.mjs";

// New differential association fixtures. No product handler/DB/browser and no accepted-suite matrix.
function fixture() {
  const expected = { ...TARGET, organizationId: "own-company-x", role: "VIEWER",
    range: { from: "2026-11-09", to: "2026-11-10", fromAt: "2026-11-09T03:00:00.000Z", untilAt: "2026-11-11T03:00:00.000Z" },
    inventory: [{ id: "inventory-own", organizationId: "own-company-x", name: "Independent rack", sku: "OWN-RACK" }],
    events: [{ id: "span-own", organizationId: "own-company-x", name: "Boundary carry-in", clientId: "client-own", status: "CONFIRMED",
      startsAt: "2026-11-08T19:00:00.000Z", endsAt: "2026-11-10T03:00:00.000Z", setupAt: "2026-11-08T17:00:00.000Z", strikeAt: null },
    { id: "edge-ended", organizationId: "own-company-x", name: "Ends exactly at range boundary", clientId: "client-own", status: "CONFIRMED",
      startsAt: "2026-11-08T12:00:00.000Z", endsAt: "2026-11-09T03:00:00.000Z", setupAt: null, strikeAt: null }] };
  const plan = readPlan(expected.range);
  const capture = { responses: plan.map(request => ({ ...request, status: 200 })), visual: { viewportWidth: 390,
    selector: { label: "Vista de eventos", visible: true, options: ["list", "grid", "calendar"], selected: "calendar", left: 16, width: 358 },
    calendarViews: ["month", "week", "next30", "twoMonths"], mutatingActions: [], rows: expected.events.slice(0, 1).map(event => ({ eventId: event.id, title: event.name, clientId: event.clientId, startsAt: event.startsAt, endsAt: event.endsAt })) } };
  capture.responses[0].body = { inventory: expected.inventory.map(({ organizationId, ...row }) => row) };
  capture.responses[1].body = { events: expected.events.map(({ clientId, ...row }) => ({ ...row, client: { id: clientId } })) };
  capture.responses[2].body = { range: { from: expected.range.from, to: expected.range.to }, alerts: [], items: [{ id: "event:span-own", kind: "event", title: "Boundary carry-in", href: "/eventos", date: "2026-11-09", at: "2026-11-08T19:00:00.000Z", endAt: "2026-11-10T03:00:00.000Z", endDate: "2026-11-10" }] };
  return { expected, capture };
}
test("new carry-in association and original dates validate without fabricating runtime flow PASS", () => {
  const f = fixture(), before = structuredClone(f); const result = validateCapture(f.capture, f.expected);
  assert.equal(result.productFlowPASS, false); assert.equal(result.runtimeExecuted, false); assert.equal(result.rows.overlaps, 1); assert.deepEqual(f, before);
});
for (const [name, mutate, pattern] of [
  ["foreign inventory ID", f => { f.capture.responses[0].body.inventory[0].id = "foreign-rack"; }, /Foreign/],
  ["foreign organization in event row", f => { f.capture.responses[1].body.events[0].organizationId = "other-company"; }, /Foreign/],
  ["inventory row name swapped", f => { f.capture.responses[0].body.inventory[0].name = "Different rack"; }, /association/],
  ["event-client association swapped", f => { f.capture.responses[1].body.events[0].client.id = "foreign-client"; }, /association/],
  ["event original date replaced with visible anchor", f => { f.capture.responses[1].body.events[0].startsAt = f.expected.range.fromAt; }, /Original event/],
  ["calendar original at clipped", f => { f.capture.responses[2].body.items[0].at = f.expected.range.fromAt; }, /original limits/],
  ["visible anchor left outside window", f => { f.capture.responses[2].body.items[0].date = "2026-11-08"; }, /anchor/],
  ["foreign event marker replaces owned one", f => { f.capture.responses[2].body.items[0].id = "event:foreign"; }, /association/],
  ["half-open boundary is not carry-in", f => { f.capture.responses[2].body.items.push({ ...f.capture.responses[2].body.items[0], id: "event:edge-ended" }); }, /Overlap count/],
  ["duplicate inventory IDs", f => { f.capture.responses[0].body.inventory.push(f.capture.responses[0].body.inventory[0]); }, /duplicate/],
  ["hidden390selector", f => { f.capture.visual.selector.visible = false; }, /hidden/],
  ["390selector clipped", f => { f.capture.visual.selector.width = 400; }, /clipped/],
  ["calendar omitted from selector", f => { f.capture.visual.selector.options = ["list", "grid"]; }, /selector association/],
  ["VIEWER has mutation action", f => { f.capture.visual.mutatingActions = ["edit"]; }, /VIEWER/],
  ["summary dates altered", f => { f.capture.visual.rows[0].endsAt = f.expected.range.untilAt; }, /summary/],
  ["wrong endpoint response association", f => { f.capture.responses[0].path = "/api/admin/signatures"; }, /route/],
  ["mutation method forbidden", f => { f.capture.responses[0].method = "POST"; }, /route/],
]) test(name, () => { const f = fixture(); mutate(f); assert.throws(() => validateCapture(f.capture, f.expected), pattern); });

test("no visual capture explicitly remains unexecuted", () => { const f = fixture(); delete f.capture.visual; assert.equal(validateCapture(f.capture, f.expected).visual, "NOT_RUN_MISSING_CAPTURE"); });
test("disconnected or absent custody/session/DIRECT does not call any network adapter", async () => {
  let calls = 0; const f = fixture(); const result = await runReadOnlyCase({}, f.expected, { transport: () => { calls++; throw Error("Network must not be called"); } });
  assert.equal(calls, 0); assert.equal(result.requests, 0); assert.equal(result.status, "WAIT_INPUT"); assert(result.missing.some(item => item.includes("DIRECT")));
});
function context() {
  const now = Date.now(); return { channel: { connected: true, ownerSession: OWNER_SESSION }, organizationId: "own-company-x", session: { authorized: true, bindingID: "synthetic-session-reference-only", role: "VIEWER", organizationId: "own-company-x" },
    runtime: { ...TARGET, origin: "http://127.0.0.1:3199", custodyApproved: true, bindingEvidenceSHA256: "a".repeat(64) },
    readScope: { authorized: true, effects: "NONE", viewedAtAllowed: false },
    direct: { issuerSession: HEAVY_ISSUER, kind: "DIRECT", granted: true, sha: TARGET.sha, action: "ops-calendar-readonly", startsAt: new Date(now - 1000).toISOString(), startBy: new Date(now + 1000).toISOString(), expiresAt: new Date(now + 10000).toISOString(), maxDurationMs: 10000 } };
}
for (const [name, mutate] of [
  ["channel disconnected", c => { c.channel.connected = false; }],
  ["foreign session browser", c => { c.channel.ownerSession = "another-session"; }],
  ["unknown session role", c => { c.session.role = ""; }],
  ["company mismatch", c => { c.session.organizationId = "other-company"; }],
  ["custody missing", c => { c.runtime.custodyApproved = false; }],
  ["wrong runtime SHA", c => { c.runtime.sha = "b".repeat(40); }],
  ["viewedAt read scope", c => { c.readScope.effects = "VIEWED_AT"; }],
  ["expired DIRECT", c => { c.direct.expiresAt = new Date(Date.now() - 1).toISOString(); }],
]) test(`${name} fails closed before transport`, async () => { let calls = 0; const c = context(); mutate(c); const result = await runReadOnlyCase(c, fixture().expected, { transport: () => { calls++; } }); assert.equal(result.status, "WAIT_INPUT"); assert.equal(calls, 0); });
test("injected synthetic adapter validates only three allowed GETs, never authenticates or fetches", async () => {
  const f = fixture(), calls = []; const result = await runReadOnlyCase(context(), f.expected, { transport: async request => { calls.push(request); const row = f.capture.responses.find(item => item.path === request.path); return { status: 200, body: row.body }; }, observe: async () => f.capture.visual });
  assert.equal(calls.length, 3); assert(calls.every(request => request.method === "GET" && request.redirect === "manual" && request.effects === "NONE")); assert.equal(result.productFlowPASS, false);
});
