#!/usr/bin/env node
/** Same Pilot #173 next case. Offline oracle by default; no implicit fetch/browser/session creation. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireDirect } from "./pilot-differential.mjs";

export const TARGET = Object.freeze({ sha: "58989b88af3d6072161261befa377507f23d0ca8", version: "2.1.76" });
export const OWNER_SESSION = "ses_edd4b1140fferLmUS0BHqptx22";
const roles = new Set(["OWNER", "ADMIN", "OPERATIONS", "FINANCE", "VIEWER"]);
const check = (value, message) => { if (!value) throw new Error(message); };
const instant = value => { check(typeof value === "string" && Number.isFinite(Date.parse(value)), "Invalid original timestamp"); return Date.parse(value); };
const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = value => { const p = Object.fromEntries(dayFormatter.formatToParts(new Date(instant(value))).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const uniqueRows = (rows, label) => { check(Array.isArray(rows), `${label} rows missing`); check(new Set(rows.map(row => row.id)).size === rows.length, `${label} duplicate ID`); };

export function readPlan(range) {
  check(/^\d{4}-\d{2}-\d{2}$/.test(range?.from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(range?.to ?? "") && range.from <= range.to, "Invalid calendar range");
  return [
    { method: "GET", path: "/api/admin/inventory?fields=selector" },
    { method: "GET", path: "/api/admin/event-ops?fields=panel" },
    { method: "GET", path: `/api/admin/calendar?from=${range.from}&to=${range.to}` },
  ];
}

export function missingAccess(context, now = Date.now()) {
  const missing = [];
  if (context?.channel?.connected !== true || context.channel.ownerSession !== OWNER_SESSION) missing.push("Known authorized channel connected to original Pilot session");
  if (context?.session?.authorized !== true || !context.session.bindingID) missing.push("Owner-approved preexisting authenticated session binding (no token fabrication)");
  if (!roles.has(context?.session?.role)) missing.push("Known scoped role");
  if (!context?.session?.organizationId || context.session.organizationId !== context?.organizationId) missing.push("Session membership bound to expected organization");
  if (context?.runtime?.sha !== TARGET.sha || context.runtime.version !== TARGET.version || !context.runtime.custodyApproved
    || !context.runtime.bindingEvidenceSHA256?.match(/^[a-f0-9]{64}$/)) missing.push("Current target58989 runtime custody and source-bound existing evidence");
  if (context?.readScope?.authorized !== true || context.readScope.effects !== "NONE" || context.readScope.viewedAtAllowed !== false) missing.push("Owner-authorized effect-free allowlisted GET scope; no viewedAt probe");
  try { requireDirect(context?.direct, TARGET, "ops-calendar-readonly", now); } catch { missing.push("Current original-issuer target-bound DIRECT ops-calendar-readonly"); }
  return missing;
}

/** Checks caller-supplied captured rows against a trusted scoped fixture manifest, not invented org fields. */
export function validateCapture(capture, expected) {
  check(expected?.sha === TARGET.sha && expected.version === TARGET.version && expected.organizationId, "Expectation target/company mismatch");
  check(roles.has(expected.role), "Expected role missing");
  const plan = readPlan(expected.range);
  check(Array.isArray(capture?.responses) && capture.responses.length === plan.length, "Exactly three read responses required");
  for (let i = 0; i < plan.length; i++) check(capture.responses[i].method === "GET" && capture.responses[i].path === plan[i].path
    && capture.responses[i].status === 200, "Read route/status association mismatch");
  const inventory = capture.responses[0].body?.inventory, events = capture.responses[1].body?.events;
  uniqueRows(inventory, "Inventory"); uniqueRows(events, "Event ops");
  check(Array.isArray(expected.inventory) && expected.inventory.length > 0 && Array.isArray(expected.events) && expected.events.length > 0, "Nonzero trusted fixtures required");
  for (const row of inventory) {
    const source = expected.inventory.find(item => item.id === row.id);
    check(source && source.organizationId === expected.organizationId, "Foreign/unbound inventory row");
    check(row.name === source.name && row.sku === source.sku, "Inventory row identity association mismatch");
    if (row.organizationId !== undefined) check(row.organizationId === expected.organizationId, "Inventory organization leak");
  }
  for (const source of expected.inventory) check(inventory.some(row => row.id === source.id), "Owned inventory fixture missing");
  for (const row of events) {
    const source = expected.events.find(event => event.id === row.id);
    check(source && source.organizationId === expected.organizationId && row.organizationId === expected.organizationId, "Foreign/unbound event row");
    check(row.name === source.name && row.client?.id === source.clientId && row.status === source.status, "Event/client row association mismatch");
    for (const field of ["startsAt", "endsAt", "setupAt", "strikeAt"]) check(row[field] === source[field], "Original event dates changed");
  }
  for (const source of expected.events) check(events.some(row => row.id === source.id), "Owned event fixture missing");
  const calendar = capture.responses[2].body;
  check(calendar?.range?.from === expected.range.from && calendar.range.to === expected.range.to, "Calendar response range mismatch");
  uniqueRows(calendar.items, "Calendar");
  const from = instant(expected.range.fromAt), until = instant(expected.range.untilAt);
  check(dayKey(expected.range.fromAt) === expected.range.from && until > from && dayKey(new Date(until - 1).toISOString()) === expected.range.to, "Range timestamp/day-key mismatch");
  const markers = calendar.items.filter(item => item.kind === "event");
  const required = expected.events.filter(event => event.status !== "CANCELLED" && event.startsAt && event.endsAt
    && instant(event.endsAt) > instant(event.startsAt) && instant(event.startsAt) < until && instant(event.endsAt) > from);
  check(required.length > 0, "Nonzero overlap fixture required");
  check(markers.length === required.length, "Overlap count mismatch");
  for (const source of required) {
    const marker = markers.find(item => item.id === `event:${source.id}`);
    check(marker && marker.title === source.name && marker.href === "/eventos", "Calendar event row association mismatch");
    check(marker.at === source.startsAt && marker.endAt === source.endsAt && marker.endDate === dayKey(source.endsAt), "Calendar original limits clipped/changed");
    const visibleDay = instant(source.startsAt) < from ? expected.range.from : dayKey(source.startsAt);
    check(marker.date === visibleDay, "Visible overlap anchor mismatch");
  }
  const visual = capture.visual;
  const visualMissing = !visual;
  if (visual) {
    check(visual.viewportWidth === 390 && visual.selector?.label === "Vista de eventos" && visual.selector.visible === true, "390 calendar selector missing/hidden");
    check(visual.selector.options?.includes("calendar") && visual.selector.selected === "calendar", "Calendar selector association mismatch");
    check(Number.isFinite(visual.selector.left) && Number.isFinite(visual.selector.width) && visual.selector.left >= 0
      && visual.selector.width > 0 && visual.selector.left + visual.selector.width <= 390, "Calendar selector clipped");
    check(["month", "week", "next30", "twoMonths"].every(view => visual.calendarViews?.includes(view)), "Calendar view options missing");
    if (expected.role === "VIEWER") check(Array.isArray(visual.mutatingActions) && visual.mutatingActions.length === 0, "VIEWER mutation action exposed");
    check(Array.isArray(visual.rows), "Visual row observations missing");
    for (const source of required) {
      const row = visual.rows.find(item => item.eventId === source.id);
      check(row && row.title === source.name && row.clientId === source.clientId
        && row.startsAt === source.startsAt && row.endsAt === source.endsAt, "Visual summary original dates/row association mismatch");
    }
  }
  return { status: "OFFLINE_CAPTURE_VALIDATED_NOT_PRODUCT_PASS", sha: TARGET.sha, role: expected.role,
    organizationId: expected.organizationId, rows: { inventory: inventory.length, events: events.length, overlaps: required.length },
    visual: visualMissing ? "NOT_RUN_MISSING_CAPTURE" : "SUPPLIED_OBSERVATION_VALIDATED_NOT_BROWSER_EXECUTION",
    runtimeExecuted: false, productFlowPASS: false, excluded: ["FIN", "services", "mobile implementation", "RUC", "mutations", "viewedAt probes"] };
}

