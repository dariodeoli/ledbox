import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { decodeJwt } from "jose";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AdminMailPreview } from "../components/admin/AdminMailPreview";
import type { MailPreview } from "../lib/mail-preview";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const requireNative = createRequire(import.meta.url);
const routePath = "app/api/admin/budgets/send/route.ts";
const unsafe = '<script>alert("x")</script> & Ana';

/** Actual route, builder, renderer, crypto and JWT. Only external boundaries
 * (DB, session, transport, audit) are doubles. No PG/client generation/provider. */
function fixture(secret: string | undefined = "offline-preview-secret-not-a-real-credential") {
  const state = { organizationId: "tenant", actorId: "actor", denied: false, from: "EventOS <offline@example.invalid>",
    availabilityCalls: 0, availabilityState: "available", availabilityRevision: "revision-1", queries: 0, sent: [] as Record<string, any>[], audits: [] as Record<string, any>[], outcome: "sent" };
  const budget = { id: "budget", organizationId: "tenant", title: unsafe, publicToken: "ABCD-EFGH-JKLM-NPQR-STUV", status: "SENT",
    updatedAt: new Date("2026-10-10T12:00:00Z"), archivedAt: null, deletedAt: null,
    subtotal: 100000, discount: 0, total: 100000, advanceAmount: 0, paymentTerms: null, installmentsJson: [],
    approvedAt: null as Date | null, validUntil: new Date("2026-10-20T18:00:00Z"),
    client: { name: unsafe, company: null, tradeName: null, legalName: null }, event: { name: "Evento", startsAt: null as Date | null, endsAt: null as Date | null },
    items: [{ name: unsafe, quantity: 2, days: 1, subtotal: 100000, sortOrder: 0 }],
    organization: { name: unsafe, paymentDetails: { bank: "PRIVATE-BANK", account: "PRIVATE-ACCOUNT" } } };
  const cache = new Map<string, { exports: Record<string, any> }>();
  const receipts = new Map<string, Record<string, any>>();
  const receiptKey = (where: any) => JSON.stringify(where.organizationId_scope_key);
  const database: Record<string, any> = {
    budget: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        state.queries++; return where.id === budget.id && where.organizationId === "tenant" ? budget : null;
      },
      findUnique: async ({ where }: any) => where.id === budget.id ? budget : null,
      updateMany: async ({ where, data }: any) => {
        if (where.id !== budget.id || where.organizationId !== "tenant" || where.status !== budget.status || where.updatedAt.getTime() !== budget.updatedAt.getTime()) return { count: 0 };
        Object.assign(budget, data, { updatedAt: new Date() }); return { count: 1 };
      },
    },
    signatureRequest: { count: async () => 0 },
    idempotencyKey: {
      findUnique: async ({ where }: any) => receipts.get(receiptKey(where)) ?? null,
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => {
        receipts.set(receiptKey({ organizationId_scope_key: { organizationId: data.organizationId, scope: data.scope, key: data.key } }), data); return data;
      },
      update: async ({ where, data }: any) => {
        const prior = receipts.get(receiptKey(where)); assert.ok(prior); Object.assign(prior, data); return prior;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (write: (tx: any) => Promise<any>) => write(database),
  };
  const mail = {
    appEmailSender: () => state.from,
    // El remitente del envío y de la vista previa sale de la identidad de la empresa (un solo lugar).
    mailIdentityFor: async () => ({ brand: { name: unsafe }, from: state.from, replyTo: null }),
    buildBudgetMail: (input: unknown) => load("lib/server/mail/budget.ts").buildBudgetMail(input),
    sendMail: async (input: Record<string, any>) => { state.sent.push(input); return { status: state.outcome, error: state.outcome === "failed" ? "offline rejection" : null }; },
  };
  const modules: Record<string, unknown> = {
    "lib/server/db.ts": { db: database },
    "lib/server/budget-send-availability.ts": {
      SendAvailabilityChangedError: class extends Error {},
      checkBudgetSendAvailability: async () => {
        state.availabilityCalls++;
        return { review: { state: state.availabilityState, revision: state.availabilityRevision, checkedAt: new Date().toISOString(), range: null, checkedLines: 1, unlinkedLines: 0, warnings: [] }, fingerprint: `${state.availabilityState}-${state.availabilityRevision}` };
      },
    },
    "lib/server/tenancy.ts": { requireAdminContext: async (capability: string) => {
      assert.equal(capability, "budgets.write");
      return state.denied ? { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) }
        : { ok: true, context: { organizationId: state.organizationId, user: { id: state.actorId, name: "Admin", email: "admin@example.invalid" } } };
    } },
    "lib/server/audit.ts": { recordAudit: async (input: Record<string, any>) => { state.audits.push(input); } },
    "lib/server/demo-data.ts": { isDemoOrganizationSlug: () => false },
    "lib/server/mail/index.ts": mail,
  };
  function load(path: string): Record<string, any> {
    const file = resolve(root, path), key = relative(root, file);
    if (key in modules) return modules[key] as Record<string, any>;
    if (cache.has(file)) return cache.get(file)!.exports;
    const module = { exports: {} as Record<string, any> };
    cache.set(file, module);
    const require = (name: string): unknown => {
      if (["node:crypto", "node:path", "owncoding-ui/utils", "zod", "jose"].includes(name)) return requireNative(name);
      if (name === "server-only") return {};
      assert.ok(name.startsWith(".") || name.startsWith("@/"), `Unexpected external import: ${name}`);
      const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
      if (base.endsWith(".json")) return JSON.parse(readFileSync(base, "utf8"));
      const target = [base + ".ts", join(base, "index.ts")].find(existsSync);
      assert.ok(target, `Missing actual dependency ${name}`);
      return load(relative(root, target));
    };
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    runInNewContext(source, { module, exports: module.exports, require, Date, Intl, Buffer, URL, Request, Response,
      TextEncoder, console, process: { env: secret ? { AUTH_SECRET: secret } : {}, cwd: () => root } }, { filename: file });
    return module.exports;
  }
  const body = { budgetId: budget.id, to: " Ana@Example.invalid ", message: unsafe };
  async function request(extra: Record<string, unknown> = {}) {
    const response: Response = await load(routePath).POST(new Request("https://example.invalid/api/admin/budgets/send", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...extra }),
    }));
    return { response, data: await response.json() };
  }
  return { state, budget, body, load, request, receipts };
}

