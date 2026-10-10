import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.CALENDAR_TEST_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("calendar HTTP PG independent overlap oracle, projection, boundaries, nulls and tenancy", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(), suffix = randomUUID(), org = `calendar-${suffix}`;
  const probes: Array<{ name: string; pass: boolean; detail: unknown }> = [];
  const probe = (name: string, pass: boolean, detail: unknown) => probes.push({ name, pass, detail });
  try {
    const { createSession } = await import("../lib/server/auth");
    await db.organization.create({ data: { id: org, slug: org, name: "Calendar overlap oracle" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "Calendar QA", email: `${suffix}@example.invalid`, passwordHash: "not-a-login", role: "OWNER", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Calendar client" } });
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const from = new Date("2030-01-10T00:00:00-03:00"), to = new Date("2030-01-13T00:00:00-03:00");
    const zone = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" });
    const day = (at: Date) => { const parts = zone.formatToParts(at); return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("-"); };
    probe("independent Asuncion boundaries", day(from) === "2030-01-10" && day(new Date(to.getTime() - 1)) === "2030-01-12", { from: from.toISOString(), exclusiveTo: to.toISOString() });
    const d = (text: string | null) => text ? new Date(`2030-01-${text}-03:00`) : null;
    const fixtures = [
      { name: "container", s: "01T10:00:00", e: "31T20:00:00" },
      { name: "interior", s: "10T09:00:00", e: "11T10:00:00" },
      { name: "left crossing", s: "08T10:00:00", e: "11T10:00:00" },
      { name: "right crossing", s: "11T10:00:00", e: "20T10:00:00" },
      { name: "ends at inclusive start", s: "06T10:00:00", e: "10T00:00:00" },
      { name: "starts at exclusive end", s: "13T00:00:00", e: "15T10:00:00" },
      { name: "instant at inclusive start", s: "10T00:00:00", e: "10T00:00:00" },
      { name: "last millisecond", s: "12T23:59:59.999", e: null },
      { name: "unknown end in window", s: "11T10:00:00", e: null },
      { name: "unknown end before window", s: "08T10:00:00", e: null },
      { name: "only end", s: null, e: "11T10:00:00" },
      { name: "all null", s: null, e: null },
      { name: "same day duration", s: "11T09:00:00", e: "11T20:00:00" },
      { name: "invalid stored duration", s: "12T10:00:00", e: "11T10:00:00" },
    ].map(row => ({ ...row, id: randomUUID(), startsAt: d(row.s), endsAt: d(row.e) }));
    for (const row of fixtures) await db.event.create({ data: { id: row.id, organizationId: org, clientId: client.id, name: row.name, startsAt: row.startsAt, endsAt: row.endsAt } });
    const setupId = randomUUID();
    await db.event.create({ data: { id: setupId, organizationId: org, clientId: client.id, name: "Real setup/strike", setupAt: d("10T08:00:00"), startsAt: d("08T10:00:00"), endsAt: d("09T10:00:00"), strikeAt: d("12T22:00:00") } });
    await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Cancelled container", status: "CANCELLED", startsAt: d("01T10:00:00"), endsAt: d("31T20:00:00") } });
    const foreignOrg = `foreign-${suffix}`;
    await db.organization.create({ data: { id: foreignOrg, slug: foreignOrg, name: "Other tenant" } });
    const foreignClient = await db.client.create({ data: { id: randomUUID(), organizationId: foreignOrg, name: "Other client" } });
    await db.event.create({ data: { id: randomUUID(), organizationId: foreignOrg, clientId: foreignClient.id, name: "Foreign container", startsAt: d("01T10:00:00"), endsAt: d("31T20:00:00") } });
    const request = (query: string, auth = true) => fetch(`${base}/api/admin/calendar${query}`, { headers: auth ? { Cookie: cookie } : {}, redirect: "manual" });
    const response = await request("?from=2030-01-10&to=2030-01-12");
    assert.equal(response.status, 200); const body = await response.json();
    const items = body.items as Array<{ id: string; kind: string; date: string; at: string; endAt: string | null; endDate: string | null; title: string }>;
    const inside = (at: Date | null) => Boolean(at && at >= from && at < to);
    for (const row of fixtures) {
      const duration = Boolean(row.startsAt && row.endsAt && row.endsAt > row.startsAt);
      const expected = duration ? row.startsAt! < to && row.endsAt! > from : inside(row.startsAt ?? row.endsAt);
      const markers = items.filter(item => item.id === `event:${row.id}`);
      probe(`event membership: ${row.name}`, markers.length === Number(expected), { expected, actual: markers });
      if (expected && markers.length === 1) {
        const at = row.startsAt ?? row.endsAt!;
        const anchor = at < from ? day(from) : day(at);
        probe(`real projection: ${row.name}`, markers[0].date === anchor && markers[0].at === at.toISOString() && markers[0].endAt === (duration ? row.endsAt!.toISOString() : null), { expectedAnchor: anchor, originalStart: at.toISOString(), marker: markers[0] });
      }
    }
    probe("end at start remains a real endpoint only", items.some(item => item.id === `event_end:${fixtures[4].id}`), items.filter(item => item.id.includes(fixtures[4].id)));
    probe("setup/strike real points without duplicate duration", items.filter(item => item.id.endsWith(setupId)).map(item => item.kind).sort().join() === "setup,strike", items.filter(item => item.id.endsWith(setupId)));
    probe("unique marker IDs", new Set(items.map(item => item.id)).size === items.length, items.map(item => item.id));
    probe("all markers visible inside calendar days", items.every(item => item.date >= "2030-01-10" && item.date <= "2030-01-12"), items);
    probe("organization and cancelled isolation", !items.some(item => /Foreign|Cancelled/.test(item.title)), items.map(item => item.title));
    for (const query of ["?from=2030-02-30&to=2030-03-01", "?from=2030-01-12&to=2030-01-10", "?from=2030-01-01&to=2031-02-05", "?from=null&to=2030-01-12"]) {
      const result = await request(query); probe(`invalid query ${query}`, result.status === 400, { status: result.status });
    }
    const single = await request("?from=2030-01-10&to=2030-01-10"); probe("inclusive one-day range", single.status === 200, { status: single.status });
    const unauthenticated = await request("?from=2030-01-10&to=2030-01-12", false); probe("session required", unauthenticated.status === 401, { status: unauthenticated.status });
    const report = { status: probes.every(p => p.pass) ? "PASS" : "FAIL", oracle: "half-open real duration/point; explicit Asuncion boundaries independent of implementation", phase: process.env.CALENDAR_TEST_PHASE ?? "candidate", probes, range: body.range };
    if (process.env.CALENDAR_EVIDENCE_DIR) { mkdirSync(process.env.CALENDAR_EVIDENCE_DIR, { recursive: true }); writeFileSync(join(process.env.CALENDAR_EVIDENCE_DIR, "overlap-oracle.json"), JSON.stringify(report, null, 2)); }
    assert.deepEqual(probes.filter(p => !p.pass).map(p => p.name), []);
  } finally { await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
