import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/platform-queries.pg.test.ts
// Los datos de la prueba caen en el año 2040 para no mezclarse con otras pruebas ni con la demo.
test("panel de plataforma E1a: consultas agregadas, demo aparte, día de Paraguay y papelera en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { ensureDemoData } = await import("../lib/server/demo-data");
  const { resolvePeriod } = await import("../lib/platform/periods");
  const { loadResumen } = await import("../lib/platform/queries/resumen");
  const { loadActividad } = await import("../lib/platform/queries/actividad");
  const { recordAdminActivity } = await import("../lib/platform/activity");

  const kpi = (data: Awaited<ReturnType<typeof loadResumen>>, key: string) => {
    const found = data.kpis.find((item) => item.key === key);
    assert.ok(found, `KPI ${key}`);
    return found;
  };

  await t.test("criterio 9: con la demo cargada y sin empresas reales todo da 0 y el contador de demo es > 0", async () => {
    await ensureDemoData({ reset: true } as never);
    const realOrgs = await db.organization.count({ where: { slug: { not: "demo" }, active: true } });
    const range = resolvePeriod("90d", new Date("2040-06-15T15:00:00Z"));
    const data = await loadResumen(range);
    assert.ok(data.demo.total > 0, "la demo se cuenta aparte");
    assert.equal(kpi(data, "empresas-reales").value, realOrgs, "la demo no cuenta como empresa real");
    for (const item of data.kpis) {
      if (item.key === "empresas-reales") continue;
      assert.equal(item.value, 0, `${item.key} no debe sumar nada del período vacío ni de la demo`);
    }
    // Aun mirando los días de la demo, sus datos no entran: período que cubre hoy.
    const now = await loadResumen(resolvePeriod("90d", new Date()));
    for (const key of ["eventos-creados", "presupuestos-enviados", "presupuestos-aprobados", "monto-aprobado", "cobros", "usuarios-activos", "ingresos"]) {
      const row = await db.organization.findMany({ where: { slug: { not: "demo" } }, select: { id: true } });
      if (row.length === 0) assert.equal(kpi(now, key).value, 0, `${key} sin empresas reales`);
    }
  });

  await t.test("criterios 10, 12 y 17: día de Paraguay, enviados sin duplicar, aprobados con eliminado aparte", async () => {
    const orgId = `org-${randomUUID()}`;
    const userId = randomUUID();
    t.after(async () => {
      // Limpieza: las filas de 2040 no deben quedar para otras pruebas.
      await db.organization.deleteMany({ where: { id: orgId } });
      await db.adminUser.deleteMany({ where: { id: userId } });
    });
    await db.organization.create({ data: { id: orgId, name: "Real E1a", slug: `real-${randomUUID().slice(0, 8)}`, createdAt: new Date("2040-06-14T14:00:00Z") } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: orgId, name: "Cliente E1a" } });
    await db.adminUser.create({ data: { id: userId, name: "Real", email: `real-${userId.slice(0, 8)}@test.dev`, passwordHash: "x", role: "ADMIN" } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId: orgId, role: "ADMIN" } });

    // 02:30 UTC del 15 = 23:30 del 14 en Paraguay: cae en el día anterior.
    const lateEvent = randomUUID();
    await db.event.create({ data: { id: lateEvent, organizationId: orgId, clientId: client.id, name: "A las 02:30 UTC", startsAt: new Date("2040-06-20T15:00:00Z"), endsAt: new Date("2040-06-20T20:00:00Z"), status: "CONFIRMED", createdAt: new Date("2040-06-15T02:30:00Z") } });
    const trashedEvent = randomUUID();
    await db.event.create({ data: { id: trashedEvent, organizationId: orgId, clientId: client.id, name: "En papelera", startsAt: new Date("2040-06-20T15:00:00Z"), endsAt: new Date("2040-06-20T20:00:00Z"), status: "CONFIRMED", createdAt: new Date("2040-06-15T12:00:00Z"), deletedAt: new Date("2040-06-15T13:00:00Z") } });

    const budget = async (total: number, extra: Record<string, unknown> = {}) => {
      const id = randomUUID();
      await db.budget.create({ data: { id, organizationId: orgId, clientId: client.id, title: `P ${id.slice(0, 4)}`, status: "APPROVED", subtotal: total, total, ...extra } as never });
      return id;
    };
    const a = await budget(1_000_000, { approvedAt: new Date("2040-06-15T14:00:00Z") });
    const b = await budget(2_500_000, { approvedAt: new Date("2040-06-15T16:00:00Z") });
    const trashed = await budget(500_000, { approvedAt: new Date("2040-06-15T17:00:00Z"), deletedAt: new Date("2040-06-15T18:00:00Z") });
    const audit = (entityId: string, action: string, detail: unknown) =>
      db.auditLog.create({ data: { id: randomUUID(), organizationId: orgId, actorId: userId, actorName: "Real", actorEmail: "r@test.dev", action, entity: "Budget", entityId, summary: "x", detail: detail as never, createdAt: new Date("2040-06-15T15:00:00Z") } as never });
    // El mismo presupuesto enviado dos veces (acción y cambio de estado) cuenta una sola.
    await audit(a, "send", null);
    await audit(a, "status", { changes: { status: { from: "DRAFT", to: "SENT" } } });
    await audit(b, "status", { changes: { status: { from: "DRAFT", to: "SENT" } } });
    await audit(trashed, "send", null);
    await audit(b, "status", { changes: { status: { from: "SENT", to: "APPROVED" } } });
    // Cobros: solo RECEIVED con paidAt en el período; uno es de un presupuesto eliminado.
    const pay = (amount: number, status: "RECEIVED" | "PENDING", budgetId: string | null) =>
      db.clientPayment.create({ data: { id: randomUUID(), organizationId: orgId, clientId: client.id, budgetId, amount, status, paidAt: new Date("2040-06-15T15:00:00Z") } });
    await pay(300_000, "RECEIVED", a);
    await pay(200_000, "RECEIVED", trashed);
    await pay(900_000, "PENDING", a);
    // Actividad y login.
    await recordAdminActivity({ userId, organizationId: orgId, now: new Date("2040-06-15T02:30:00Z") });
    await recordAdminActivity({ userId, organizationId: orgId, now: new Date("2040-06-15T15:10:00Z") });
    await db.adminSession.create({ data: { id: randomUUID(), userId, jtiHash: randomUUID(), expiresAt: new Date("2040-07-01T00:00:00Z"), createdAt: new Date("2040-06-15T15:00:00Z") } });

    const range = resolvePeriod("7d", new Date("2040-06-15T15:30:00Z"));
    const data = await loadResumen(range);
    const idx14 = range.days.indexOf("2040-06-14");
    const idx15 = range.days.indexOf("2040-06-15");
    assert.ok(idx14 >= 0 && idx15 >= 0);

    const creados = kpi(data, "eventos-creados");
    assert.equal(creados.value, 1, "el evento en papelera no entra en el conteo");
    assert.equal(creados.papelera, 1, "en papelera: 1");
    assert.equal(creados.series[idx14], 1, "criterio 10: 02:30 UTC cuenta en el día anterior de Paraguay");
    assert.equal(creados.series[idx15], 0);
    assert.equal(kpi(data, "empresas-nuevas").series[idx14], 1, "15:00 UTC del 14 sigue siendo el 14");

    assert.equal(kpi(data, "presupuestos-enviados").value, 2, "criterio 12: enviado dos veces cuenta 1 (a y b; el eliminado va aparte)");
    assert.equal(kpi(data, "presupuestos-enviados").papelera, 1);
    const aprobados = kpi(data, "presupuestos-aprobados");
    assert.equal(aprobados.value, 2);
    assert.equal(aprobados.papelera, 1);
    const monto = kpi(data, "monto-aprobado");
    assert.equal(monto.value, 4_000_000, "suma el total en PYG, eliminado incluido");
    assert.equal(monto.deleted, 500_000, "de esto, eliminado");
    assert.equal(monto.series[idx15], 4_000_000);
    const cobros = kpi(data, "cobros");
    assert.equal(cobros.value, 500_000, "solo RECEIVED");
    assert.equal(cobros.deleted, 200_000);
    assert.equal(kpi(data, "usuarios-activos").value, 1);
    assert.equal(kpi(data, "usuarios-activos").empty, null);
    assert.equal(kpi(data, "ingresos").value, 1);
    assert.equal(kpi(data, "empresas-activas").value, 1);

    const actividad = await loadActividad(range);
    const users = actividad.series.find((s) => s.key === "usuarios")!;
    assert.equal(users.values[idx14], 1, "la actividad de las 23:30 de Paraguay es del día 14");
    assert.equal(users.values[idx15], 1);
    assert.equal(actividad.hoursUsers[23], 1);
    assert.equal(actividad.hoursUsers[12], 1);
    assert.equal(actividad.hoursActions[12], 5, "5 acciones a las 12:00 de Paraguay");
    assert.equal(actividad.hoursActions.reduce((x, y) => x + y, 0), 5);
    assert.equal(actividad.series.find((s) => s.key === "acciones")!.total, 5);
    assert.equal(actividad.series.find((s) => s.key === "logins")!.total, 1);

    // Período anterior: nada → delta «nuevo».
    assert.deepEqual(creados.delta, { kind: "nuevo" });

    // Criterio 17: nada con forma de hash, token o contraseña llega a los componentes.
    const wire = JSON.stringify({ data, actividad });
    assert.doesNotMatch(wire, /hash|token|password|passwordHash|pinHash/i);
    assert.doesNotMatch(wire, /@test\.dev/, "ni correos");
  });
});
