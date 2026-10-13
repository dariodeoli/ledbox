import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/storefront.pg.test.ts
test("tienda web por empresa: catálogo de cliente final, catálogo mayorista y links privados en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const retailRoute = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const wholesaleRoute = await import("../app/api/catalog/[orgSlug]/mayorista/[token]/preorder/route");
  const logoRoute = await import("../app/api/catalog/[orgSlug]/logo/[variant]/route");
  const catalog = await import("../lib/server/catalog-public");
  const access = await import("../lib/server/catalog-access");
  const { convertQuoteRequest } = await import("../lib/server/catalog-convert");

  const orgs: string[] = [];
  async function seed(opts: { enabled?: boolean; prices?: boolean } = {}) {
    const org = randomUUID();
    orgs.push(org);
    const slug = `tienda-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    await db.organizationRentalSettings.create({
      data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: opts.enabled ?? true, publicShowPrices: opts.prices ?? true, depositPercent: 50, whatsappPhone: "+595981123456", storefrontTagline: "Frase de prueba", storefrontAccent: "#0e7490", storefrontEmail: "ventas@empresa.test" },
    });
    // Precios distintos por lista y por producto, para detectar cualquier cruce.
    const item = (name: string, catalogAudience: string | null, extra: Record<string, unknown> = {}) =>
      db.inventoryItem.create({
        data: {
          id: randomUUID(), organizationId: org, name, category: "Pantallas", quantity: 5, visibleOnWeb: catalogAudience !== "HIDDEN" && catalogAudience !== null, catalogAudience,
          listPrice: 100_000, wholesalePrice: 61_111, minimumPrice: 44_444, dailyCost: 33_333, replacementCost: 7_777_777, notes: "NOTA-INTERNA-SECRETA", ...extra,
        },
      });
    const retail = await item("Solo cliente final", "RETAIL");
    const wholesale = await item("Solo mayorista", "WHOLESALE", { listPrice: 99_999, wholesalePrice: 52_222 });
    const both = await item("En ambos", "BOTH", { listPrice: 120_000, wholesalePrice: 70_707 });
    const hidden = await item("Oculto", "HIDDEN");
    const legacy = await item("Fila vieja", null, { visibleOnWeb: true });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Diego Mayorista", company: "Agencia Mayorista", type: "RESELLER", email: "diego@agencia.test", phone: "+595 984 000 111" } });
    return { org, slug, retail, wholesale, both, hidden, legacy, client };
  }
  let ipCounter = 0;
  const future = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const form = (itemId: string, extra: Record<string, unknown> = {}) => ({
    name: "Ana Pérez", phone: "+595 981 000 111", email: "ana@example.com", location: "Asunción", from: future(10), to: future(11),
    items: [{ inventoryId: itemId, quantity: 2 }], ...extra,
  });
  const ip = () => `10.9.0.${++ipCounter}`;
  const postRetail = (slug: string, body: Record<string, unknown>, headers: Record<string, string> = {}, address = ip()) =>
    retailRoute.POST(new Request(`http://localhost/api/catalog/${slug}/preorder`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": address, ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgSlug: slug }) });
  const postWholesale = (slug: string, token: string, body: Record<string, unknown>, headers: Record<string, string> = {}, address = ip()) =>
    wholesaleRoute.POST(new Request(`http://localhost/api/catalog/${slug}/mayorista/${token}/preorder`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": address, ...headers }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgSlug: slug, token }) });

  try {
    await t.test("las migraciones de la tienda aplicadas dos veces no fallan y el backfill no pisa lo elegido", async () => {
      const a = await seed();
      const dir = new URL("../prisma/migrations/", import.meta.url).pathname;
      // Fila vieja sin alcance: el backfill la lleva a BOTH / HIDDEN según el booleano.
      const oldOn = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: a.org, name: "Vieja visible", category: "X", visibleOnWeb: true } });
      const oldOff = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: a.org, name: "Vieja oculta", category: "X", visibleOnWeb: false } });
      for (let i = 0; i < 2; i++) {
        for (const name of ["202610160001_inventory_catalog_audience", "202610160002_company_storefront"]) {
          execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", `${dir}${name}/migration.sql`], { stdio: "pipe" });
        }
      }
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: oldOn.id } })).catalogAudience, "BOTH");
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: oldOff.id } })).catalogAudience, "HIDDEN");
      // Lo que la empresa eligió después (RETAIL, WHOLESALE…) sobrevive a la segunda ejecución.
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: a.retail.id } })).catalogAudience, "RETAIL");
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: a.wholesale.id } })).catalogAudience, "WHOLESALE");
      assert.equal((await db.quoteRequest.count({ where: { organizationId: a.org, priceList: { not: "RETAIL" } } })), 0);
    });

    await t.test("tienda apagada o inexistente: 404 para el público, el mayorista y el pedido", async () => {
      const off = await seed({ enabled: false });
      const issued = await access.issueCatalogAccess(off.org, off.client.id);
      assert.ok(issued);
      assert.equal(await catalog.resolvePublicCatalog(off.slug), null);
      assert.equal(await catalog.resolveWholesaleCatalog(off.slug, issued!.token), null, "apagada la tienda, el link mayorista tampoco abre");
      assert.equal(await catalog.resolvePublicCatalog("no-existe-jamas"), null);
      assert.equal((await postRetail(off.slug, form(off.retail.id))).status, 404);
      assert.equal((await postWholesale(off.slug, issued!.token, form(off.wholesale.id))).status, 404);
      const logo = await logoRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ orgSlug: off.slug, variant: "dark" }) });
      assert.equal(logo.status, 404);
    });

    await t.test("el catálogo público nunca muestra productos mayoristas ni precios mayoristas", async () => {
      const a = await seed();
      const context = (await catalog.resolvePublicCatalog(a.slug))!;
      const items = await catalog.loadPublicCatalogItems(context, null);
      const names = items.map((item) => item.name).sort();
      assert.deepEqual(names, ["En ambos", "Fila vieja", "Solo cliente final"], "RETAIL, BOTH y las filas viejas visibles; nunca WHOLESALE ni ocultos");
      const json = JSON.stringify(items);
      for (const secret of [a.wholesale.id, "Solo mayorista", "61111", "52222", "70707", "99999", "wholesale", "33333", "7777777", "44444", "NOTA-INTERNA-SECRETA", "dailyCost", "replacementCost", "minimumPrice", "Oculto"]) {
        assert.ok(!json.includes(secret), `el público no debe ver ${secret}`);
      }
      const both = items.find((item) => item.name === "En ambos")!;
      assert.deepEqual(both.price, { unit: 120_000, fromDays: 0, fromPrice: 0 }, "precio de lista del cliente final");
      // Y no se puede pedir un producto mayorista por el endpoint público.
      assert.equal((await postRetail(a.slug, form(a.wholesale.id))).status, 400);
      assert.equal((await postRetail(a.slug, form(a.hidden.id))).status, 400);
      // Sin mostrar precios: «Consultar», aunque exista precio.
      const quiet = await seed({ prices: false });
      const noPrices = await catalog.loadPublicCatalogItems((await catalog.resolvePublicCatalog(quiet.slug))!, null);
      assert.ok(noPrices.every((item) => item.price === null));
    });

    await t.test("el catálogo mayorista muestra WHOLESALE y BOTH con precio mayorista, sin costos ni notas ni precios de lista", async () => {
      const a = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      const context = (await catalog.resolveWholesaleCatalog(a.slug, issued.token))!;
      assert.ok(context);
      assert.equal(context.access?.client.id, a.client.id);
      const items = await catalog.loadPublicCatalogItems(context, null);
      assert.deepEqual(items.map((item) => item.name).sort(), ["En ambos", "Solo mayorista"], "WHOLESALE y BOTH; nunca RETAIL ni oculto ni fila vieja");
      assert.equal(items.find((item) => item.name === "En ambos")!.price?.unit, 70_707);
      assert.equal(items.find((item) => item.name === "Solo mayorista")!.price?.unit, 52_222);
      const json = JSON.stringify(items);
      for (const secret of ["120000", "99999", "33333", "7777777", "44444", "NOTA-INTERNA-SECRETA", "dailyCost", "replacementCost", "minimumPrice", "listPrice", "notes", "Solo cliente final", "Fila vieja", "Oculto", a.retail.id]) {
        assert.ok(!json.includes(secret), `el mayorista no debe ver ${secret}`);
      }
      const storefront = JSON.stringify(await catalog.loadStorefront(context));
      for (const secret of ["organizationId", "leadId", "tokenHash", issued.token]) assert.ok(!storefront.includes(secret), secret);
    });

    await t.test("el token se guarda solo como hash y un token revocado, ajeno o mal formado es 404", async () => {
      const a = await seed();
      const b = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      const stored = await db.catalogAccessToken.findUniqueOrThrow({ where: { id: issued.id } });
      assert.equal(stored.tokenHash, access.catalogTokenHash(issued.token));
      assert.ok(!JSON.stringify(stored).includes(issued.token), "el token plano no se persiste");
      assert.ok(await catalog.resolveWholesaleCatalog(a.slug, issued.token));
      // Token de la empresa A con el slug de la empresa B: 404.
      assert.equal(await catalog.resolveWholesaleCatalog(b.slug, issued.token), null);
      // Mal formado o inventado.
      assert.equal(await catalog.resolveWholesaleCatalog(a.slug, "lbxw_corto"), null);
      assert.equal(await catalog.resolveWholesaleCatalog(a.slug, `lbxw_${"A".repeat(32)}`), null);
      // Cliente inactivo: el link deja de abrir.
      await db.client.update({ where: { id: a.client.id }, data: { active: false } });
      assert.equal(await catalog.resolveWholesaleCatalog(a.slug, issued.token), null);
      await db.client.update({ where: { id: a.client.id }, data: { active: true } });
      // Revocado: 404 y el POST también.
      assert.equal(await access.revokeCatalogAccess(a.org, a.client.id), 1);
      assert.equal(await catalog.resolveWholesaleCatalog(a.slug, issued.token), null);
      assert.equal((await postWholesale(a.slug, issued.token, form(a.wholesale.id))).status, 404);
      assert.equal(await access.revokeCatalogAccess(a.org, a.client.id), 0, "revocar dos veces no falla");
      // Un cliente de otra empresa no se puede compartir ni consultar desde esta.
      assert.equal(await access.issueCatalogAccess(a.org, b.client.id), null);
      assert.equal(await access.catalogAccessStatus(a.org, b.client.id), null);
      assert.equal(await access.revokeCatalogAccess(a.org, b.client.id), 0);
      assert.equal(await db.catalogAccessToken.count({ where: { clientId: b.client.id } }), 0);
    });

    await t.test("generar un link nuevo revoca el anterior y registra el último uso", async () => {
      const a = await seed();
      const first = (await access.issueCatalogAccess(a.org, a.client.id))!;
      const second = (await access.issueCatalogAccess(a.org, a.client.id))!;
      assert.equal(await catalog.resolveWholesaleCatalog(a.slug, first.token), null);
      assert.ok(await catalog.resolveWholesaleCatalog(a.slug, second.token));
      const status = (await access.catalogAccessStatus(a.org, a.client.id))!;
      assert.ok(status.active?.lastUsedAt, "el primer uso queda registrado");
      assert.equal(status.revoked, 1);
      assert.ok(!JSON.stringify(status).includes(second.token), "el estado nunca devuelve el token");
    });

    await t.test("pedido mayorista: queda vinculado al cliente del token, con lista WHOLESALE y presupuesto con precios mayoristas", async () => {
      const a = await seed();
      const other = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      const res = await postWholesale(a.slug, issued.token, { ...form(a.both.id), email: "otra-persona@agencia.test" }, { "Idempotency-Key": randomUUID() });
      assert.equal(res.status, 201);
      const { preorder } = (await res.json()) as { preorder: { token: string; subtotal: number } };
      assert.equal(preorder.subtotal, 70_707 * 2 * 2, "el subtotal usa el precio mayorista");
      const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: preorder.token }, include: { items: true } });
      assert.equal(quote.priceList, "WHOLESALE");
      assert.equal(quote.clientId, a.client.id);
      assert.equal(quote.organizationId, a.org);
      assert.equal(quote.items[0].unitPrice, 70_707);
      const lead = await db.lead.findFirstOrThrow({ where: { organizationId: a.org } });
      assert.equal(lead.source, "catalogo-mayorista");
      assert.equal(await db.lead.count({ where: { organizationId: other.org } }), 0);
      // Cambió el precio de lista y el mayorista: la conversión toma el mayorista VIGENTE.
      await db.inventoryItem.update({ where: { id: a.both.id }, data: { wholesalePrice: 66_000 } });
      const ctx = { organizationId: a.org, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } } as never;
      const clientsBefore = await db.client.count({ where: { organizationId: a.org } });
      const out = await convertQuoteRequest(ctx, quote.id);
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.client.id, a.client.id, "el presupuesto es del cliente del link, no de un cliente nuevo");
      assert.equal(out.clientCreated, false);
      assert.equal(await db.client.count({ where: { organizationId: a.org } }), clientsBefore, "no se crea otro cliente");
      assert.equal(out.budget.total, 66_000 * 2 * 2, "el presupuesto usa precios mayoristas");
      const budget = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: true } });
      assert.equal(budget.clientId, a.client.id);
      assert.equal(budget.items[0].unitPrice, 66_000);
      assert.match(budget.title, /^Pedido mayorista/);
      // El mismo pedido hecho por el catálogo público cotiza con la lista.
      const retail = await postRetail(a.slug, form(a.both.id, { email: "publico@example.com", phone: "+595 982 777 888" }));
      const retailQuote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: ((await retail.json()) as { preorder: { token: string } }).preorder.token } });
      assert.equal(retailQuote.priceList, "RETAIL");
      assert.equal(retailQuote.clientId, null);
      const retailOut = await convertQuoteRequest(ctx, retailQuote.id);
      assert.ok(retailOut.ok && retailOut.budget.total === 120_000 * 2 * 2);
      // Un pedido mayorista de OTRA empresa no se puede convertir desde esta (404).
      const foreign = await convertQuoteRequest({ organizationId: other.org, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } } as never, quote.id);
      assert.equal(!foreign.ok && foreign.status, 404);
      // El seguimiento dice que fue mayorista y no expone datos internos.
      const view = await catalog.loadPublicOrder(preorder.token);
      assert.equal(view?.priceList, "WHOLESALE");
      const json = JSON.stringify(view);
      for (const hidden of ["leadId", "organizationId", "clientId", a.client.id, "diego@agencia.test", "otra-persona@agencia.test", issued.token]) assert.ok(!json.includes(hidden), hidden);
    });

    await t.test("el catálogo mayorista no acepta productos de otra lista ni de otra empresa", async () => {
      const a = await seed();
      const b = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      assert.equal((await postWholesale(a.slug, issued.token, form(a.retail.id))).status, 400, "RETAIL no se pide por el mayorista");
      assert.equal((await postWholesale(a.slug, issued.token, form(a.hidden.id))).status, 400);
      assert.equal((await postWholesale(a.slug, issued.token, form(b.wholesale.id))).status, 400, "producto de otra empresa");
      assert.equal(await db.quoteRequest.count({ where: { organizationId: a.org } }), 0);
    });

    await t.test("mayorista: honeypot, validación e idempotencia", async () => {
      const a = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      assert.equal((await postWholesale(a.slug, issued.token, form(a.both.id, { website: "http://spam" }))).status, 400);
      assert.equal((await postWholesale(a.slug, issued.token, form(a.both.id, { email: "no-es-correo" }))).status, 400);
      const key = randomUUID();
      const one = await postWholesale(a.slug, issued.token, form(a.both.id), { "Idempotency-Key": key });
      const two = await postWholesale(a.slug, issued.token, form(a.both.id), { "Idempotency-Key": key });
      assert.equal(one.status, 201);
      assert.equal(two.status, 201);
      assert.equal(((await one.json()) as { preorder: { token: string } }).preorder.token, ((await two.json()) as { preorder: { token: string } }).preorder.token);
      assert.equal(await db.quoteRequest.count({ where: { organizationId: a.org } }), 1);
    });

    await t.test("mayorista: rate-limit por IP (429) y tope diario propio por empresa", async () => {
      const a = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      const address = "203.0.113.91";
      let last = 0;
      for (let i = 0; i < 11; i++) last = (await postWholesale(a.slug, issued.token, form(a.both.id), {}, address)).status;
      assert.equal(last, 429, "pasado el límite por IP");
      // Tope diario: 200 pedidos mayoristas de hoy cierran el mayorista, pero no el catálogo público.
      const b = await seed();
      const second = (await access.issueCatalogAccess(b.org, b.client.id))!;
      await db.quoteRequest.createMany({
        data: Array.from({ length: catalog.PREORDER_DAILY_LIMIT }, () => ({ id: randomUUID(), organizationId: b.org, source: "catalogo", priceList: "WHOLESALE", status: "NEW" })),
      });
      const capped = await postWholesale(b.slug, second.token, form(b.both.id));
      assert.equal(capped.status, 429);
      assert.ok(capped.headers.get("Retry-After"));
      assert.equal((await postRetail(b.slug, form(b.both.id))).status, 201, "el tope mayorista no bloquea al público");
      assert.equal((await catalog.preorderDailyLimit(b.org, { priceList: "WHOLESALE" })).reached, true);
      assert.equal((await catalog.preorderDailyLimit(b.org, { priceList: "RETAIL", limit: 5 })).reached, false);
    });

    await t.test("logo público: solo con tienda encendida y solo el de esa empresa", async () => {
      const a = await seed();
      const b = await seed();
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      await db.organizationLogo.create({ data: { id: randomUUID(), organizationId: a.org, variant: "dark", mime: "image/png", size: png.length, data: png } });
      const ok = await logoRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ orgSlug: a.slug, variant: "dark" }) });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("content-type"), "image/png");
      assert.equal((await logoRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ orgSlug: b.slug, variant: "dark" }) })).status, 404, "B no tiene logo: no se sirve el de A");
      assert.equal((await logoRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ orgSlug: a.slug, variant: "../etc" }) })).status, 404);
      const store = await catalog.loadStorefront((await catalog.resolvePublicCatalog(a.slug))!);
      assert.deepEqual(store.logos, { light: false, dark: true });
      assert.equal(store.tagline, "Frase de prueba");
      assert.equal(store.theme.branded, true);
    });

    await t.test("la demo trae la tienda encendida, la mezcla de alcances, un cliente mayorista con su link y un pedido mayorista convertido", async () => {
      const { ensureDemoData, DEMO_WHOLESALE_TOKEN, DEMO_WHOLESALE_CLIENT_ID } = await import("../lib/server/demo-data");
      await ensureDemoData({ reset: true });
      const publicContext = (await catalog.resolvePublicCatalog("demo"))!;
      assert.ok(publicContext, "tienda de la demo encendida");
      assert.equal(publicContext.settings.storefrontAccent, "#0e7490");
      const retail = await catalog.loadPublicCatalogItems(publicContext, null);
      const retailNames = retail.map((item) => item.name);
      assert.ok(retailNames.includes("Tótem LED 2x1 m") && retailNames.includes("Pantalla LED P3.9 500x500"));
      assert.ok(!retailNames.includes("Dispensador inteligente") && !retailNames.includes("Estructura de truss 2 m"), "los productos solo mayoristas no salen en la tienda pública");
      assert.equal(retail.find((item) => item.name === "Pantalla LED P3.9 500x500")?.price?.unit, 950_000, "precio de lista, no el mayorista");
      assert.equal(retail.find((item) => item.name === "Kiosko Touch 32\"")?.price?.unit, 1_100_000);
      assert.ok(!JSON.stringify(retail).includes("wholesale"));
      const wholesaleContext = (await catalog.resolveWholesaleCatalog("demo", DEMO_WHOLESALE_TOKEN))!;
      assert.ok(wholesaleContext, "el link de Agencia Pixel abre el catálogo mayorista de la demo");
      assert.equal(wholesaleContext.access?.client.id, DEMO_WHOLESALE_CLIENT_ID);
      const wholesale = await catalog.loadPublicCatalogItems(wholesaleContext, null);
      assert.ok(wholesale.some((item) => item.name === "Dispensador inteligente"));
      assert.ok(!wholesale.some((item) => item.name === "Tótem LED 2x1 m"), "RETAIL no sale en el mayorista");
      const audiences = new Set((await db.inventoryItem.findMany({ where: { organization: { slug: "demo" } }, select: { catalogAudience: true } })).map((row) => row.catalogAudience));
      for (const value of ["RETAIL", "WHOLESALE", "BOTH"]) assert.ok(audiences.has(value), value);
      const order = await db.quoteRequest.findUniqueOrThrow({ where: { id: "demo_quote_pixel" }, include: { budget: { include: { items: true } } } });
      assert.equal(order.priceList, "WHOLESALE");
      assert.equal(order.clientId, DEMO_WHOLESALE_CLIENT_ID);
      assert.equal(order.status, "CONVERTED");
      assert.equal(order.budget?.clientId, DEMO_WHOLESALE_CLIENT_ID);
      assert.equal(order.budget?.total, 21_000_000, "el presupuesto del pedido mayorista usa precios mayoristas");
      assert.equal(order.referenceTotal, order.budget?.total);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "catalog:" } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