test("real budget preview is no-store/read-only, escaped, plain-text complete and not a provider send", async () => {
  const f = fixture();
  const { response, data } = await f.request({ preview: true });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(data.status, "preview"); assert.equal(data.to, "ana@example.invalid"); assert.equal(data.from, f.state.from);
  assert.ok(data.html.includes("&lt;script&gt;")); assert.ok(!data.html.includes(unsafe)); assert.ok(data.text.includes(unsafe));
  assert.ok(data.text.includes("ABCD-EFGH-JKLM-NPQR-STUV")); assert.ok(!data.text.includes("PRIVATE-BANK"));
  assert.equal(f.state.queries, 1); assert.equal(f.state.sent.length, 0); assert.equal(f.state.audits.length, 0);
  assert.equal(f.receipts.size, 0);
  const claims = decodeJwt(data.confirmationToken);
  assert.ok(!JSON.stringify(claims).includes("ABCD-EFGH")); assert.ok(!JSON.stringify(claims).includes("ana@example"));
  assert.equal(Number(claims.exp) - Number(claims.iat), 600);
});

test("only explicit confirmation sends the exact previewed bytes and keeps existing tenant/entity/actor audit", async () => {
  const f = fixture(), { data: preview } = await f.request({ preview: true });
  const { response, data } = await f.request({ confirm: true, confirmationToken: preview.confirmationToken });
  assert.equal(response.status, 200); assert.equal(data.status, "sent"); assert.equal(f.state.sent.length, 1);
  const payload = f.state.sent[0];
  for (const field of ["to", "subject", "html", "text"]) assert.equal(payload[field], preview[field]);
  assert.equal(payload.category, "budget"); assert.equal(payload.organizationId, "tenant");
  assert.equal(payload.entity, "Budget"); assert.equal(payload.entityId, "budget"); assert.equal(payload.actor.id, "actor");
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.audits[0].action, "send");
  assert.equal(f.state.audits[0].detail.fields.status, "sent");
});

test("missing confirmation, ambiguous action or forged preview cannot dispatch", async () => {
  const f = fixture();
  for (const extra of [{}, { confirm: true }, { preview: true, confirm: true }, { confirm: true, confirmationToken: "forged" }]) {
    assert.ok((await f.request(extra)).response.status >= 400);
  }
  assert.equal(f.state.sent.length, 0); assert.equal(f.state.audits.length, 0);
});

