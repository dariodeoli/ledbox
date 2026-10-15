import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { renderMail, renderMailText, type MailContent } from "../lib/server/mail/template";
import { publicConfig, invitationAcceptUrl } from "../lib/public-config";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const nativeRequire = createRequire(import.meta.url);
const unsafe = '<img src=x onerror="alert(1)"> & Ana';
const expiresAt = new Date("2026-10-20T18:00:00Z");

/** Execute the actual consumer modules with IO boundaries replaced. The shared
 * renderer is real, not a snapshot or a second implementation. Unexpected DB,
 * filesystem, provider or package access fails closed; no emails are sent. */
function consumerHarness(db: Record<string, unknown> = {}, extras: Record<string, unknown> = {}) {
  const rendered: { kind: string; content: MailContent }[] = [];
  const sent: Record<string, unknown>[] = [];
  const audited: unknown[] = [];
  const mail = {
    renderMail(content: MailContent) { rendered.push({ kind: "html", content }); return renderMail(content); },
    renderMailText(content: MailContent) { rendered.push({ kind: "text", content }); return renderMailText(content); },
    async sendMail(payload: Record<string, unknown>) { sent.push(payload); return { status: "sent", logId: "offline-log" }; },
    emailConfigured: () => true,
    appEmailSender: () => "EventOS <offline@example.invalid>",
    missingApiKeyMessage: () => "offline",
  };
  const overrides: Record<string, unknown> = {
    "lib/server/db.ts": { db: new Proxy(db, { get: (target, key) => {
      if (key in target) return target[String(key)];
      throw new Error(`Unexpected DB access: ${String(key)}`);
    } }) },
    "lib/server/demo-data.ts": { isDemoOrganizationSlug: (slug: string) => slug === "demo" },
    "lib/server/mail/index.ts": mail,
    "lib/server/mail/template.ts": mail,
    "lib/server/audit.ts": { recordAudit: async (input: unknown) => { audited.push(input); } },
    ...extras,
  };
  const cache = new Map<string, { exports: Record<string, any> }>();
  function load(path: string): Record<string, any> {
    const file = resolve(root, path);
    const key = relative(root, file);
    if (key in overrides) return overrides[key] as Record<string, any>;
    if (cache.has(file)) return cache.get(file)!.exports;
    const module = { exports: {} as Record<string, any> };
    cache.set(file, module);
    const source = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const require = (specifier: string): unknown => {
      if (specifier in overrides) return overrides[specifier];
      if (["node:crypto", "node:path", "owncoding-ui/utils", "zod"].includes(specifier)) return nativeRequire(specifier);
      if (specifier === "server-only") return {};
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) throw new Error(`Unexpected import: ${specifier}`);
      const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
      if (base.endsWith(".json")) return JSON.parse(readFileSync(base, "utf8"));
      const target = [base + ".ts", join(base, "index.ts")].find(existsSync);
      assert.ok(target, `Unresolved consumer import ${specifier}`);
      return load(relative(root, target));
    };
    runInNewContext(source, { module, exports: module.exports, require, Date, Intl, URL, Request, Response, Buffer,
      console, process: { env: {}, cwd: () => root }, setTimeout, clearTimeout }, { filename: file });
    return module.exports;
  }
  function check(output: { html: string; text: string }) {
    assert.equal(rendered.length, 2, "consumer must use both canonical renderers exactly once");
    assert.equal(rendered[0].kind, "html"); assert.equal(rendered[1].kind, "text");
    assert.equal(rendered[0].content, rendered[1].content, "HTML and text must use the same content");
    assert.equal(output.html, renderMail(rendered[0].content));
    assert.equal(output.text, renderMailText(rendered[0].content));
    assert.ok(!output.html.includes(unsafe), "controlled content must not become executable HTML");
    assert.ok(output.text.includes(unsafe), "plain text must preserve caller data");
    assert.ok(output.html.includes("&lt;img"), "HTML must escape caller markup");
    rendered.length = 0;
  }
  return { load, check, rendered, sent, audited };
}

