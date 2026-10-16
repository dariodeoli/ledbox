import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Deterministic interleaving: family operation must be blocked by the importer
// before allowing the importer to commit, not merely scheduled concurrently.
test("family common price never overwrites an imported newly-own price", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); process.env.DATABASE_URL = url.toString(); process.env.AUTH_SECRET ||= "selective-family-local-fixture-secret";
  const { db } = await import("../lib/server/db");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { applySamePrice } = await import("../lib/server/inventory-families");
  const { previewSelectedPrices, applySelectedPrices } = await import("../lib/server/import-selected-prices");
  const org = randomUUID(); await db.organization.create({ data: { id: org, name: "Selected family race", slug: `selected-race-${org}` } });
  const realTransaction = db.$transaction.bind(db);
  let releaseWrite!: () => void; const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  let reachedWrite!: () => void; const writeReached = new Promise<void>(resolve => { reachedWrite = resolve; });
  let importJob: Promise<Response> | undefined, familyJob: Promise<unknown> | undefined;
  try {
    const family = await db.inventoryFamily.create({ data: { id: randomUUID(), organizationId: org, code: "F", name: "Race", axes: [] } });
    const source = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, sku: "SOURCE", name: "Source", category: "Fixture", familyId: family.id, variantKey: "source", listPrice: 2000, quantity: 0 } });
    const target = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, sku: "TARGET", name: "Target", category: "Fixture", familyId: family.id, variantKey: "target", listPrice: 1000, quantity: 0 } });
    const raw = { productos: [{ codigo: "TARGET", cambios: { listPrice: { op: "REPLACE", value: 1500 } } }] };
    const context = portalAuditContext(org, "Family race fixture"); const preview = await (await previewSelectedPrices(context, raw)).json();
    (db as any).$transaction = (callback: any, options: any) => realTransaction(async (tx: any) => {
      const itemDelegate = new Proxy(tx.inventoryItem, { get(delegate, key) {
        if (key === "update") return async (args: any) => { if (args.where.id === target.id && args.data.listPrice === 1500) { reachedWrite(); await writeGate; } return delegate.update(args); };
        const value = delegate[key]; return typeof value === "function" ? value.bind(delegate) : value;
      } });
      return callback(new Proxy(tx, { get(t, key) { if (key === "inventoryItem") return itemDelegate; const value = t[key]; return typeof value === "function" ? value.bind(t) : value; } }));
    }, options);
    importJob = applySelectedPrices(context, raw, preview.confirmationToken, randomUUID(), new Request("http://localhost/api/admin/import/productos"));
    await writeReached;
    let gotPid!: (pid: number) => void; const pidReady = new Promise<number>(resolve => { gotPid = resolve; });
    familyJob = realTransaction(async tx => {
      const [row] = await tx.$queryRawUnsafe<Array<{ pid: number }>>("SELECT pg_backend_pid() AS pid"); gotPid(row.pid);
      return applySamePrice(tx, org, family.id, source.id);
    }, { timeout: 20000 });
    const familyPid = await pidReady;
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const [state] = await db.$queryRawUnsafe<Array<{ count: number }>>("SELECT cardinality(pg_blocking_pids($1::int))::int AS count", familyPid);
      if (state.count > 0) { blocked = true; break; }
    }
    assert.equal(blocked, true, "family operation must actually wait for importer, not race by chance");
    releaseWrite(); assert.equal((await importJob).status, 200);
    const familyResult = await familyJob as { ok: boolean; updatedIds?: string[] }; assert.equal(familyResult.ok, true); assert.ok(!familyResult.updatedIds?.includes(target.id));
    const final = await db.inventoryItem.findUniqueOrThrow({ where: { id: target.id } }); assert.equal(final.variantOwnPrice, true); assert.equal(final.listPrice, 1500);
  } finally {
    releaseWrite(); (db as any).$transaction = realTransaction;
    await Promise.allSettled([importJob, familyJob].filter(Boolean) as Promise<unknown>[]);
    await db.organization.deleteMany({ where: { id: org } }); await db.$disconnect();
  }
});