test("changed recipient/message/server amount/approval/portal/sender/event dates invalidates confirmation without auto resend", async () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => ({ to: "other@example.invalid" }),
    (f: ReturnType<typeof fixture>) => ({ message: "Different message" }),
    (f: ReturnType<typeof fixture>) => { f.budget.total++; return {}; },
    (f: ReturnType<typeof fixture>) => { f.budget.event.startsAt = new Date("2027-02-20T15:00:00Z"); return {}; },
    (f: ReturnType<typeof fixture>) => { f.budget.event.endsAt = new Date("2027-02-21T15:00:00Z"); return {}; },
    (f: ReturnType<typeof fixture>) => { f.budget.approvedAt = new Date(); return {}; },
    (f: ReturnType<typeof fixture>) => { f.budget.publicToken = "BCDE-FGHJ-KLMN-PQRS-TUVW"; return {}; },
    (f: ReturnType<typeof fixture>) => { f.state.from = "Changed <changed@example.invalid>"; return {}; },
  ];
  for (const change of changes) {
    const f = fixture(), { data: preview } = await f.request({ preview: true });
    const { response } = await f.request({ confirm: true, confirmationToken: preview.confirmationToken, ...change(f) });
    assert.equal(response.status, 409); assert.equal(f.state.sent.length, 0); assert.equal(f.state.audits.length, 0);
  }
});

test("preview permission and tenant scope fail before disclosing mail; another actor cannot confirm", async () => {
  const f = fixture(); f.state.denied = true;
  assert.equal((await f.request({ preview: true })).response.status, 403); assert.equal(f.state.queries, 0);
  f.state.denied = false; f.state.organizationId = "foreign";
  assert.equal((await f.request({ preview: true })).response.status, 404);
  f.state.organizationId = "tenant";
  const { data: preview } = await f.request({ preview: true }); f.state.actorId = "other-actor";
  assert.equal((await f.request({ confirm: true, confirmationToken: preview.confirmationToken })).response.status, 409);
  assert.equal(f.state.sent.length, 0);
});

test("expired and wrong-purpose/entity tokens fail closed; preview signing unavailable is honest 503", async () => {
  const f = fixture(), helpers = f.load("lib/server/mail/preview.ts");
  const content = { from: f.state.from, to: "ana@example.invalid", subject: "Subject", html: "<p>Content</p>", text: "Content" };
  const scope = { organizationId: "tenant", actorId: "actor", entity: "Budget", entityId: "budget" };
  const old = new Date(Date.now() - 601000);
  const expired = await helpers.createMailPreview(content, scope, old);
  assert.equal(await helpers.verifyMailPreviewConfirmation(expired.confirmationToken, content, scope), false);
  const fresh = await helpers.createMailPreview(content, scope);
  assert.equal(await helpers.verifyMailPreviewConfirmation(fresh.confirmationToken, content, { ...scope, entityId: "other-budget" }), false);
  const { SignJWT } = await import("jose");
  const wrongPurpose = await new SignJWT(decodeJwt(fresh.confirmationToken)).setProtectedHeader({ alg: "HS256" })
    .setIssuer("ledbox:ruc").setAudience("ledbox:ruc-confirmation")
    .sign(new TextEncoder().encode("offline-preview-secret-not-a-real-credential"));
  assert.equal(await helpers.verifyMailPreviewConfirmation(wrongPurpose, content, scope), false);
  const unavailable = fixture("");
  assert.equal((await unavailable.request({ preview: true })).response.status, 503);
  assert.equal(unavailable.state.sent.length, 0);
});

test("provider failure remains an audited failure and never triggers an automatic second send", async () => {
  const f = fixture(), { data: preview } = await f.request({ preview: true }); f.state.outcome = "failed";
  const { data } = await f.request({ confirm: true, confirmationToken: preview.confirmationToken });
  assert.equal(data.status, "failed"); assert.equal(data.error, "offline rejection");
  assert.equal(f.state.sent.length, 1); assert.equal(f.state.audits[0].detail.fields.status, "failed");
  assert.equal((await f.request({ confirm: true, confirmationToken: preview.confirmationToken })).data.status, "failed");
  assert.equal(f.state.sent.length, 1);
});

