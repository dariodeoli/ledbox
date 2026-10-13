import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/catalog-public.pg.test.ts
test("catálogo público y preórdenes en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { POST } = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const { loadPublicCatalogItems, resolvePublicCatalog, parsePublicRange, loadPublicOrder } = await import("../lib/server/catalog-public");
  const { convertQuoteRequest, holdQuoteRequestStock } = await import("../lib/server/catalog-convert");

  const orgs: string[] = [];
  const day = (n: number) => new Date(Date.UTC(2031, 0, n, 12));
  async function seed(opts: { enabled?: boolean; deposit?: number | null; prices?: boolean; stock?: number } = {}) {
    const org = randomUUID();
    orgs.push(org);
    const slug = `cat-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    await db.organizationRentalSettings.create({
      data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: opts.enabled ?? true, publicShowPrices: opts.prices ?? true, depositPercent: opts.deposit === undefined ? 50 : opts.deposit, whatsappPhone: "+595981123456" },
    });
    const visible = await db.inventoryItem.create({
      data: { id: randomUUID(), organizationId: org, name: "Pantalla visible", category: "Pantallas", sku: "PV-1", quantity: opts.stock ?? 5, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 100_000, dailyCost: 33_333, replacementCost: 7_777_777, wholesalePrice: 55_555, minimumPrice: 44_444, notes: "NOTA-INTERNA-SECRETA" },
    });
    const hidden = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Oculto", category: "Pantallas", quantity: 3, visibleOnWeb: false, catalogAudience: "HIDDEN" } });
    return { org, slug, visible, hidden };
  }
  let ipCounter = 0;
  const post = (slug: string, body: Record<string, unknown>, headers: Record<string, string> = {}, ip = `10.0.0.${++ipCounter}`) =>
    POST(new Request(`http://localhost/api/catalog/${slug}/preorder`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgSlug: slug }) });
  const future = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const body = (itemId: string, extra: Record<string, unknown> = {}) => ({
    name: "Ana Pérez", phone: "+595 981 000 111", email: "Ana@Example.com", location: "Asunción", from: future(10), to: future(11),
    items: [{ inventoryId: itemId, quantity: 2 }], ...extra,
  });

  try {
    await t.test("la migración del catálogo aplicada dos veces no falla", () => {
      const file = new URL("../prisma/migrations/202610140001_catalog_preorders/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
    });

    await t.test("catálogo apagado o empresa inexistente: no existe (404)", async () => {
      const off = await seed({ enabled: false });
      assert.equal(await resolvePublicCatalog(off.slug), null);
      assert.equal(await resolvePublicCatalog("no-existe-jamas"), null);
      const res = await post(off.slug, body(off.visible.id));
      assert.equal(res.status, 404);
    });

    await t.test("el catálogo no expone costos ni notas ni ítems ocultos ni de otra empresa", async () => {
      const a = await seed();
      const b = await seed();
      const context = await resolvePublicCatalog(a.slug);
      assert.ok(context);
      const json = JSON.stringify(await loadPublicCatalogItems(context!, null));
      for (const secret of ["33333", "7777777", "55555", "44444", "NOTA-INTERNA-SECRETA", "dailyCost", "replacementCost", "wholesale", "minimumPrice", "costPrice", "notes", "Oculto", b.visible.id]) {
        assert.ok(!json.includes(secret), `no debe exponer ${secret}`);
      }
      assert.ok(json.includes(a.visible.id));
      const range = parsePublicRange(future(10), future(11));
      const withDates = await loadPublicCatalogItems(context!, range);
      assert.ok(["AVAILABLE", "LOW", "CONSULT"].includes(withDates[0].availability as string));
      assert.ok(!/"available"\s*:\s*\d|"total"/.test(JSON.stringify(withDates)));
    });

    await t.test("sin mostrar precios el catálogo no manda precios", async () => {
      const s = await seed({ prices: false });
      const items = await loadPublicCatalogItems((await resolvePublicCatalog(s.slug))!, null);
      assert.equal(items[0].price, null);
    });

    await t.test("preorden: crea lead y pedido de ESA empresa, no toca EventInventory y reenviar la clave no duplica", async () => {
      const a = await seed();
      const b = await seed();
      const before = await db.eventInventory.count({ where: { OR: [{ organizationId: a.org }, { event: { organizationId: a.org } }] } });
      const key = randomUUID();
      const first = await post(a.slug, body(a.visible.id), { "Idempotency-Key": key });
      assert.equal(first.status, 201);
      const data = (await first.json()) as { preorder: { token: string; respondBy: string; whatsappUrl: string | null; subtotal: number } };
      assert.equal(data.preorder.subtotal, 100_000 * 2 * 2);
      assert.ok(data.preorder.whatsappUrl?.startsWith("https://wa.me/595981123456"));
      const second = await post(a.slug, body(a.visible.id), { "Idempotency-Key": key });
      assert.equal(second.status, 201);
      assert.equal(((await second.json()) as typeof data).preorder.token, data.preorder.token);
      assert.equal(await db.quoteRequest.count({ where: { organizationId: a.org } }), 1);
      assert.equal(await db.lead.count({ where: { organizationId: a.org } }), 1);
      assert.equal(await db.lead.count({ where: { organizationId: b.org } }), 0);
      assert.equal(await db.eventInventory.count({ where: { OR: [{ organizationId: a.org }, { event: { organizationId: a.org } }] } }), before, "una preorden no compromete stock");
      const quote = await db.quoteRequest.findFirstOrThrow({ where: { organizationId: a.org }, include: { items: true } });
      assert.equal(quote.status, "NEW");
      assert.ok(quote.startsAt && quote.endsAt && quote.respondBy);
      assert.equal(quote.items[0].inventoryId, a.visible.id);
      // Misma clave con otro cuerpo: 409.
      const clash = await post(a.slug, body(a.visible.id, { location: "Luque" }), { "Idempotency-Key": key });
      assert.equal(clash.status, 409);
      // Otro pedido del mismo correo reutiliza el lead abierto.
      assert.equal((await post(a.slug, body(a.visible.id))).status, 201);
      assert.equal(await db.lead.count({ where: { organizationId: a.org } }), 1);
      // Seguimiento: sin datos internos.
      const view = JSON.stringify(await loadPublicOrder(data.preorder.token));
      for (const hidden of ["leadId", "organizationId", "internalNotes", "ana@example.com", "Ana Pérez", a.visible.id]) assert.ok(!view.includes(hidden), hidden);
    });

    await t.test("un artículo de otra empresa u oculto se rechaza", async () => {
      const a = await seed();
      const b = await seed();
      assert.equal((await post(a.slug, body(b.visible.id))).status, 400);
      assert.equal((await post(a.slug, body(a.hidden.id))).status, 400);
    });

    await t.test("honeypot y validación", async () => {
      const a = await seed();
      assert.equal((await post(a.slug, body(a.visible.id, { website: "http://spam" }))).status, 400);
      assert.equal((await post(a.slug, body(a.visible.id, { email: "no-es-correo" }))).status, 400);
      assert.equal((await post(a.slug, body(a.visible.id, { from: future(12), to: future(11) }))).status, 400);
    });

    await t.test("pasado el límite responde 429", async () => {
      const a = await seed();
      const ip = "203.0.113.77";
      let last = 0;
      for (let i = 0; i < 11; i++) last = (await post(a.slug, body(a.visible.id), {}, ip)).status;
      assert.equal(last, 429);
    });

    await t.test("convertir: líneas, seña 50 %, estados y 409 la segunda vez", async () => {
      const a = await seed({ deposit: 50 });
      const res = await post(a.slug, body(a.visible.id));
      const { preorder } = (await res.json()) as { preorder: { token: string } };
      const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: preorder.token } });
      const ctx = { organizationId: a.org, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } } as never;
      const out = await convertQuoteRequest(ctx, quote.id);
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.budget.total, 100_000 * 2 * 2);
      assert.equal(out.deposit.amount, 200_000, "50 % del total");
      const budget = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: true } });
      assert.equal(budget.quoteRequestId, quote.id);
      assert.equal(budget.items[0].inventoryId, a.visible.id);
      assert.equal(budget.items[0].days, 2);
      assert.equal(budget.items[0].quantity, 2);
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status, "CONVERTED");
      assert.equal((await db.lead.findFirstOrThrow({ where: { organizationId: a.org } })).status, "QUOTED");
      const again = await convertQuoteRequest(ctx, quote.id);
      assert.equal(!again.ok && again.status, 409);
      assert.equal(await db.budget.count({ where: { organizationId: a.org } }), 1);
      // Carrera: dos conversiones simultáneas, una sola gana.
      const r2 = await post(a.slug, body(a.visible.id, { email: "otra@example.com", phone: "+595 982 222 333" }));
      const q2 = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: ((await r2.json()) as { preorder: { token: string } }).preorder.token } });
      const race = await Promise.all([convertQuoteRequest(ctx, q2.id), convertQuoteRequest(ctx, q2.id)]);
      assert.equal(race.filter((r) => r.ok).length, 1);
      assert.equal(race.filter((r) => !r.ok && r.status === 409).length, 1);
      // Pedido de otra empresa: 404.
      const other = await seed();
      const foreign = await convertQuoteRequest({ organizationId: other.org, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } } as never, quote.id);
      assert.equal(!foreign.ok && foreign.status, 404);
    });

    await t.test("sin depositPercent no hay seña", async () => {
      const a = await seed({ deposit: null });
      const res = await post(a.slug, body(a.visible.id));
      const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: ((await res.json()) as { preorder: { token: string } }).preorder.token } });
      const out = await convertQuoteRequest({ organizationId: a.org, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } } as never, quote.id);
      assert.ok(out.ok);
      const budget = await db.budget.findFirstOrThrow({ where: { organizationId: a.org } });
      assert.equal(budget.advanceAmount, 0);
      assert.equal(budget.installmentsJson, null);
    });

    await t.test("retener stock: compromete con hold y es todo o nada", async () => {
      const a = await seed({ stock: 3 });
      const ctx = { organizationId: a.org, organization: { planId: null }, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } } as never;
      const mk = async (qty: number, email: string) => {
        const res = await post(a.slug, { ...body(a.visible.id, { email, phone: `+595 98${qty} 000 111` }), items: [{ inventoryId: a.visible.id, quantity: qty }] });
        const q = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: ((await res.json()) as { preorder: { token: string } }).preorder.token } });
        assert.ok((await convertQuoteRequest(ctx, q.id)).ok);
        return q.id;
      };
      const q1 = await mk(2, "uno@example.com");
      const q2 = await mk(2, "dos@example.com");
      const held = await holdQuoteRequestStock(ctx, q1);
      assert.ok(held.ok);
      const row = await db.eventInventory.findFirstOrThrow({ where: { inventoryId: a.visible.id } });
      assert.ok(row.holdExpiresAt && row.holdExpiresAt.getTime() > Date.now());
      const events = await db.event.count({ where: { organizationId: a.org } });
      const denied = await holdQuoteRequestStock(ctx, q2);
      assert.equal(!denied.ok && denied.status, 409);
      assert.equal(await db.event.count({ where: { organizationId: a.org } }), events, "el evento fallido se deshace");
      assert.equal(await db.eventInventory.count({ where: { inventoryId: a.visible.id } }), 1);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "catalog:preorder:" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