test("invitation and resend preserve tenant, role, token URL, expiry and escaped sender through shared renderer", () => {
  const h = consumerHarness();
  const { buildInvitationMail } = h.load("lib/server/mail/invitation.ts");
  for (const resend of [false, true]) {
    const output = buildInvitationMail({ organizationName: unsafe, invitedByName: unsafe, email: "ana@example.invalid",
      role: "OPERATIONS", token: "2A4B6C8D2E4F6G8H2J4K6M8N", expiresAt, resend });
    assert.equal(output.url, invitationAcceptUrl("2A4B6C8D2E4F6G8H2J4K6M8N"));
    assert.equal(output.subject, `Invitación al equipo de ${unsafe} · LedBox`);
    assert.ok(output.text.includes(output.url));
    assert.ok(output.text.includes(new Intl.DateTimeFormat("es-PY", {
      timeZone: "America/Asuncion", day: "2-digit", month: "long", year: "numeric",
    }).format(expiresAt)));
    assert.ok(output.text.includes("No se crea ningún acceso sin aceptarla"));
    h.check(output);
  }
});

test("all four signature consumers preserve personal code, URL/TTL and honest legal state", () => {
  const h = consumerHarness(), builders = h.load("lib/server/mail/signature.ts");
  const common = { organizationName: unsafe, title: unsafe, recipientName: unsafe, senderName: unsafe, code: "234567",
    portalUrl: "https://example.invalid/firma/private-token", expiresAt, methodLabel: "Código por correo" };
  const cases = [
    ["buildSignatureRequestMail", { ...common, message: unsafe }, "Revisar y firmar"],
    ["buildSignatureCompletedMail", { ...common, identifier: "signed-id", signedAt: expiresAt }, "signed-id"],
    ["buildSignatureReminderMail", { ...common, daysLeft: 1 }, "vence mañana"],
    ["buildSignatureOtpMail", { ...common, expiresInMinutes: 10 }, "en 10 minutos"],
  ] as const;
  for (const [name, input, expected] of cases) {
    const output = builders[name](input);
    assert.ok(output.text.includes("234567")); assert.ok(output.text.includes(expected));
    if (name === "buildSignatureRequestMail" || name === "buildSignatureReminderMail") assert.ok(output.text.includes(common.portalUrl));
    h.check(output);
  }
});

test("budget uses canonical renderer, withholds bank details before approval and never invents a portal", () => {
  const h = consumerHarness(), { buildBudgetMail } = h.load("lib/server/mail/budget.ts");
  const budget = { id: "budget-id", title: unsafe, status: "SENT", subtotal: 100000, discount: 0, total: 100000,
    advanceAmount: 0, paymentTerms: null, installmentsJson: [], validUntil: expiresAt, publicToken: "ABCD-EFGH-JKLM-NPQR-STUV",
    approvedAt: null, client: { name: unsafe, company: null }, event: { name: unsafe },
    items: [{ name: unsafe, quantity: 2, days: 1, subtotal: 100000 }] };
  for (const approvedAt of [null, expiresAt]) {
    const output = buildBudgetMail({ organizationName: unsafe, message: unsafe,
      paymentDetails: { bank: "BANK-PRIVATE", holder: "Holder", account: "ACCOUNT-PRIVATE" }, budget: { ...budget, approvedAt } });
    assert.ok(output); assert.ok(output.text.includes(output.portalUrl));
    assert.equal(output.text.includes("BANK-PRIVATE"), Boolean(approvedAt));
    assert.equal(output.html.includes("ACCOUNT-PRIVATE"), Boolean(approvedAt));
    h.check(output);
  }
  assert.equal(buildBudgetMail({ organizationName: unsafe, paymentDetails: null, budget: { ...budget, publicToken: null } }), null);
  assert.equal(h.rendered.length, 0);
});