test("accepted draft becomes SENT once; receipt survives later approval and never resends", async () => {
  const f = fixture(); f.budget.status = "DRAFT";
  const { data: preview } = await f.request({ preview: true });
  const first = await f.request({ confirm: true, confirmationToken: preview.confirmationToken });
  assert.equal(first.data.commercialState, "transitioned"); assert.equal(f.budget.status, "SENT");
  assert.equal(f.state.sent.length, 1); assert.equal(f.state.audits.length, 2);
  f.budget.status = "APPROVED"; f.budget.approvedAt = new Date();
  const repeated = await f.request({ confirm: true, confirmationToken: preview.confirmationToken });
  assert.equal(repeated.data.status, "sent"); assert.equal(f.budget.status, "APPROVED"); assert.equal(f.state.sent.length, 1); assert.equal(f.state.audits.length, 2);
  const restored = await f.request({ receiptOnly: true, attemptId: first.data.attemptId });
  assert.equal(restored.data.status, "sent"); assert.equal(f.state.sent.length, 1);
  const serialized = JSON.stringify([...f.receipts.values()]);
  assert.ok(!serialized.includes(preview.confirmationToken)); assert.ok(!serialized.includes("ABCD-EFGH")); assert.ok(!serialized.includes("<html"));
  f.state.actorId = "other-actor";
  assert.equal((await f.request({ receiptOnly: true, attemptId: first.data.attemptId })).response.status, 404);
});

test("fresh previews are distinct attempts and querying cannot be combined with preview", async () => {
  const f = fixture(), a = await f.request({ preview: true }), b = await f.request({ preview: true });
  assert.notEqual(a.data.confirmationToken, b.data.confirmationToken);
  assert.notEqual(a.data.attemptId, b.data.attemptId);
  assert.equal((await f.request({ preview: true, receiptOnly: true, attemptId: a.data.attemptId })).response.status, 400);
  assert.equal(f.receipts.size, 0); assert.equal(f.state.sent.length, 0);
});

test("real adopted preview component isolates HTML and escapes envelope/plain text without a send effect", () => {
  const preview: MailPreview = { status: "preview", from: unsafe, to: "ana@example.invalid", subject: unsafe,
    html: "<html><body>Canonical renderer output</body></html>", text: unsafe, confirmationToken: "opaque", expiresAt: "2026-10-20T18:00:00Z" };
  const html = renderToStaticMarkup(createElement(AdminMailPreview, { preview }));
  assert.ok(html.includes('sandbox=""')); assert.ok(html.includes('referrerPolicy="no-referrer"'));
  assert.ok(!html.includes(unsafe)); assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Alternativa en texto plano")); assert.ok(!html.includes("opaque"));
  const source = readFileSync(join(root, "components/admin/modules/PresupuestosModule.tsx"), "utf8");
  assert.match(source, /<AdminMailPreview preview=\{sendPreview\}/);
  assert.match(source, /sendPreview \? \{ confirm: true, confirmationToken: sendPreview\.confirmationToken, acceptAvailabilityWarnings: sendAvailabilityAccepted \} : \{ preview: true \}/);
  assert.match(source, /mailInFlight\.current = true/);
  assert.match(source, /setSendTo\(value\);\s*setSendPreview\(null\)/);
  assert.match(source, /setSendMessage\(value\);\s*setSendPreview\(null\)/);
});


test("availability errors block sends; new warnings/revisions invalidate consent and replay skips calculation", async () => {
  const f = fixture();
  f.state.availabilityState = "error";
  assert.equal((await f.request({ preview: true })).response.status, 503);
  assert.equal(f.state.sent.length, 0);
  f.state.availabilityState = "available";
  const { data: initial } = await f.request({ preview: true });
  f.state.availabilityState = "shortage";
  assert.equal((await f.request({ confirm: true, confirmationToken: initial.confirmationToken, acceptAvailabilityWarnings: true })).response.status, 409);
  const { data: warned } = await f.request({ preview: true });
  assert.equal(warned.availability.state, "shortage"); assert.match(warned.text, /disponibilidad por confirmar/);
  assert.equal((await f.request({ confirm: true, confirmationToken: warned.confirmationToken })).response.status, 409);
  f.state.availabilityRevision = "revision-2";
  assert.equal((await f.request({ confirm: true, confirmationToken: warned.confirmationToken, acceptAvailabilityWarnings: true })).response.status, 409);
  const { data: fresh } = await f.request({ preview: true });
  const confirmed = await f.request({ confirm: true, confirmationToken: fresh.confirmationToken, acceptAvailabilityWarnings: true });
  assert.equal(confirmed.response.status, 200); assert.equal(f.state.sent.length, 1);
  const calls = f.state.availabilityCalls;
  f.state.availabilityState = "error";
  assert.equal((await f.request({ confirm: true, confirmationToken: fresh.confirmationToken })).response.status, 200);
  assert.equal((await f.request({ receiptOnly: true, attemptId: fresh.attemptId })).response.status, 200);
  assert.equal(f.state.availabilityCalls, calls); assert.equal(f.state.sent.length, 1);
});
