import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas (sin `?schema`).
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/demo-sandbox-e4.pg.test.ts

function localDb() {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
}

// ── E4: métricas de sandboxes en Tráfico → Demo (criterio 20) ───────────────────────────────────────────
test("demo interactiva E4: getDemo cuenta creadas, activas, reinicios, escrituras, acciones y entidades; ninguna sandbox es empresa real", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  localDb();
  const { db } = await import("../lib/server/db");
  const queries = await import("../lib/platform/queries/trafico");
  const { resolvePeriod } = await import("../lib/platform/periods");
  const emp = await import("../lib/platform/queries/empresas");
  const { parseTableParams } = await import("../lib/platform/tablas");

  const tag = `zm${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const nsOf = (key: string) => (key + tag).replace(/[^a-z2-7]/g, "a").padEnd(10, "a").slice(0, 10);
  const orgIds: string[] = [];
  const sessionIds: string[] = [];
  t.after(async () => {
    await db.demoSession.deleteMany({ where: { id: { in: sessionIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  // «Ahora» en un día lejano: la base de la prueba puede tener otras sesiones demo.
  const now = new Date("2031-03-04T15:00:00Z");
  const range = resolvePeriod("hoy", now);
  const before = await queries.getDemo(range, now);

  const sandbox = async (key: string, data: Record<string, unknown> = {}) => {
    const ns = nsOf(key);
    const id = `sbx_${ns}_org`;
    orgIds.push(id);
    await db.organization.create({ data: { id, name: `${tag} ${key}`, slug: `demo-${ns}`, isDemo: true, demoParentId: "org_demo", demoReady: true, demoLastSeenAt: now, demoExpiresAt: new Date(now.getTime() + 86_400_000), ...data } as never });
    return { id, ns };
  };
  const audit = async (organizationId: string, id: string, entity: string) =>
    db.auditLog.create({ data: { id, organizationId, actorId: "x", actorName: "x", actorEmail: "x@x.dev", action: "create", entity, entityId: id, summary: "x" } });
  const session = async (key: string, data: Record<string, unknown>) => {
    const id = `ds-${tag}-${key}`;
    sessionIds.push(id);
    await db.demoSession.create({ data: { id, visitorHash: `${tag}${key}`.padEnd(16, "0").slice(0, 16), startedAt: now, lastSeenAt: now, ...data } as never });
    return id;
  };

  await t.test("creadas, activas, reinicios, % con escritura, acciones promedio y entidades (vivas + purgadas)", async () => {
    // A: viva, con escrituras (2 presupuestos y 1 evento) y datos del seed que no cuentan; con un reinicio.
    const a = await sandbox("a");
    await audit(a.id, `sbx_${a.ns}_seedaudit1`, "Client");
    await audit(a.id, `sbx_${a.ns}_seedaudit2`, "Client");
    await audit(a.id, `vis-${tag}-a1`, "Budget");
    await audit(a.id, `vis-${tag}-a2`, "Budget");
    await audit(a.id, `vis-${tag}-a3`, "Event");
    await session("a", { sandboxOrgId: a.id, resets: 1 });
    // B: ya purgada (no existe la empresa): sus acciones quedaron en la sesión.
    await session("b", { sandboxOrgId: `sbx_${nsOf("b")}_org`, actions: 4, actionsByEntity: { Budget: 3, Payment: 1 } });
    // C: viva, solo datos del seed: sin escrituras.
    const c = await sandbox("c");
    await audit(c.id, `sbx_${c.ns}_seedaudit1`, "Client");
    await session("c", { sandboxOrgId: c.id });
    // D: viva pero vencida por inactividad: no es «activa ahora».
    const d = await sandbox("d", { demoLastSeenAt: new Date(now.getTime() - 2 * 3_600_000) });
    await session("d", { sandboxOrgId: d.id });
    // Una demo vieja (vitrina, sin sandbox): no es una sandbox.
    await session("old", {});

    const demo = await queries.getDemo(range, now);
    const s = demo.sandboxes;
    assert.equal(s.created, 4, "A, B, C y D; la demo sin sandbox no cuenta");
    assert.equal(demo.started, before.started + 5, "las demos iniciadas siguen contando todas");
    assert.deepEqual(s.createdByDay.map((day) => day.created), [4]);
    assert.equal(s.measured, 4);
    assert.equal(s.activeNow - before.sandboxes.activeNow, 2, "A y C vigentes; D vencida por 1 h sin uso");
    assert.equal(s.resets, 1);
    assert.equal(s.withWrite, 2, "A (viva) y B (purgada)");
    assert.equal(s.withWritePct, 50);
    assert.equal(s.avgActions, 1.8, "(3 vivas de A + 4 purgadas de B) / 4 demos = 1,75");
    assert.deepEqual(s.topEntities, [
      { entity: "Budget", actions: 5 },
      { entity: "Event", actions: 1 },
      { entity: "Payment", actions: 1 },
    ], "los ids sbx_<ns>_* son del seed y no cuentan");
    assert.ok(!s.topEntities.some((row) => row.entity === "Client"));
  });

  await t.test("sin demos con sandbox no hay porcentajes ni promedios inventados", async () => {
    const empty = await queries.getDemo(resolvePeriod("hoy", new Date("2040-01-01T15:00:00Z")), new Date("2040-01-01T15:00:00Z"));
    assert.equal(empty.sandboxes.created, 0);
    assert.equal(empty.sandboxes.withWritePct, null);
    assert.equal(empty.sandboxes.avgActions, null);
    assert.deepEqual(empty.sandboxes.topEntities, []);
  });

  await t.test("ninguna sandbox cuenta como empresa real", async () => {
    const params = parseTableParams({ q: tag }, { sorts: emp.EMPRESA_SORTS, filterOptions: { activa: ["si", "no"], plan: [] } });
    const empresas = await emp.loadEmpresas(resolvePeriod("30d", new Date()), params);
    assert.deepEqual(empresas.rows, [], "la tabla de empresas no lista las sandboxes");
  });
});