test("payment reminder renders controlled content; optional portal is not synthesized", () => {
  const h = consumerHarness(), { buildPaymentReminderEmail } = h.load("lib/server/reminders.ts");
  for (const portalUrl of [null, "https://example.invalid/presupuesto/private-token"]) {
    const output = buildPaymentReminderEmail({ organizationName: unsafe, client: { name: unsafe, company: null }, amount: 100000,
      dueAt: expiresAt, invoiceNumber: "INV-1", budgetTitle: null, portalUrl, paymentDetails: null });
    assert.ok(output.text.includes("INV-1")); assert.ok(output.text.includes("Si ya abonaste"));
    assert.equal(h.rendered[0].content.cta?.url ?? null, portalUrl);
    h.check(output);
  }
});

test("password reset uses shared content and keeps account tenant, encoded token and 30-minute TTL", async () => {
  const h = consumerHarness({
    adminUser: { findUnique: async () => ({ id: "user" }) },
    adminMembership: { findFirst: async () => ({ organization: { id: "tenant", name: unsafe } }) },
  });
  await h.load("lib/server/resend.ts").sendPasswordResetEmail("ana@example.invalid", "token&?=value");
  assert.equal(h.sent.length, 1);
  const payload = h.sent[0];
  assert.equal(payload.category, "reset"); assert.equal(payload.organizationId, "tenant");
  assert.equal(payload.to, "ana@example.invalid"); assert.equal(payload.subject, "Restablecé tu contraseña de LedBox");
  assert.ok(String(payload.text).includes(`${publicConfig.adminUrl}/reset-password?token=token%26%3F%3Dvalue`));
  assert.ok(String(payload.text).includes("30 minutos"));
  h.check(payload as { html: string; text: string });
});

test("mail test route uses real shared renderer and preserves tenant, actor, audit and sender", async () => {
  const user = { id: "user", name: unsafe, email: "ana@example.invalid" };
  const h = consumerHarness({}, {
    "lib/server/tenancy.ts": { requireAdminContext: async (capability: string) => {
      assert.equal(capability, "org.manage"); return { ok: true, context: { organizationId: "tenant", user, organization: { name: unsafe } } };
    } },
    "lib/server/rate-limit.ts": { getClientIp: () => "offline", rateLimit: async () => ({ allowed: true }) },
  });
  const response = await h.load("app/api/admin/mail/test/route.ts").POST(new Request("https://example.invalid/api/admin/mail/test", { method: "POST" }));
  assert.equal(response.status, 200); assert.equal(h.sent.length, 1); assert.equal(h.audited.length, 1);
  const payload = h.sent[0];
  assert.equal(payload.organizationId, "tenant"); assert.equal(payload.entityId, "tenant"); assert.equal(payload.actor, user);
  assert.equal(payload.category, "test"); assert.ok(String(payload.text).includes("offline@example.invalid"));
  h.check(payload as { html: string; text: string });
});

test("reminder facade preserves existing HTML/plain-text contract and send context without rewriting arbitrary HTML", async () => {
  const h = consumerHarness();
  const payload = { to: "ana@example.invalid", subject: "Existing subject", html: "<p>Existing caller HTML</p>",
    text: "Existing caller text", organizationId: "tenant", paymentId: "payment", actor: { id: "actor" } };
  await h.load("lib/server/resend.ts").sendReminderEmail(payload);
  assert.equal(h.rendered.length, 0, "facade must not reformat caller HTML or add a second shell");
  assert.equal(h.sent[0].html, payload.html); assert.equal(h.sent[0].text, payload.text);
  assert.equal(h.sent[0].subject, payload.subject); assert.equal(h.sent[0].actor, payload.actor);
  assert.equal(h.sent[0].organizationId, "tenant"); assert.equal(h.sent[0].entity, "ClientPayment");
  assert.equal(h.sent[0].entityId, "payment"); assert.equal(h.sent[0].category, "reminder");
});

