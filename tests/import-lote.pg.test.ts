import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
test("importar: cuerpo con tope real y lote atómico (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { claimImportLote, settleImportLote, readBodyLimited } = await import("../lib/server/import-lote");

  await t.test("sin content-length (chunked) el cuerpo que pasa el tope se corta igual", async () => {
    const stream = (chunks: number, size: number) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunks-- <= 0) return controller.close();
          controller.enqueue(new Uint8Array(size));
        },
      });
    const mk = (body: ReadableStream<Uint8Array>) => new Request("http://localhost/x", { method: "POST", body, duplex: "half" } as RequestInit);
    assert.equal((await readBodyLimited(mk(stream(4, 100)), 1000)).ok, true);
    assert.equal((await readBodyLimited(mk(stream(20, 100)), 1000)).ok, false, "2000 B sin content-length superan el tope de 1000");
    const declared = new Request("http://localhost/x", { method: "POST", body: "x", headers: { "content-length": "5000" } });
    assert.equal((await readBodyLimited(declared, 1000)).ok, false, "el content-length declarado mayor se rechaza sin leer");
  });

  await t.test("dos pedidos con el mismo lote: uno lo toma, el otro no; fallar lo libera y aplicar lo deja cerrado", async () => {
    const org = randomUUID();
    await db.organization.create({ data: { id: org, name: "Lote", slug: `lote-${org.slice(0, 8)}` } });
    try {
      const lote = randomUUID();
      const wins = await Promise.all([claimImportLote(org, lote), claimImportLote(org, lote), claimImportLote(org, lote)]);
      assert.equal(wins.filter(Boolean).length, 1, "solo uno toma el lote");
      await settleImportLote(org, lote, false);
      assert.equal(await claimImportLote(org, lote), true, "tras un fallo se puede reintentar");
      await settleImportLote(org, lote, true);
      assert.equal(await claimImportLote(org, lote), false, "aplicado: no se repite");
      const other = randomUUID();
      await db.organization.create({ data: { id: other, name: "Otra", slug: `lote-${other.slice(0, 8)}` } });
      assert.equal(await claimImportLote(other, lote), true, "el lote es por empresa");
      await db.organization.delete({ where: { id: other } });
    } finally {
      await db.organization.delete({ where: { id: org } });
      await db.$disconnect();
    }
  });
});
