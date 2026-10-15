import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/firma-sin-stock.pg.test.ts
test("firma de alternativa sin stock: portal sin firmar, carrera por el último stock con alerta y auditoría (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSignatureRequest } = await import("../lib/server/signature/admin");
  const { loadSignaturePortal, signSignatureRequest } = await import("../lib/server/signature/portal");
  const { listAdminNotifications } = await import("../lib/server/notifications");
  const { peekStockBeforeApproval } = await import("../lib/server/approval-stock");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { generatePublicToken } = await import("../lib/server/budget-portal");

  const orgId = randomUUID();
  await db.organization.create({ data: { id: orgId, name: "Firma sin stock", slug: `fss-${orgId.slice(0, 8)}` } });
  const owner = { organizationId: orgId, user: { id: randomUUID(), name: "Dueña", email: "d@x.test", role: "OWNER" } } as never;
  const copa = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: orgId, name: "Copa última", category: "QA", quantity: 1 } });
  const day = (n: number) => new Date(Date.UTC(2032, 0, n, 12));

  async function alternative(label: string) {
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: orgId, name: `Cliente ${label}` } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: orgId, clientId: client.id, name: `Evento ${label}`, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), status: "CONFIRMED" } });
    const group = await db.quoteComparison.create({ data: { id: randomUUID(), organizationId: orgId, clientId: client.id, title: `Grupo ${label}`, publicToken: generatePublicToken(), expiresAt: new Date(Date.now() + 86_400_000) } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: orgId, clientId: client.id, eventId: event.id, comparisonId: group.id, title: `Alt ${label}`, status: "SENT", subtotal: 100_000, total: 100_000 } });
    await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Copa", quantity: 1, days: 1, unitPrice: 100_000, subtotal: 100_000, inventoryId: copa.id } });
    return { budget, event };
  }
  const issue = async (budgetId: string, name: string) =>
    createSignatureRequest(owner, { budgetId, recipientName: name, method: "TYPED", expiresInDays: 7 });
  const codeOf = (result: Awaited<ReturnType<typeof issue>>) => result.request.code;
  const sign = (code: string, name: string) => signSignatureRequest({ code, body: { consent: true, signature: { name } }, evidence: { ipHash: null, userAgentHash: null } });

  try {
    const a = await alternative("A");
    const b = await alternative("B");
    const c = await alternative("C");
    const codeA = codeOf(await issue(a.budget.id, "Ana"));
    const codeB = codeOf(await issue(b.budget.id, "Beto"));

    await t.test("con stock el portal ofrece firmar y la verificación de solo lectura no reserva nada", async () => {
      const view = await loadSignaturePortal(codeA);
      assert.equal(view?.canSign, true);
      const gate = await peekStockBeforeApproval({ organizationId: orgId, budgetId: a.budget.id, context: portalAuditContext(orgId, "x") });
      assert.equal(gate.ok, true);
      assert.equal(await db.eventInventory.count({ where: { eventId: a.event.id } }), 0, "no reservó");
    });

    await t.test("dos firmas concurrentes por el último stock: una reserva completa, la otra queda con alerta y auditoría", async () => {
      const results = await Promise.allSettled([sign(codeA, "Ana"), sign(codeB, "Beto")]);
      assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], "la firma no se bloquea: es un acto del cliente");
      const reserved = await db.eventInventory.findMany({ where: { inventoryId: copa.id, releasedAt: null } });
      assert.equal(reserved.reduce((sum, row) => sum + row.quantity, 0), 1, "nunca se sobrevende");
      const budgets = await db.budget.findMany({ where: { id: { in: [a.budget.id, b.budget.id] } } });
      assert.ok(budgets.every((row) => row.status === "APPROVED"));
      const short = budgets.find((row) => !reserved.some((r) => r.eventId === (row.id === a.budget.id ? a.event.id : b.event.id)));
      assert.ok(short, "una de las dos quedó sin reserva");
      const audits = await db.auditLog.findMany({ where: { organizationId: orgId, entity: "Budget", entityId: short!.id } });
      assert.ok(audits.some((row) => /sin stock completo/.test(row.summary) && /Copa última/.test(JSON.stringify(row.detail))), "auditada con los faltantes");
      const { notifications } = await listAdminNotifications(orgId);
      const alert = notifications.find((n) => n.id === `reservation:${short!.id}:stock`);
      assert.ok(alert, "alerta visible para el equipo");
      assert.match(alert!.subtitle ?? "", /Aprobado sin stock completo/);
      assert.equal(alert!.level, "overdue");
    });

    await t.test("sin stock el portal no ofrece firmar y muestra el mensaje; emitir otra firma se rechaza", async () => {
      await assert.rejects(issue(c.budget.id, "Carla"), /Falta stock/);
      // Una solicitud emitida antes de que se agotara el stock tampoco ofrece firmar.
      await db.eventInventory.updateMany({ where: { inventoryId: copa.id }, data: { releasedAt: new Date() } });
      const codeC = codeOf(await issue(c.budget.id, "Carla"));
      await db.eventInventory.updateMany({ where: { inventoryId: copa.id }, data: { releasedAt: null } });
      const view = await loadSignaturePortal(codeC);
      assert.equal(view?.canSign, false);
      assert.equal(view?.blockedReason, "Hay piezas sin disponibilidad para esas fechas; el equipo te contacta.");
    });
  } finally {
    await db.budget.updateMany({ where: { organizationId: orgId }, data: { comparisonId: null } });
    await db.quoteComparison.deleteMany({ where: { organizationId: orgId } });
    await db.organization.delete({ where: { id: orgId } }).catch((error) => console.error("limpieza", error));
    await db.$disconnect();
  }
});
