import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AdminContext } from "../lib/server/tenancy";

test("recibos de correo: proveedor una vez, conciliación y rollback reales sin red externa", { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { sendBudgetMailAttempt, readBudgetMailAttempt, reconcileBudgetMailAttempt, budgetMailAttemptId } = await import("../lib/server/budget-mail-attempt");
  const org = randomUUID(), other = randomUUID(), actor = randomUUID();
  await db.organization.createMany({ data: [org, other].map(id => ({ id, name: "QA139 mail receipt", slug: `qa139-${id}` })) });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "QA139 ficticio" } });
  const context = { organizationId: org, organization: { id: org, name: "QA139", slug: "qa139", planId: null }, role: "OWNER", sandbox: false, demo: false,
    user: { id: actor, name: "QA139", email: "qa139@example.invalid", role: "OWNER" }, session: {},
  } as unknown as AdminContext;
  const make = async () => {
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Presupuesto ficticio QA139" } });
    return { budget, options: { request: new Request("http://localhost/api/admin/budgets/send"), context, budgetId: budget.id, updatedAt: budget.updatedAt,
      token: `qa139-token-${randomUUID()}`, to: "qa139@example.invalid", subject: "QA139" } };
  };
  const constraints: string[] = [];
  const addConstraint = async (predicate: string) => {
    const name = `qa139_mail_${randomUUID().replaceAll("-", "")}`;
    assert.match(name, /^[a-z0-9_]+$/);
    await db.$executeRawUnsafe(`ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "${name}" CHECK (NOT ("organizationId" = '${org}' AND (${predicate}))) NOT VALID`);
    constraints.push(name); return name;
  };
  const dropConstraint = async (name: string) => { await db.$executeRawUnsafe(`ALTER TABLE "IdempotencyKey" DROP CONSTRAINT IF EXISTS "${name}"`); };
  try {
    await t.test("doble confirmación concurrente: un transporte, un cambio de estado y recibo recuperable", async () => {
      const { budget, options } = await make(); let delivered = 0;
      const send = () => sendBudgetMailAttempt({ ...options, deliver: async () => { delivered++; await new Promise(r => setTimeout(r, 100)); return { status: "sent", providerId: "mock-provider139" }; } });
      const results = await Promise.all([send(), send()]); assert.equal(delivered, 1); assert.equal(results.filter(r => r.firstAttempt).length, 1);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "SENT");
      const receipt = await readBudgetMailAttempt(context, budget.id, budgetMailAttemptId(options.token)); assert.ok(receipt);
      assert.equal(receipt.reply.commercialState, "transitioned"); assert.equal(receipt.reply.providerId, "mock-provider139");
      const again = await send(); assert.equal(again.firstAttempt, false); assert.equal(delivered, 1);
      assert.equal(await db.auditLog.count({ where: { organizationId: org, entityId: budget.id, action: "status" } }), 1);
      const serialized = JSON.stringify(await db.idempotencyKey.findMany({ where: { organizationId: org } }));
      assert.ok(!serialized.includes(options.token)); assert.ok(!serialized.includes("<html"));
    });
    for (const status of ["APPROVED", "LOST", "CANCELLED"] as const) await t.test(`respuesta tardía no rebaja ${status}`, async () => {
      const { budget, options } = await make();
      const result = await sendBudgetMailAttempt({ ...options, deliver: async () => {
        await db.budget.update({ where: { id: budget.id }, data: { status, ...(status === "APPROVED" ? { approvedAt: new Date() } : {}) } });
        return { status: "sent" };
      } });
      assert.equal(result.reply.commercialState, "preserved_status");
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, status);
    });
    await t.test("borrador editado durante la red conserva revisión y etapa", async () => {
      const { budget, options } = await make();
      const result = await sendBudgetMailAttempt({ ...options, deliver: async () => {
        await db.budget.update({ where: { id: budget.id }, data: { notes: "Cambio concurrente" } }); return { status: "sent" };
      } });
      assert.equal(result.reply.commercialState, "stale_revision");
      const after = await db.budget.findUniqueOrThrow({ where: { id: budget.id } }); assert.equal(after.status, "DRAFT"); assert.equal(after.notes, "Cambio concurrente");
    });
    for (const result of [{ status: "failed", error: "Rechazo explícito" }, { status: "skipped" }, { status: "failed", uncertain: true, error: "Resultado no confirmado: timeout" }] as const) await t.test(`resultado ${result.status}/${"uncertain" in result ? "incierto" : "conocido"} no marca SENT ni reenvía`, async () => {
      const { budget, options } = await make(); let delivered = 0;
      const run = () => sendBudgetMailAttempt({ ...options, deliver: async () => { delivered++; return result; } });
      const first = await run(); await run(); assert.equal(delivered, 1);
      assert.equal(first.reply.status, "uncertain" in result ? "unknown" : result.status);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "DRAFT"); assert.equal(first.reply.sentAt, undefined);
    });
    await t.test("simulación conserva preview sólo en respuesta viva, nunca en recibo", async () => {
      const { budget, options } = await make(); const privateHtml = "<html>qa-private-portal-token</html>";
      const first = await sendBudgetMailAttempt({ ...options, deliver: async () => ({ status: "skipped", simulated: true,
        preview: { from: "QA", to: options.to, subject: options.subject, html: privateHtml, text: "qa-private-portal-token" } }) });
      assert.equal(first.preview?.html, privateHtml); assert.equal(first.reply.simulated, true);
      const receipt = await readBudgetMailAttempt(context, budget.id, first.reply.attemptId); assert.ok(receipt); assert.ok(!JSON.stringify(receipt).includes("qa-private-portal-token"));
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "DRAFT");
    });
    await t.test("caída al guardar aceptación mantiene claim incierto y no reenvía", async () => {
      const { budget, options } = await make(); let delivered = 0;
      const name = await addConstraint(`key = '${budgetMailAttemptId(options.token)}' AND response->'reply'->>'status' = 'sent'`);
      const run = () => sendBudgetMailAttempt({ ...options, deliver: async () => { delivered++; return { status: "sent" }; } });
      const first = await run(); assert.equal(first.reply.status, "sent"); assert.equal(first.reply.commercialState, "reconciliation_pending");
      const second = await run(); assert.equal(second.reply.status, "pending"); assert.equal(delivered, 1);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "DRAFT"); await dropConstraint(name);
    });
    await t.test("error tras cambiar Budget revierte etapa y auditoría; recuperar acuse concilia sin red", async () => {
      const { budget, options } = await make(); let delivered = 0;
      const name = await addConstraint(`key = '${budgetMailAttemptId(options.token)}' AND response->'reply'->>'commercialState' = 'transitioned'`);
      const first = await sendBudgetMailAttempt({ ...options, deliver: async () => { delivered++; return { status: "sent" }; } });
      assert.equal(first.reply.commercialState, "reconciliation_pending");
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "DRAFT");
      assert.equal(await db.auditLog.count({ where: { organizationId: org, entityId: budget.id, action: "status" } }), 0);
      await dropConstraint(name);
      const receipt = await readBudgetMailAttempt(context, budget.id, first.reply.attemptId); assert.ok(receipt);
      assert.equal((await reconcileBudgetMailAttempt(context, receipt)).commercialState, "transitioned"); assert.equal(delivered, 1);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "SENT");
    });
    await t.test("claim fallido no llama proveedor; actor/tenant ajenos no leen recibos", async () => {
      const { budget, options } = await make(); let delivered = 0;
      const name = await addConstraint(`key = '${budgetMailAttemptId(options.token)}'`);
      await assert.rejects(sendBudgetMailAttempt({ ...options, deliver: async () => { delivered++; return { status: "sent" }; } })); assert.equal(delivered, 0);
      await dropConstraint(name);
      const sent = await sendBudgetMailAttempt({ ...options, deliver: async () => ({ status: "sent" }) });
      assert.equal(await readBudgetMailAttempt({ ...context, organizationId: other }, budget.id, sent.reply.attemptId), null);
      assert.equal(await readBudgetMailAttempt({ ...context, user: { ...context.user, id: randomUUID() } }, budget.id, sent.reply.attemptId), null);
      await assert.rejects(sendBudgetMailAttempt({ ...options, context: { ...context, organizationId: other }, token: randomUUID(), deliver: async () => { delivered++; return { status: "sent" }; } })); assert.equal(delivered, 0);
    });
    assert.equal(await db.mailLog.count({ where: { organizationId: org } }), 0, "proveedor sustituido; ningún correo real");
    assert.equal(await db.clientPayment.count({ where: { organizationId: org } }), 0);
  } finally {
    for (const name of constraints) await dropConstraint(name);
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } }); await db.$disconnect();
  }
});
