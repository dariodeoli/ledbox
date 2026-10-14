import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/platform-tablas.pg.test.ts
test("panel de plataforma E1b: tablas de empresas y usuarios sin demo, con páginas, búsqueda y detalle en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { ensureDemoData, DEMO_USER_ID, DEMO_ORGANIZATION_ID } = await import("../lib/server/demo-data");
  const { resolvePeriod } = await import("../lib/platform/periods");
  const { parseTableParams, PAGE_SIZE } = await import("../lib/platform/tablas");
  const emp = await import("../lib/platform/queries/empresas");
  const usr = await import("../lib/platform/queries/usuarios");

  const tag = `Zzq${randomUUID().slice(0, 6)}`;
  const orgIds: string[] = [];
  const userIds: string[] = [];
  t.after(async () => {
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
  });
  await ensureDemoData({ reset: true } as never);
  const range = resolvePeriod("30d", new Date("2040-06-15T15:00:00Z"));
  const empParams = (raw: Record<string, string>) =>
    parseTableParams(raw, { sorts: emp.EMPRESA_SORTS, filterOptions: { activa: ["si", "no"], plan: [] } });
  const usrParams = (raw: Record<string, string>) =>
    parseTableParams(raw, { sorts: usr.USUARIO_SORTS, filterOptions: { activa: ["si", "no"], verificado: ["si", "no"], pin: ["si", "no"] } });

  // 35 empresas reales con el mismo prefijo; la primera tiene datos.
  for (let i = 0; i < 35; i += 1) {
    const id = `org-${tag}-${String(i).padStart(2, "0")}`;
    orgIds.push(id);
    await db.organization.create({ data: { id, name: `${tag} Empresa ${String(i).padStart(2, "0")}`, slug: `${tag.toLowerCase()}-${i}`, active: i !== 3 } });
  }
  const rich = orgIds[0];
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: rich, name: "C" } });
  const userId = randomUUID();
  userIds.push(userId);
  await db.adminUser.create({ data: { id: userId, name: `${tag} Persona`, email: `${tag.toLowerCase()}@test.dev`, passwordHash: "SECRETO-HASH", pinHash: "SECRETO-PIN", role: "ADMIN", emailVerifiedAt: new Date() } });
  await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId: rich, role: "ADMIN" } });
  await db.adminSession.create({ data: { id: randomUUID(), userId, jtiHash: "SECRETO-JTI", expiresAt: new Date("2041-01-01"), createdAt: new Date("2040-06-10T12:00:00Z") } });
  const mk = (total: number, extra: Record<string, unknown>) => db.budget.create({ data: { id: randomUUID(), organizationId: rich, clientId: client.id, title: "P", status: "APPROVED", subtotal: total, total, approvedAt: new Date("2040-06-10T12:00:00Z"), ...extra } as never });
  await mk(1_000_000, {});
  await mk(250_000, { deletedAt: new Date("2040-06-11T12:00:00Z") });
  await db.event.create({ data: { id: randomUUID(), organizationId: rich, clientId: client.id, name: "E1", startsAt: new Date("2040-06-20T12:00:00Z"), endsAt: new Date("2040-06-20T18:00:00Z"), status: "CONFIRMED" } });
  await db.event.create({ data: { id: randomUUID(), organizationId: rich, clientId: client.id, name: "E2", startsAt: new Date("2040-06-20T12:00:00Z"), endsAt: new Date("2040-06-20T18:00:00Z"), status: "CONFIRMED", deletedAt: new Date() } });
  const plan = await db.plan.findFirst({ select: { id: true } });
  if (plan) await db.planChangeRequest.create({ data: { id: randomUUID(), organizationId: rich, planId: plan.id, status: "pending", requestedByName: "Pide Plan" } });

  await t.test("criterio 15: 30 por página, página 2 con el resto, búsqueda ILIKE literal y orden por URL", async () => {
    const p1 = await emp.loadEmpresas(range, empParams({ q: tag }));
    assert.equal(p1.total, 35);
    assert.equal(p1.rows.length, PAGE_SIZE);
    const p2 = await emp.loadEmpresas(range, empParams({ q: tag, pag: "2" }));
    assert.equal(p2.rows.length, 5);
    assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size, 35, "sin repetidos entre páginas");
    assert.equal((await emp.loadEmpresas(range, empParams({ q: tag.toLowerCase() }))).total, 35, "ILIKE no distingue mayúsculas");
    assert.equal((await emp.loadEmpresas(range, empParams({ q: `${tag}%` }))).total, 0, "el % del usuario es literal");
    assert.equal((await emp.loadEmpresas(range, empParams({ q: "x'; DROP TABLE \"Organization\"; --" }))).total, 0, "texto hostil solo es parámetro");
    assert.equal((await emp.loadEmpresas(range, empParams({ q: tag, activa: "no" }))).total, 1);
    const byMoney = await emp.loadEmpresas(range, empParams({ q: tag, orden: "-monto" }));
    assert.equal(byMoney.rows[0].id, rich);
    const sortOnly = await emp.loadEmpresas(range, empParams({ q: tag, orden: "-nombre" }));
    assert.equal(sortOnly.rows[0].name.endsWith("34"), true);
  });

  await t.test("empresas: agregados del período, sin demo y con su contador aparte", async () => {
    const row = (await emp.loadEmpresas(range, empParams({ q: tag }))).rows.find((r) => r.id === rich)!;
    assert.equal(row.members, 1);
    assert.equal(row.events, 1, "el evento en papelera no cuenta");
    assert.equal(row.approved, 1_250_000, "el monto incluye lo eliminado");
    assert.equal(row.lastActivity, null);
    const all = await emp.loadEmpresas(range, empParams({ q: "demo" }));
    assert.equal(all.rows.some((r) => r.slug === "demo" || r.id === DEMO_ORGANIZATION_ID), false, "la demo no aparece");
    assert.ok(all.demoOrgs >= 1, "contador de demo aparte");
    assert.equal(await emp.loadEmpresaDetail(DEMO_ORGANIZATION_ID), null, "el detalle de la demo no existe");
    assert.equal(await emp.loadEmpresaDetail("no-existe"), null);
    const detail = await emp.loadEmpresaDetail(rich);
    assert.ok(detail && detail.usage, "uso del plan");
    if (plan) assert.equal(detail.pendingRequests.length, 1);
  });

  await t.test("usuarios: sin demo, sin hashes y con PIN/verificado como sí/no", async () => {
    const page = await usr.loadUsuarios(usrParams({ q: tag }));
    assert.equal(page.total, 1);
    const row = page.rows[0];
    assert.equal(row.hasPin, true);
    assert.equal(row.emailVerified, true);
    assert.deepEqual(row.companies, [{ org: `${tag} Empresa 00`, role: "ADMIN" }]);
    assert.equal(row.lastLogin?.toISOString(), "2040-06-10T12:00:00.000Z");
    const demoUser = await usr.loadUsuarios(usrParams({ q: "demo" }));
    assert.equal(demoUser.rows.some((r) => r.id === DEMO_USER_ID), false, "el visitante demo no aparece");
    assert.equal(await usr.loadUsuarioDetail(DEMO_USER_ID), null);
    const detail = await usr.loadUsuarioDetail(userId);
    assert.ok(detail && detail.memberships.length === 1);
    assert.equal((await usr.loadUsuarios(usrParams({ q: tag, pin: "no" }))).total, 0);
    assert.equal((await usr.loadUsuarios(usrParams({ q: tag, verificado: "si" }))).total, 1);
    // Criterio 17: nada con forma de hash o token en lo que llega a las páginas.
    const wire = JSON.stringify({ page, detail, e: await emp.loadEmpresas(range, empParams({ q: tag })) });
    assert.doesNotMatch(wire, /SECRETO|hash|token|password/i);
  });
});
