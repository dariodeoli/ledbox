import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
test("idempotencia financiera serializa el intento antes de validar el negocio", { skip: !enabled, timeout: 60000 }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { withIdempotency } = await import("../lib/server/idempotency");
  const org = randomUUID(), other = randomUUID();
  await db.organization.createMany({ data: [org, other].map(id => ({ id, slug: `idem132-${id}`, name: "Empresa ficticia" })) });
  const options = (key: string, body: Record<string, unknown>, organizationId = org, scope = "test:132:cash") => ({ organizationId, scope, body, request: new Request("http://localhost/api/test", { headers: { "Idempotency-Key": key } }) });
  try {
    await t.test("la misma clave espera el primer commit y reproduce su resultado sin repetir el handler", async () => {
      const key = randomUUID();
      let ready!: () => void, release!: () => void, calls = 0, audits = 0;
      const entered = new Promise<void>(r => { ready = r; }), gate = new Promise<void>(r => { release = r; });
      const run = async () => { calls++; ready(); await gate; return { status: 201, body: { movement: "único" }, afterCommit: () => { audits++; } }; };
      const first = withIdempotency(options(key, { amount: 100 }), run);
      await entered;
      const replay = withIdempotency(options(key, { amount: 100 }), run);
      try {
        const deadline = Date.now() + 10000;
        while (true) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%'`;
          if (Number(rows[0].count) >= 1) break;
          assert.ok(Date.now() < deadline, "el reintento alcanzó el candado antes del handler");
          await new Promise(r => setTimeout(r, 10));
        }
        assert.equal(calls, 1);
      } finally { release(); }
      const [a, b] = await Promise.all([first, replay]);
      assert.equal(a.status, 201); assert.equal(b.status, 201);
      assert.deepEqual(await a.json(), await b.json());
      assert.equal(b.headers.get("Idempotent-Replay"), "true");
      assert.equal(calls, 1); assert.equal(audits, 1);
    });
    await t.test("la misma clave con otro cuerpo da409 y nunca ejecuta la segunda mutación", async () => {
      const key = randomUUID(); let calls = 0;
      const run = async () => { calls++; return { status: 201, body: { unique: true } }; };
      assert.equal((await withIdempotency(options(key, { amount: 100 }), run)).status, 201);
      assert.equal((await withIdempotency(options(key, { amount: 200 }), run)).status, 409);
      assert.equal(calls, 1);
    });
    await t.test("un fallo revierte la mutación y libera el intento para un reintento válido", async () => {
      const key = randomUUID(), id = randomUUID();
      await assert.rejects(withIdempotency(options(key, { amount: 100 }), async tx => {
        await tx.treasuryAccount.create({ data: { id, organizationId: org, name: "No debe sobrevivir" } });
        throw new Error("Fallo ficticio antes del commit");
      }), /Fallo ficticio/);
      assert.equal(await db.treasuryAccount.count({ where: { id } }), 0);
      assert.equal(await db.idempotencyKey.count({ where: { organizationId: org, key } }), 0);
      const response = await withIdempotency(options(key, { amount: 100 }), async tx => {
        await tx.treasuryAccount.create({ data: { id, organizationId: org, name: "Reintento válido" } });
        return { status: 201, body: { id } };
      });
      assert.equal(response.status, 201);
      assert.equal(await db.treasuryAccount.count({ where: { id } }), 1);
    });
    await t.test("la misma clave no mezcla empresas ni scopes", async () => {
      const key = randomUUID(); let calls = 0;
      const run = async () => ({ status: 201, body: { execution: ++calls } });
      const responses = await Promise.all([
        withIdempotency(options(key, { amount: 100 }), run),
        withIdempotency(options(key, { amount: 100 }, other), run),
        withIdempotency(options(key, { amount: 100 }, org, "test:132:expense"), run),
      ]);
      for (const response of responses) assert.equal(response.status, 201);
      assert.equal(calls, 3);
      assert.equal(await db.idempotencyKey.count({ where: { key } }), 3);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.$disconnect();
  }
});
