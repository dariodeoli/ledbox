import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/event-readiness.pg.test.ts
test("seña por evento en PostgreSQL: más de 200 presupuestos, solo cobros RECEIVED y dos empresas sin mezclarse", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { loadEventReadiness } = await import("../lib/server/event-readiness");

  async function org(label: string) {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: `Seña ${label}`, slug: `sn-${id}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: `Cliente ${label}` } });
    return { id, client: client.id };
  }
  const A = await org("A");
  const B = await org("B");
  const event = async (o: { id: string; client: string }, name: string) => {
    const id = randomUUID();
    await db.event.create({ data: { id, organizationId: o.id, clientId: o.client, name, startsAt: new Date(Date.UTC(2033, 5, 1, 15)), endsAt: new Date(Date.UTC(2033, 5, 1, 20)), status: "CONFIRMED" } });
    return id;
  };
  const budget = async (o: { id: string; client: string }, eventId: string | null, status: "DRAFT" | "SENT" | "APPROVED", advanceAmount: number, createdAt: Date) => {
    const id = randomUUID();
    await db.budget.create({ data: { id, organizationId: o.id, clientId: o.client, eventId, title: `P ${id.slice(0, 4)}`, status, subtotal: 1_000_000, total: 1_000_000, advanceAmount, createdAt } });
    return id;
  };
  const pay = (o: { id: string; client: string }, budgetId: string, amount: number, status: "PENDING" | "RECEIVED") =>
    db.clientPayment.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, budgetId, amount, status } });

  try {
    // 205 presupuestos sin evento más nuevos: el tope de 200 del listado completo dejaría afuera al del evento.
    const target = await event(A, "Con seña");
    const approved = await budget(A, target, "APPROVED", 300_000, new Date(Date.UTC(2033, 0, 1)));
    await budget(A, target, "SENT", 999_999, new Date(Date.UTC(2033, 0, 20)));
    await pay(A, approved, 200_000, "RECEIVED");
    await pay(A, approved, 150_000, "RECEIVED");
    await pay(A, approved, 500_000, "PENDING");
    for (let i = 0; i < 205; i += 1) await budget(A, null, "DRAFT", 0, new Date(Date.UTC(2033, 1, 1 + (i % 20), i % 24)));
    const bare = await event(A, "Sin presupuesto");
    const foreign = await event(B, "De otra empresa");
    const foreignBudget = await budget(B, foreign, "APPROVED", 100_000, new Date(Date.UTC(2033, 0, 2)));
    await pay(B, foreignBudget, 100_000, "RECEIVED");

    // Seña estructurada del alta: se conserva en installmentsJson, no en advanceAmount.
    const structured = await event(A, "Seña del formulario");
    const structuredBudget = await budget(A, structured, "APPROVED", 0, new Date(Date.UTC(2033, 0, 1)));
    const { defaultDepositPlanRows } = await import("../lib/budget-payment-plan");
    await db.budget.update({ where: { id: structuredBudget }, data: { installmentsJson: defaultDepositPlanRows(50, 240000)! } });
    const structuredRow = (await loadEventReadiness(A.id, [structured]))[0];
    assert.equal(structuredRow.advanceAmount, 120000);
    assert.equal(structuredRow.collected, 0);
    await pay(A, structuredBudget, 120000, "RECEIVED");
    assert.equal((await loadEventReadiness(A.id, [structured]))[0].collected, 120000);
    // El resto de los casos sigue acotado a los eventos originales.
    await db.event.delete({ where: { id: structured } });

    const all = await loadEventReadiness(A.id, null);
    assert.equal(all.length, 2, "solo los eventos de la empresa activa");
    const row = all.find((r) => r.eventId === target)!;
    assert.equal(row.hasBudget, true);
    assert.equal(row.budgetId, approved, "el aprobado manda aunque haya otro más nuevo");
    assert.equal(row.advanceAmount, 300_000);
    assert.equal(row.collected, 350_000, "suma solo los cobros RECEIVED");
    const none = all.find((r) => r.eventId === bare)!;
    assert.deepEqual([none.hasBudget, none.budgetId, none.advanceAmount, none.collected], [false, null, 0, 0]);

    const asked = await loadEventReadiness(A.id, [target, foreign]);
    assert.deepEqual(asked.map((r) => r.eventId), [target], "un evento de otra empresa no aparece");
    assert.deepEqual(await loadEventReadiness(A.id, []), []);
    const other = await loadEventReadiness(B.id, null);
    assert.equal(other[0].collected, 100_000);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [A.id, B.id] } } });
    await db.$disconnect();
  }
});
