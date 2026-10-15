import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/tienda-temas.pg.test.ts
test("migración 202610300001_tienda_temas: reescribe solo la plantilla vieja, conserva el resto y es idempotente", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { LEGACY_TEMPLATE_MAP } = await import("../lib/storefront-templates");
  const { readAppearance } = await import("../lib/appearance");
  const sql = readFileSync(new URL("../prisma/migrations/202610300001_tienda_temas/migration.sql", import.meta.url), "utf8");

  const created: string[] = [];
  const make = async (appearance: unknown) => {
    const id = randomUUID();
    created.push(id);
    await db.organization.create({ data: { id, name: `Empresa ${id.slice(0, 6)}`, slug: `tema-${id.slice(0, 10)}`, ...(appearance === undefined ? {} : { appearance: appearance as never }) } });
    return id;
  };
  try {
    const rows = new Map<string, string>();
    for (const legacy of Object.keys(LEGACY_TEMPLATE_MAP)) rows.set(legacy, await make({ template: legacy, font: "inter", background: "#f6f1e8", script: true }));
    const sinPlantilla = await make({ font: "lato" });
    const nueva = await make({ template: "noir", font: "inter" });
    const nula = await make(undefined);

    const run = () => db.$executeRawUnsafe(sql);
    await run();
    const snapshot = async () => Object.fromEntries((await db.organization.findMany({ where: { id: { in: created } }, select: { id: true, appearance: true } })).map((row) => [row.id, JSON.stringify(row.appearance)]));
    const first = await snapshot();
    for (const [legacy, id] of rows) {
      const stored = JSON.parse(first[id]) as Record<string, unknown>;
      assert.equal(readAppearance(stored).template, LEGACY_TEMPLATE_MAP[legacy], `${legacy} → ${LEGACY_TEMPLATE_MAP[legacy]}`);
      assert.equal(stored.font, "inter", "las demás claves se conservan");
      assert.equal(readAppearance(stored).template, LEGACY_TEMPLATE_MAP[legacy]);
    }
    assert.deepEqual(JSON.parse(first[sinPlantilla]), { font: "lato" }, "sin plantilla: no se toca");
    assert.equal(JSON.parse(first[nueva]).template, "noir");
    assert.equal(first[nula], "null", "sin apariencia: no se crea una");
    // Re-ejecutable: una segunda corrida no cambia nada.
    await run();
    assert.deepEqual(await snapshot(), first);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: created } } });
  }
});
