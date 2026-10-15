import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/catalog-access-lists.pg.test.ts
test("emitir un acceso solo reemplaza el link de la misma lista (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { issueCatalogAccess } = await import("../lib/server/catalog-access");

  const org = randomUUID();
  try {
    await db.organization.create({ data: { id: org, name: "Empresa accesos", slug: `acc-${org.slice(0, 8)}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Diego", company: "Agencia", type: "RESELLER", email: "d@agencia.test", phone: "+595 984 000 111" } });
    const active = (priceList: "RETAIL" | "WHOLESALE") => db.catalogAccessToken.count({ where: { organizationId: org, clientId: client.id, priceList, revokedAt: null } });

    await t.test("un link RETAIL no revoca el WHOLESALE del mismo cliente, y al revés", async () => {
      await issueCatalogAccess(org, client.id, "WHOLESALE");
      await issueCatalogAccess(org, client.id, "RETAIL");
      assert.equal(await active("WHOLESALE"), 1);
      assert.equal(await active("RETAIL"), 1);
    });

    await t.test("reemitir la misma lista sí reemplaza el link anterior", async () => {
      await issueCatalogAccess(org, client.id, "RETAIL");
      assert.equal(await active("RETAIL"), 1, "queda un solo RETAIL vigente");
      assert.equal(await db.catalogAccessToken.count({ where: { organizationId: org, clientId: client.id, priceList: "RETAIL" } }), 2);
      assert.equal(await active("WHOLESALE"), 1);
      await issueCatalogAccess(org, client.id, "WHOLESALE");
      assert.equal(await active("WHOLESALE"), 1);
      assert.equal(await active("RETAIL"), 1);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