/** Transport is explicitly supplied by an approved owner adapter. Missing inputs never call it. */
export async function runReadOnlyCase(context, expected, { transport, observe, now = Date.now() } = {}) {
  const missing = missingAccess(context, now);
  if (typeof transport !== "function") missing.push("Authorized scoped read transport adapter");
  if (missing.length) return { status: "WAIT_INPUT", missing, requests: 0, productFlowPASS: false };
  check(expected.sha === TARGET.sha && expected.version === TARGET.version, "Fixture target mismatch before transport");
  check(expected.organizationId === context.organizationId && expected.role === context.session.role, "Fixture/session scope mismatch");
  const origin = new URL(context.runtime.origin);
  check(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === "/"
    && (origin.origin === "https://app.ledbox.online" || (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname) && origin.port)), "Runtime origin not allowlisted");
  const deadline = Math.min(now + context.direct.maxDurationMs, Date.parse(context.direct.expiresAt));
  const responses = [];
  for (const request of readPlan(expected.range)) {
    check(Date.now() < deadline, "DIRECT deadline exhausted");
    const response = await transport({ ...request, origin: origin.origin, redirect: "manual", effects: "NONE",
      signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))) });
    check(response?.status === 200 && response.redirected !== true && (!response.url || response.url === origin.origin + request.path), "Read rejected/redirected; stop without mutation");
    responses.push({ ...request, status: response.status, body: response.body });
  }
  // This observer is a preexisting authorized channel adapter, never a browser launcher.
  check(!observe || Date.now() < deadline, "DIRECT deadline exhausted before observer");
  const visual = observe ? await observe({ effects: "NONE", viewportWidth: 390, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }) : undefined;
  const result = validateCapture({ responses, visual }, expected);
  return { ...result, status: "AUTHORIZED_READONLY_CAPTURE_CHECKED_NOT_GLOBAL_PASS", runtimeExecuted: true,
    visual: visual ? "AUTHORIZED_CHANNEL_OBSERVATION_CHECKED" : "NOT_RUN_MISSING_CAPTURE", requests: responses.length, productFlowPASS: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    check(process.argv.length === 4, "Offline only: node scripts/pilot-ops-calendar-flow.mjs <capture.json> <expectations.json>");
    console.log(JSON.stringify(validateCapture(JSON.parse(readFileSync(process.argv[2], "utf8")), JSON.parse(readFileSync(process.argv[3], "utf8"))), null, 2));
  } catch (error) { console.error(`[ops-calendar] REJECTED: ${error.message}`); process.exitCode = 1; }
}
