import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
const base = process.env.FINANCE_LIST_TEST_BASE_URL ?? process.env.TEST_HTTP_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && process.env.TEST_DATABASE_URL);

test("finanzas HTTP: deudas antiguas, filtros y totales completos con páginas acotadas", { skip: !enabled, timeout: 120000 }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { dayKeyOf, dayStart, shiftDayKey } = await import("../lib/server/notifications");
  const org = randomUUID(), other = randomUUID(), uid = randomUUID();
  await db.organization.createMany({ data: [org, other].map(id => ({ id, slug: `finance-list132-${id}`, name: "Empresa ficticia" })) });
  const user = await db.adminUser.create({ data: { id: uid, email: `${uid}@example.invalid`, name: "Auditor ficticio", role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
  await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: uid, organizationId: org, role: "OWNER" } });
  const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ordinario" } });
  const oldClient = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente antiguo único" } });
  const foreign = await db.client.create({ data: { id: randomUUID(), organizationId: other, name: "Cliente privado extranjero" } });
  const old = await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: oldClient.id, amount: 123000, status: "PENDING", method: "Pendiente", reference: "Referencia remota única", dueAt: null, createdAt: new Date("2020-01-01T12:00:00Z") } });
  const today = dayKeyOf(new Date());
  await db.clientPayment.createMany({ data: Array.from({ length: 251 }, (_, i) => ({ id: randomUUID(), organizationId: org, clientId: client.id, amount: 1000, status: "PENDING" as const, method: "Pendiente", dueAt: dayStart(shiftDayKey(today, -1)), createdAt: new Date(Date.parse("2026-02-01T12:00:00Z") + i * 1000) })) });
  await db.clientPayment.createMany({ data: Array.from({ length: 201 }, (_, i) => ({ id: randomUUID(), organizationId: org, clientId: client.id, amount: 2000, status: "RECEIVED" as const, method: "Efectivo", paidAt: new Date("2026-03-01T12:00:00Z"), collectedAt: new Date("2026-03-01T12:00:00Z"), createdAt: new Date(Date.parse("2026-03-01T12:00:00Z") + i * 1000) })) });
  await db.clientPayment.create({ data: { id: randomUUID(), organizationId: other, clientId: foreign.id, amount: 999999, status: "PENDING", method: "Pendiente" } });
  const call = async (query = "") => {
    const response = await fetch(`${base}/api/admin/finance${query}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  try {
    await t.test("GET legado sigue acotado pero sus KPIs incluyen más de200 filas", async () => {
      const payload = await call();
      assert.equal(payload.clientPayments.length, 200);
      assert.ok(!payload.clientPayments.some((row: { id: string }) => row.id === old.id));
      assert.equal(payload.financeSummary.pendingTotal, 374000);
      assert.equal(payload.financeSummary.pendingCount, 252);
      assert.equal(payload.financeSummary.collected, 402000);
      assert.equal(payload.financeSummary.collectedCount, 201);
      assert.equal(payload.financeSummary.overdue, 251);
      assert.equal(payload.paymentsPagination, undefined);
    });
    await t.test("todas las páginas alcanzan la deuda más antigua sin duplicados ni filas de otra empresa", async () => {
      const seen = new Set<string>();
      for (let page = 1; page <= 6; page++) {
        const payload = await call(`?view=collections&pendingPage=${page}`);
        const rows = payload.clientPayments.filter((row: { status: string }) => row.status === "PENDING");
        assert.equal(rows.length, page === 6 ? 2 : 50);
        assert.equal(payload.paymentsPagination.pending.total, 252);
        assert.equal(payload.paymentsPagination.pending.amount, 374000);
        assert.equal(payload.paymentsPagination.pending.pages, 6);
        for (const row of rows) { assert.equal(row.organizationId, org); assert.ok(!seen.has(row.id)); seen.add(row.id); }
      }
      assert.equal(seen.size, 252); assert.ok(seen.has(old.id));
      const last = await call("?view=collections&pendingPage=999&settledPage=999");
      assert.equal(last.paymentsPagination.pending.page, 6);
      assert.equal(last.paymentsPagination.settled.page, 5);
      assert.equal(last.clientPayments.filter((row: { status: string }) => row.status === "RECEIVED").length, 1);
    });
    await t.test("búsqueda y cliente filtran antes del límite y sus sumas corresponden a todo el resultado", async () => {
      const found = await call("?view=collections&q=remota%20única");
      assert.equal(found.clientPayments.length, 1); assert.equal(found.clientPayments[0].id, old.id);
      assert.equal(found.financeSummary.pendingTotal, 123000);
      const filtered = await call(`?view=collections&clientId=${oldClient.id}`);
      assert.equal(filtered.filterClient.id, oldClient.id);
      assert.equal(filtered.clientPayments.length, 1); assert.equal(filtered.financeSummary.pendingCount, 1);
      const many = await call("?view=collections&q=ordinario");
      assert.equal(many.paymentsPagination.pending.total, 251);
      assert.equal(many.financeSummary.pendingTotal, 251000);
      assert.equal(many.financeSummary.collected, 402000);
      assert.equal(many.clientPayments.length, 100);
      const received = await call("?view=collections&q=Cobrado");
      assert.equal(received.paymentsPagination.pending.total, 0);
      assert.equal(received.paymentsPagination.settled.total, 201);
      assert.equal(received.paymentsPagination.settled.amount, 402000);
    });
    await t.test("filtros de antigüedad incluyen sin fecha como al día y respetan el límite30/60", async () => {
      const current = await call("?view=collections&vence=al-dia");
      assert.equal(current.paymentsPagination.pending.total, 1);
      assert.equal(current.financeSummary.pendingTotal, 123000);
      const overdue = await call("?view=collections&vence=1-30");
      assert.equal(overdue.paymentsPagination.pending.total, 251);
      assert.equal(overdue.financeSummary.pendingTotal, 251000);
      assert.equal((await call("?view=collections&vence=31-60")).paymentsPagination.pending.total, 0);
      assert.equal((await call("?view=collections&vence=60-mas")).paymentsPagination.pending.total, 0);
    });
    await t.test("un cliente ajeno no revela identidad, filas ni importes", async () => {
      const payload = await call(`?view=collections&clientId=${foreign.id}`);
      assert.equal(payload.filterClient, null); assert.equal(payload.clientPayments.length, 0);
      assert.equal(payload.financeSummary.pendingTotal, 0); assert.equal(payload.financeSummary.collected, 0);
    });
    await t.test("la deuda de un cliente eliminado sigue accesible y rotulada", async () => {
      await db.client.update({ where: { id: oldClient.id }, data: { deletedAt: new Date() } });
      const payload = await call(`?view=collections&clientId=${oldClient.id}`);
      assert.match(payload.filterClient.name, /eliminado/);
      assert.match(payload.clientPayments[0].client.name, /eliminado/);
      assert.equal(payload.financeSummary.pendingTotal, 123000);
    });
    await t.test("seña y saldo se suman por separado; proveedor parcial informa sólo saldo real", async () => {
      const partial = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente de seña" } });
      await db.clientPayment.createMany({ data: [
        { id: randomUUID(), organizationId: org, clientId: partial.id, amount: 400, status: "RECEIVED", method: "Efectivo", paidAt: new Date() },
        { id: randomUUID(), organizationId: org, clientId: partial.id, amount: 600, status: "PENDING", method: "Pendiente" },
        { id: randomUUID(), organizationId: org, clientId: partial.id, amount: 5000, status: "CANCELLED", method: "Pendiente" },
      ] });
      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Proveedor de seña" } });
      await db.supplierJob.createMany({ data: [
        { id: randomUUID(), organizationId: org, supplierId: supplier.id, description: "Parcial", total: 1000, advance: 400, status: "ADVANCE_PAID" },
        { id: randomUUID(), organizationId: org, supplierId: supplier.id, description: "Pagado", total: 3000, advance: 3000, status: "PAID" },
        { id: randomUUID(), organizationId: org, supplierId: supplier.id, description: "Cancelado", total: 8000, advance: 1000, status: "CANCELLED" },
      ] });
      const payload = await call(`?view=collections&clientId=${partial.id}`);
      assert.equal(payload.financeSummary.collected, 400); assert.equal(payload.financeSummary.pendingTotal, 600);
      assert.equal(payload.paymentsPagination.settled.total, 2); assert.equal(payload.paymentsPagination.settled.amount, 400);
      assert.equal(payload.financeSummary.payable, 600); assert.equal(payload.financeSummary.advances, 4400);
      assert.equal(payload.financeSummary.jobsCount, 3);
      const overview = await call();
      assert.equal(overview.financeSummary.pendingTotal, 374600);
      assert.equal(overview.financeSummary.collected, 402400);
      assert.equal(overview.financeSummary.payable, 600);
    });
    await t.test("bordes de30/31/60/61 días y páginas inválidas conservan filtros coherentes", async () => {
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente de bordes" } });
      for (const day of [30, 31, 60, 61]) await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, amount: day, status: "PENDING", dueAt: dayStart(shiftDayKey(today, -day)) } });
      for (const [aging, count, amount] of [["1-30", 1, 30], ["31-60", 2, 91], ["60-mas", 1, 61]] as const) {
        const payload = await call(`?view=collections&clientId=${client.id}&vence=${aging}&pendingPage=-5`);
        assert.equal(payload.paymentsPagination.pending.page, 1);
        assert.equal(payload.paymentsPagination.pending.total, count);
        assert.equal(payload.financeSummary.pendingTotal, amount);
      }
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.adminUser.delete({ where: { id: uid } });
    await db.$disconnect();
  }
});