test("backup alert uses shared content and preserves system origin, actor and same-day suppression", async () => {
  let alreadySent = false;
  const now = new Date("2026-10-12T18:00:00Z");
  const user = { id: "actor", name: "Admin", email: "admin@example.invalid" };
  const absent = async () => { throw Object.assign(new Error("offline fixture absent"), { code: "ENOENT" }); };
  const h = consumerHarness({
    $queryRawUnsafe: async (sql: string) => sql.includes("pg_database_size") ? [{ size: 1 }]
      : sql.includes("count(*)") ? [{ count: 0 }] : [],
    mailLog: { findFirst: async () => alreadySent ? { status: "sent", sentAt: now } : null },
    adminMembership: { findMany: async () => [{ organization: { slug: "real-tenant" }, user: { name: unsafe, email: "ana@example.invalid" } }] },
  }, {
    "node:fs/promises": { readFile: absent, access: absent, readdir: async () => [], stat: absent, statfs: absent },
  });
  const { alertBackupIssueIfNeeded } = h.load("lib/server/system-status.ts");
  const context = { user, organizationId: "tenant", organization: { slug: "real-tenant" } };
  const result = await alertBackupIssueIfNeeded(context, now);
  assert.equal(result.issue, "never"); assert.equal(result.sent, 1); assert.equal(h.sent.length, 1);
  const payload = h.sent[0];
  assert.equal(payload.category, "alert"); assert.equal(payload.organizationId, null);
  assert.equal(payload.entity, "System"); assert.equal(payload.entityId, "backup-never");
  assert.equal((payload.actor as { id: string }).id, user.id);
  assert.ok(String(payload.text).includes(`${publicConfig.adminUrl}/sistema`));
  assert.ok(String(payload.text).includes("propietarios y administradores"));
  h.check(payload as { html: string; text: string });
  alreadySent = true;
  assert.equal((await alertBackupIssueIfNeeded(context, now)).alreadyAlertedToday, true);
  assert.equal(h.sent.length, 1); assert.equal(h.rendered.length, 0);
});

test("caller inventory has no extra provider or unreviewed email dispatch outside the canonical transport", () => {
  const inventory: Record<string, number> = {};
  function visit(dir: string) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { visit(path); continue; }
      if (!/\.(ts|tsx|mjs|js)$/.test(path)) continue;
      const source = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true);
      function inspect(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(source);
          if (["sendMail", "sendReminderEmail", "sendPasswordResetEmail"].includes(callee)) inventory[path] = (inventory[path] ?? 0) + 1;
          if (["sendMail", "sendReminderEmail"].includes(callee)) {
            const argument = node.arguments[0];
            assert.ok(argument && ts.isObjectLiteralExpression(argument), `unreviewed mail payload: ${path}`);
            const properties = new Map(argument.properties.filter(ts.isPropertyAssignment)
              .map(property => [property.name.getText(source), property.initializer.getText(source)]));
            const html = properties.get("html"), text = properties.get("text");
            assert.ok(html && text, `both alternatives required: ${path}`);
            assert.ok(["renderMail(content)", "content.html", "payload.html"].includes(html), `HTML bypass: ${path}: ${html}`);
            assert.equal(text, html === "renderMail(content)" ? "renderMailText(content)" : html.replace(/\.html$/, ".text"),
              `HTML/text must share a reviewed content origin: ${path}`);
          }
          if (/emails\.send$|sendThroughProvider$|createTransport$/.test(callee)) {
            assert.ok(["lib/server/mail/send.ts", "lib/server/mail/transport.ts"].includes(path), `provider bypass: ${path}:${callee}`);
          }
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
    }
  }
  visit("lib"); visit("app");
  assert.deepEqual(inventory, {
    "lib/platform/alta-empresa-server.ts": 1, "lib/server/reminders.ts": 1, "lib/server/resend.ts": 2,
    "lib/server/signature/admin.ts": 2, "lib/server/signature/portal.ts": 2,
    "lib/server/signature/reminders.ts": 1, "lib/server/system-status.ts": 1,
    "app/api/admin/budgets/send/route.ts": 1, "app/api/admin/invitations/[id]/route.ts": 1,
    "app/api/admin/invitations/route.ts": 1, "app/api/admin/mail/test/route.ts": 1,
    "app/api/auth/forgot-password/route.ts": 1,
  }, "new dispatch consumers require explicit shared-renderer review and coverage");
});
