import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/tienda-editorial.pg.test.ts
test("tienda editorial: orden de secciones, carrito guardado y pedido de mejor precio (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { POST: preorderPost } = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const { POST: publicCartPost } = await import("../app/api/catalog/[orgSlug]/cart/route");
  const { GET: accessCartGet, PUT: accessCartPut, POST: accessCartPost } = await import("../app/api/catalog/[orgSlug]/acceso/[token]/cart/route");
  const { POST: respondPost } = await import("../app/api/pedido/[token]/route");
  const { POST: priceRequestPost } = await import("../app/api/pedido/[token]/price-request/route");
  const { POST: visitorCartPost } = await import("../app/api/catalog/[orgSlug]/cart/visitor/route");
  const { GET: visitorCartGet, PUT: visitorCartPut, POST: visitorCartPrice } = await import("../app/api/catalog/[orgSlug]/carrito/[token]/cart/route");
  const { loadProductDetail } = await import("../lib/server/catalog-product");
  const { issueCatalogAccess } = await import("../lib/server/catalog-access");
  const { loadPublicCatalogItems, loadPublicOrder, resolvePublicCatalog, resolveAccessCatalog } = await import("../lib/server/catalog-public");
  const { loadStorefrontOrder, saveStorefrontOrder } = await import("../lib/server/storefront-order");
  const { respondToPriceRequest } = await import("../lib/server/quote-price-request");
  const { convertQuoteRequest } = await import("../lib/server/catalog-convert");
  const { catalogLineAmounts, loadPricedItems } = await import("../lib/server/line-pricing");

  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const actor = { id: "u", name: "Dueña", email: "d@x.test" };
  let ipCounter = 0;
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const post = (body: unknown, ip = `10.8.0.${++ipCounter}`, method = "POST") =>
    new Request("http://x", { method, headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
  const get = (ip = `10.8.0.${++ipCounter}`) => new Request("http://x", { headers: { "x-forwarded-for": ip } });

  async function seed() {
    const org = randomUUID();
    const slug = `te-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Vajilla ${slug}`, slug } });
    await db.organizationRentalSettings.create({
      data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: true, publicShowPrices: true, depositPercent: 50, catalogAccessMode: "OPEN", whatsappPhone: "+595981123456" },
    });
    const category = (name: string, sortOrder: number) =>
      db.inventoryCategory.create({ data: { id: randomUUID(), organizationId: org, name, key: name.toLowerCase().replace(/\s+/g, "-"), sortOrder } });
    const living = await category("Sector Living", 30);
    const mesas = await category("Mesas", 20);
    const deco = await category("Decorativas", 10);
    const item = (name: string, cat: { id: string; name: string }, price: number, extra: Record<string, unknown> = {}) =>
      db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category: cat.name, categoryId: cat.id, quantity: 10, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: price, wholesalePrice: price, dailyCost: 100, ...extra } });
    const sofa = await item("Sofá Milano", living, 200_000);
    const puff = await item("Puff Trento", living, 60_000);
    const mesa = await item("Mesa redonda", mesas, 300_000);
    const toldo = await item("Toldo Roma", deco, 265_000);
    const ctx = { organizationId: org, organization: { id: org, name: `Vajilla ${slug}`, slug, planId: null }, user: { id: randomUUID(), name: "Dueña", email: "d@x.test", role: "OWNER" }, role: "OWNER", demo: false, sandbox: false } as never;
    return { org, slug, living, mesas, deco, sofa, puff, mesa, toldo, ctx };
  }
  type World = Awaited<ReturnType<typeof seed>>;

  async function preorder(world: World, items: Array<{ id: string; quantity: number }>, extra: Record<string, unknown> = {}) {
    const response = await preorderPost(
      post({ name: "Ana Pérez", phone: "+595 981 000 111", email: "ana@example.com", location: "Asunción", from: day(30), to: day(32), items: items.map((entry) => ({ inventoryId: entry.id, quantity: entry.quantity })), ...extra }),
      params({ orgSlug: world.slug }),
    );
    assert.equal(response.status, 201, await response.clone().text());
    const { preorder: created } = (await response.json()) as { preorder: { token: string } };
    return db.quoteRequest.findUniqueOrThrow({ where: { publicToken: created.token }, include: { items: true, priceRequests: true } });
  }

  try {
    await t.test("orden: las secciones y los productos salen como los ordenó la empresa; lo ajeno responde 404", async () => {
      const a = await seed();
      const b = await seed();
      const ctx = await resolvePublicCatalog(a.slug);
      // Sin orden cargado: por sortOrder de la categoría (Decorativas 10, Mesas 20, Sector Living 30).
      const before = await loadPublicCatalogItems(ctx!, null);
      assert.deepEqual(before.map((item) => item.name), ["Toldo Roma", "Mesa redonda", "Puff Trento", "Sofá Milano"]);

      // La empresa pone Sector Living primero y el sofá antes que el puff.
      const saved = await saveStorefrontOrder(a.org, { sections: [{ categoryId: a.living.id, itemIds: [a.sofa.id, a.puff.id] }, { categoryId: a.deco.id, itemIds: [a.toldo.id] }, { categoryId: a.mesas.id, itemIds: [a.mesa.id] }] });
      assert.ok(saved.ok);
      const after = await loadPublicCatalogItems((await resolvePublicCatalog(a.slug))!, null);
      assert.deepEqual(after.map((item) => item.name), ["Sofá Milano", "Puff Trento", "Toldo Roma", "Mesa redonda"]);
      const view = await loadStorefrontOrder(a.org);
      assert.deepEqual(view.sections.map((section) => section.name), ["Sector Living", "Decorativas", "Mesas"]);
      assert.deepEqual(view.sections[0].items.map((entry) => entry.name), ["Sofá Milano", "Puff Trento"]);
      // Y al revés dentro de la sección.
      await saveStorefrontOrder(a.org, { sections: [{ categoryId: a.living.id, itemIds: [a.puff.id, a.sofa.id] }] });
      const swapped = await loadPublicCatalogItems((await resolvePublicCatalog(a.slug))!, null);
      assert.deepEqual(swapped.filter((item) => item.category === "Sector Living").map((item) => item.name), ["Puff Trento", "Sofá Milano"]);

      // Ids de otra empresa: 404 y no se escribe nada (ni en la propia ni en la ajena).
      const snapshot = JSON.stringify(await loadStorefrontOrder(a.org));
      const foreignCategory = await saveStorefrontOrder(a.org, { sections: [{ categoryId: b.living.id, itemIds: [] }] });
      const foreignItem = await saveStorefrontOrder(a.org, { sections: [{ categoryId: a.living.id, itemIds: [b.sofa.id] }] });
      assert.deepEqual([foreignCategory.ok ? 0 : foreignCategory.status, foreignItem.ok ? 0 : foreignItem.status], [404, 404]);
      assert.equal(JSON.stringify(await loadStorefrontOrder(a.org)), snapshot);
      assert.equal((await db.inventoryCategory.findUniqueOrThrow({ where: { id: b.living.id } })).sortOrder, 30, "la otra empresa no se toca");
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: b.sofa.id } })).webSortOrder, 0);
      assert.equal((await saveStorefrontOrder(a.org, { sections: [] })).ok, false);
    });

    await t.test("carrito: el de un cliente con acceso se guarda en el servidor y se recupera, sin precios y sin cruzar empresas", async () => {
      const a = await seed();
      const b = await seed();
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: a.org, name: "Beto Gómez", email: "beto@example.com" } });
      const link = await issueCatalogAccess(a.org, client.id, "RETAIL");
      assert.ok(link);
      const token = link!.token;
      const cart = { items: [{ id: a.sofa.id, quantity: 2 }, { id: a.mesa.id, quantity: 1 }], from: day(30), to: day(32), zone: "COORDINATE", seenTotal: 123_000 };

      const empty = await accessCartGet(get(), params({ orgSlug: a.slug, token }));
      assert.equal(((await empty.json()) as { cart: { items: unknown[] } }).cart.items.length, 0);
      const put = await accessCartPut(post(cart, undefined, "PUT"), params({ orgSlug: a.slug, token }));
      assert.equal(put.status, 200);
      // «Otro dispositivo»: una lectura nueva con el mismo link devuelve lo guardado.
      const again = await accessCartGet(get(), params({ orgSlug: a.slug, token }));
      const saved = ((await again.json()) as { cart: typeof cart }).cart;
      assert.deepEqual(saved.items, cart.items);
      assert.deepEqual([saved.from, saved.to, saved.zone, saved.seenTotal], [cart.from, cart.to, "COORDINATE", 123_000]);
      // Solo referencias: nunca se guarda un precio.
      const row = await db.storeCart.findFirstOrThrow({ where: { organizationId: a.org } });
      assert.deepEqual(row.items, [{ inventoryId: a.sofa.id, quantity: 2 }, { inventoryId: a.mesa.id, quantity: 1 }]);
      // Guardar dos veces lo mismo no duplica; vaciarlo lo borra.
      await accessCartPut(post(cart, undefined, "PUT"), params({ orgSlug: a.slug, token }));
      assert.equal(await db.storeCart.count({ where: { organizationId: a.org } }), 1);
      await accessCartPut(post({ ...cart, items: [] }, undefined, "PUT"), params({ orgSlug: a.slug, token }));
      assert.equal(await db.storeCart.count({ where: { organizationId: a.org } }), 0);
      await accessCartPut(post(cart, undefined, "PUT"), params({ orgSlug: a.slug, token }));

      // El link de una empresa no abre el carrito en otra (404) y el visitante no tiene carrito guardado.
      assert.equal((await accessCartGet(get(), params({ orgSlug: b.slug, token }))).status, 404);
      assert.equal((await accessCartPut(post(cart, undefined, "PUT"), params({ orgSlug: b.slug, token }))).status, 404);
      assert.equal(await db.storeCart.count({ where: { organizationId: b.org } }), 0);
      assert.equal((await accessCartGet(get(), params({ orgSlug: a.slug, token: "lbxw_" + "x".repeat(32) }))).status, 404);
      // Basura en el cuerpo: se normaliza, no rompe.
      const junk = await accessCartPut(post({ items: [{ id: a.sofa.id, quantity: 500 }, { id: "x", quantity: 1 }, 7] }, undefined, "PUT"), params({ orgSlug: a.slug, token }));
      assert.equal(junk.status, 200);
      assert.deepEqual((await db.storeCart.findFirstOrThrow({ where: { organizationId: a.org } })).items, [{ inventoryId: "x", quantity: 1 }], "solo queda lo válido (cantidad 500 y basura se descartan)");
      // Revocar el link apaga también el acceso al carrito.
      await db.catalogAccessToken.update({ where: { id: link!.id }, data: { revokedAt: new Date() } });
      assert.equal(await resolveAccessCatalog(a.slug, token), null);
      assert.equal((await accessCartGet(get(), params({ orgSlug: a.slug, token }))).status, 404);
    });

    await t.test("carrito: al volver el servidor recalcula precio (escalones), flete y total, y quita lo que ya no está", async () => {
      const a = await seed();
      // Mesa: desde 3 días 250.000 por día en vez de 300.000.
      await db.inventoryPriceTier.create({ data: { id: randomUUID(), organizationId: a.org, inventoryId: a.mesa.id, audience: "RETAIL", fromDays: 3, mode: "PER_DAY", price: 250_000 } });
      const zone = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: a.org, name: "Asunción", basePrice: 40_000, volumeThreshold: 2, extraPrice: 10_000 } });
      const body = { items: [{ id: a.sofa.id, quantity: 1 }, { id: a.mesa.id, quantity: 2 }, { id: a.toldo.id, quantity: 1 }], from: day(30), to: day(32), zone: zone.id };
      const priced = async (payload: unknown) => ((await (await publicCartPost(post(payload), params({ orgSlug: a.slug }))).json()) as { cart: import("../lib/server/store-cart").CartView }).cart;

      const view = await priced(body);
      assert.equal(view.range?.days, 3);
      const pricedItems = await loadPricedItems(a.org, [a.sofa.id, a.mesa.id, a.toldo.id]);
      const expectedItems = [[a.sofa.id, 1], [a.mesa.id, 2], [a.toldo.id, 1]].reduce((sum, [id, quantity]) => sum + catalogLineAmounts(pricedItems.get(id as string), null, quantity as number, 3, "RETAIL").subtotal, 0);
      assert.equal(view.itemsSubtotal, expectedItems, "mismo cálculo que la conversión (catalogLineAmounts)");
      assert.equal(view.lines.find((line) => line.id === a.mesa.id)!.unitPrice, 250_000, "escalón por días");
      assert.match(view.lines.find((line) => line.id === a.mesa.id)!.tier ?? "", /desde 3 días/);
      assert.equal(view.delivery.fee, 50_000, "40.000 + 10.000 de recargo (4 piezas > umbral 2)");
      assert.equal(view.total, expectedItems + 50_000);
      // El navegador no puede imponer un precio: no existe ese campo en el pedido.
      const tampered = await priced({ ...body, items: body.items.map((line) => ({ ...line, unitPrice: 1 })) });
      assert.equal(tampered.total, view.total);

      // El producto deja de estar publicado: se informa como quitado y no entra al total.
      await db.inventoryItem.update({ where: { id: a.toldo.id }, data: { catalogAudience: "HIDDEN", visibleOnWeb: false } });
      const after = await priced(body);
      assert.deepEqual(after.removed, [a.toldo.id]);
      assert.equal(after.lines.length, 2);
      // La zona se archiva: no se inventa un flete.
      await db.deliveryZone.update({ where: { id: zone.id }, data: { archivedAt: new Date() } });
      const gone = await priced(body);
      assert.equal(gone.delivery.gone, true);
      assert.equal(gone.delivery.fee, null);
      // Fechas pasadas: se avisa y no se calcula período.
      const stale = await priced({ ...body, from: "2020-01-01", to: "2020-01-03" });
      assert.deepEqual([stale.range, stale.rangeExpired], [null, true]);
      // Otra empresa no ve productos ajenos aunque el id sea válido.
      const b = await seed();
      const foreign = ((await (await publicCartPost(post({ items: [{ id: a.sofa.id, quantity: 1 }], from: day(30), to: day(31) }), params({ orgSlug: b.slug }))).json()) as { cart: { lines: unknown[]; removed: string[] } }).cart;
      assert.deepEqual([foreign.lines.length, foreign.removed], [0, [a.sofa.id]]);
    });

    await t.test("mejor precio: la empresa contraoferta, el cliente aprueba la versión final y el monto pedido nunca se aplica solo", async () => {
      const a = await seed();
      const b = await seed();
      const quote = await preorder(a, [{ id: a.sofa.id, quantity: 2 }, { id: a.mesa.id, quantity: 1 }], { priceRequest: { comment: "Somos clientes frecuentes", desiredAmount: "1.500.000" } });
      assert.equal(quote.priceRequests.length, 1);
      const total = quote.referenceTotal!;
      assert.ok(total > 1_500_000);
      const request = quote.priceRequests[0];
      assert.deepEqual([request.status, request.desiredAmount, request.originalTotal, request.offeredAmount], ["OPEN", 1_500_000, total, null]);
      // Pedir no cambia nada del pedido.
      assert.equal(quote.status, "NEW");
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).referenceTotal, total);

      // Otra empresa no puede responder (404) y la solicitud sigue abierta.
      const foreign = await respondToPriceRequest(b.ctx, quote.id, request.id, { action: "accept" }, actor);
      assert.deepEqual([foreign.ok, foreign.ok ? 0 : foreign.status], [false, 404]);
      // Validaciones: contraoferta sin monto, oferta por encima del total, rechazo sin motivo.
      for (const bad of [{ action: "counter" }, { action: "counter", offeredAmount: total + 1 }, { action: "reject" }, { action: "otra" }]) {
        const result = await respondToPriceRequest(a.ctx, quote.id, request.id, bad, actor);
        assert.deepEqual([result.ok, result.ok ? 0 : result.status], [false, 400], JSON.stringify(bad));
      }
      assert.equal((await db.quotePriceRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "OPEN");

      // Contraoferta: el pedido pasa a «Propuesta enviada»; las líneas y el total de referencia no cambian.
      const counter = await respondToPriceRequest(a.ctx, quote.id, request.id, { action: "counter", offeredAmount: 1_700_000, note: "Es lo mejor que podemos" }, actor);
      assert.ok(counter.ok, counter.ok ? "" : counter.error);
      const proposed = await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { items: true } });
      assert.equal(proposed.status, "PROPOSED");
      assert.equal(proposed.referenceTotal, total, "el monto ofrecido no reemplaza el total calculado");
      assert.deepEqual(proposed.items.map((item) => item.subtotal).sort(), quote.items.map((item) => item.subtotal).sort());
      // No se responde dos veces.
      const twice = await respondToPriceRequest(a.ctx, quote.id, request.id, { action: "accept" }, actor);
      assert.deepEqual([twice.ok, twice.ok ? 0 : twice.status], [false, 409]);

      // El cliente ve la oferta en su seguimiento y aprueba la versión final.
      const view = await loadPublicOrder(quote.publicToken!);
      assert.equal(view?.priceRequests[0].status, "COUNTERED");
      assert.equal(view?.priceRequests[0].offeredAmount, 1_700_000);
      assert.equal(view?.priceRequests[0].clientApprovedAt, null);
      const approved = await respondPost(post({ action: "approve" }), params({ token: quote.publicToken! }));
      assert.equal(approved.status, 200);
      const done = await db.quotePriceRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.deepEqual([done.status, done.offeredAmount], ["COUNTERED", 1_700_000]);
      assert.ok(done.clientApprovedAt, "aprobó la versión final");
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status, "APPROVED");
      // La conversión no cambia: arma el presupuesto con el cálculo normal; el monto acordado queda a la vista del equipo.
      const converted = await convertQuoteRequest(a.ctx, quote.id);
      assert.ok(converted.ok, converted.ok ? "" : converted.error);
      if (converted.ok) assert.equal(converted.budget.subtotal, total);
      assert.ok((await db.auditLog.count({ where: { organizationId: a.org, summary: { contains: "Contraofertó" } } })) >= 1);
    });

    await t.test("mejor precio: aceptar toma el monto pedido, rechazar exige motivo y el pedido de precio desde el seguimiento tiene límites", async () => {
      const a = await seed();
      // Desde el carrito sin monto: aceptar no se puede (no hay monto), contraofertar sí.
      const q1 = await preorder(a, [{ id: a.sofa.id, quantity: 1 }], { priceRequest: { comment: "¿Algo de descuento?" } });
      const r1 = q1.priceRequests[0];
      assert.equal(r1.desiredAmount, null);
      assert.equal((await respondToPriceRequest(a.ctx, q1.id, r1.id, { action: "accept" }, actor)).ok, false);
      const rejected = await respondToPriceRequest(a.ctx, q1.id, r1.id, { action: "reject", note: "Ya está al mejor precio" }, actor);
      assert.ok(rejected.ok);
      const afterReject = await db.quoteRequest.findUniqueOrThrow({ where: { id: q1.id } });
      assert.equal(afterReject.status, "NEW", "rechazar el precio no cierra el pedido");
      assert.equal((await db.quotePriceRequest.findUniqueOrThrow({ where: { id: r1.id } })).responseNote, "Ya está al mejor precio");

      // Aceptar toma el monto pedido: solo queda como propuesta, el total del pedido no se toca.
      const q2 = await preorder(a, [{ id: a.mesa.id, quantity: 1 }]);
      const sent = await priceRequestPost(post({ comment: "Es para una boda", desiredAmount: 500_000 }), params({ token: q2.publicToken! }));
      assert.equal(sent.status, 201);
      const { priceRequest } = (await sent.json()) as { priceRequest: { id: string; status: string } };
      assert.equal(priceRequest.status, "OPEN");
      // Una abierta a la vez; monto mayor o igual al total y comentario vacío se rechazan.
      assert.equal((await priceRequestPost(post({ comment: "otra vez" }), params({ token: q2.publicToken! }))).status, 409);
      const accepted = await respondToPriceRequest(a.ctx, q2.id, priceRequest.id, { action: "accept" }, actor);
      assert.ok(accepted.ok);
      assert.equal((await db.quotePriceRequest.findUniqueOrThrow({ where: { id: priceRequest.id } })).offeredAmount, 500_000);
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: q2.id } })).referenceTotal, q2.referenceTotal);

      const q3 = await preorder(a, [{ id: a.toldo.id, quantity: 1 }]);
      const tooHigh = await priceRequestPost(post({ comment: "Quiero pagar más", desiredAmount: q3.referenceTotal! + 1 }), params({ token: q3.publicToken! }));
      assert.equal(tooHigh.status, 400);
      assert.equal((await priceRequestPost(post({ comment: "  " }), params({ token: q3.publicToken! }))).status, 400);
      assert.equal((await priceRequestPost(post({ comment: "Hola" }), params({ token: "x".repeat(24) }))).status, 404);
      // Con el pedido ya convertido o declinado no se pide precio.
      await db.quoteRequest.update({ where: { id: q3.id }, data: { status: "DECLINED" } });
      assert.equal((await priceRequestPost(post({ comment: "Hola de nuevo" }), params({ token: q3.publicToken! }))).status, 409);

      // Rate limit por IP: a la sexta llamada seguida desde la misma IP responde 429.
      const q4 = await preorder(a, [{ id: a.puff.id, quantity: 1 }]);
      const ip = "10.250.0.1";
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await priceRequestPost(post({ comment: "Quiero un descuento" }, ip), params({ token: q4.publicToken! }))).status);
      assert.equal(statuses[0], 201);
      assert.equal(statuses[5], 429);
    });

    await t.test("carrito de visitante: contacto validado, enlace mágico que vence, sin enumerar y sin cruzar empresas", async () => {
      const a = await seed();
      const b = await seed();
      const body = { name: "Ana Pérez", email: "ana@example.com", phone: "+595 981 000 111", items: [{ id: a.sofa.id, quantity: 2 }], from: day(30), to: day(32), zone: "" };
      // Validación: sin contacto, sin nombre o con correo roto no se guarda nada.
      for (const bad of [{ ...body, email: "", phone: "" }, { ...body, name: "A" }, { ...body, email: "roto", phone: "" }]) {
        assert.equal((await visitorCartPost(post(bad), params({ orgSlug: a.slug }))).status, 400);
      }
      assert.equal((await visitorCartPost(post({ ...body, website: "spam" }), params({ orgSlug: a.slug }))).status, 400, "honeypot");
      assert.equal(await db.storeCart.count({ where: { organizationId: a.org } }), 0);
      const created = await visitorCartPost(post(body), params({ orgSlug: a.slug }));
      assert.equal(created.status, 201);
      const made = (await created.json()) as { token: string; path: string; share: { whatsapp: string | null; mailto: string | null } };
      assert.match(made.path, new RegExp(`^/tienda/${a.slug}/carrito/lbxw_`));
      assert.ok(made.share.whatsapp && made.share.mailto, "la persona se manda el enlace desde su propio WhatsApp o correo");
      const row = await db.storeCart.findFirstOrThrow({ where: { organizationId: a.org } });
      assert.ok(!JSON.stringify(row).includes(made.token), "solo vive el hash del enlace");
      assert.ok(row.expiresAt && row.expiresAt.getTime() > Date.now() + 29 * 86_400_000, "vence a los 30 días");
      // El mismo correo otra vez: otro carrito nuevo, nada revela que ya existía.
      const again = await visitorCartPost(post(body), params({ orgSlug: a.slug }));
      assert.equal(again.status, 201);
      assert.notEqual(((await again.json()) as { token: string }).token, made.token);

      // Retomar «desde otro dispositivo»: GET con el enlace; guardar cambios; precio recalculado por el servidor.
      const got = (await (await visitorCartGet(get(), params({ orgSlug: a.slug, token: made.token }))).json()) as { cart: { items: Array<{ id: string; quantity: number }>; from: string } };
      assert.deepEqual(got.cart.items, [{ id: a.sofa.id, quantity: 2 }]);
      assert.equal(got.cart.from, day(30));
      const put = await visitorCartPut(post({ items: [{ id: a.sofa.id, quantity: 3 }, { id: a.mesa.id, quantity: 1 }], from: day(30), to: day(32), zone: "" }, undefined, "PUT"), params({ orgSlug: a.slug, token: made.token }));
      assert.equal(put.status, 200);
      const view = ((await (await visitorCartPrice(post({ items: [{ id: a.sofa.id, quantity: 3 }], from: day(30), to: day(32) }), params({ orgSlug: a.slug, token: made.token }))).json()) as { cart: { itemsSubtotal: number } }).cart;
      assert.equal(view.itemsSubtotal, 3 * 200_000 * 3);
      // Vaciar el carrito no borra el enlace; vence solo.
      await visitorCartPut(post({ items: [] }, undefined, "PUT"), params({ orgSlug: a.slug, token: made.token }));
      assert.equal((await visitorCartGet(get(), params({ orgSlug: a.slug, token: made.token }))).status, 200);

      // Otra empresa, token inventado y enlace vencido: 404.
      assert.equal((await visitorCartGet(get(), params({ orgSlug: b.slug, token: made.token }))).status, 404);
      assert.equal((await visitorCartGet(get(), params({ orgSlug: a.slug, token: "lbxw_" + "x".repeat(32) }))).status, 404);
      await db.storeCart.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await visitorCartGet(get(), params({ orgSlug: a.slug, token: made.token }))).status, 404);
      assert.equal((await visitorCartPut(post(body, undefined, "PUT"), params({ orgSlug: a.slug, token: made.token }))).status, 404);
      // Tienda con acceso por link: el visitante no crea carrito.
      await db.organizationRentalSettings.update({ where: { organizationId: b.org }, data: { catalogAccessMode: "PRIVATE" } });
      assert.equal((await visitorCartPost(post(body), params({ orgSlug: b.slug }))).status, 403);
      // Rate limit por IP: a la sexta alta seguida, 429.
      const ip = "10.251.0.1";
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) statuses.push((await visitorCartPost(post(body, ip), params({ orgSlug: a.slug }))).status);
      assert.equal(statuses[0], 201);
      assert.equal(statuses[5], 429);
    });

    await t.test("ficha: solo productos publicados de ESA tienda, con sus piezas y sugeridos", async () => {
      const a = await seed();
      const b = await seed();
      // Un combo con el sofá y el puff como piezas.
      const combo = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: a.org, name: "Juego living", category: "Sector Living", categoryId: a.living.id, quantity: 5, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 700_000, wholesalePrice: 700_000, dailyCost: 100, sku: "527", capacity: 8, dimensions: "4,00 × 3,00 m" } });
      await db.inventoryComponent.createMany({ data: [{ id: randomUUID(), organizationId: a.org, parentId: combo.id, componentId: a.sofa.id, quantity: 2 }, { id: randomUUID(), organizationId: a.org, parentId: combo.id, componentId: a.puff.id, quantity: 4 }] });
      const ctx = (await resolvePublicCatalog(a.slug))!;
      const byCode = await loadProductDetail(ctx, "527");
      assert.equal(byCode?.item.id, combo.id, "por código");
      assert.deepEqual([byCode?.item.capacity, byCode?.item.dimensions], [8, "4,00 × 3,00 m"]);
      assert.deepEqual(byCode?.includes.map((part) => [part.name, part.quantity]), [["Puff Trento", 4], ["Sofá Milano", 2]]);
      const sofa = await loadProductDetail(ctx, a.sofa.id);
      assert.equal(sofa?.related[0].id, combo.id, "el combo que lo contiene va primero");
      assert.ok(sofa!.related.length >= 4 && sofa!.related.length <= 8);
      // Oculto, ajeno o inexistente: null (404).
      await db.inventoryItem.update({ where: { id: a.toldo.id }, data: { catalogAudience: "HIDDEN", visibleOnWeb: false } });
      assert.equal(await loadProductDetail(ctx, a.toldo.id), null);
      assert.equal(await loadProductDetail(ctx, b.sofa.id), null);
      assert.equal(await loadProductDetail(ctx, "no-existe"), null);
      // Un producto solo mayorista no sale en la ficha pública.
      await db.inventoryItem.update({ where: { id: a.mesa.id }, data: { catalogAudience: "WHOLESALE" } });
      assert.equal(await loadProductDetail(ctx, a.mesa.id), null);
    });
  } finally {
    await db.organization.deleteMany({ where: { slug: { startsWith: "te-" } } });
    await db.$disconnect();
  }
});
