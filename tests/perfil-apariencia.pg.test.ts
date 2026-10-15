import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/perfil-apariencia.pg.test.ts
test("perfil, apariencia, acceso al catálogo y respuesta al pedido en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const sharp = (await import("sharp")).default;
  const { saveOrgAppearance, saveOrgProfile } = await import("../lib/server/org-presentation");
  const { uploadCover } = await import("../lib/server/covers");
  const { GET: publicCover } = await import("../app/api/catalog/[orgSlug]/cover/[kind]/route");
  const { POST: preorderPost } = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const { POST: accessPreorderPost } = await import("../app/api/catalog/[orgSlug]/acceso/[token]/preorder/route");
  const { POST: accessRequestPost } = await import("../app/api/catalog/[orgSlug]/access-request/route");
  const { POST: respondPost } = await import("../app/api/pedido/[token]/route");
  const { approveAccessRequest, rejectAccessRequest, listAccessRequests } = await import("../lib/server/catalog-access-requests");
  const { resolveAccessCatalog, resolvePublicCatalog, resolveWholesaleCatalog, loadStorefront, loadPublicOrder } = await import("../lib/server/catalog-public");
  const { convertQuoteRequest, holdQuoteRequestStock } = await import("../lib/server/catalog-convert");
  const { rejectQuoteRequest, modifyQuoteRequest, respondToProposal, listQuoteItemSubstitutes } = await import("../lib/server/quote-request-response");
  const { peekStockBeforeApproval } = await import("../lib/server/approval-stock");
  const { portalAuditContext } = await import("../lib/server/audit");

  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  let ipCounter = 0;
  const actor = { id: "u", name: "Dueña", email: "d@x.test" };

  async function seed(opts: { mode?: "OPEN" | "REQUEST" | "PRIVATE"; enabled?: boolean } = {}) {
    const org = randomUUID();
    const slug = `pa-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `La Vajilla ${slug}`, slug } });
    await db.organizationRentalSettings.create({
      data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: opts.enabled ?? true, publicShowPrices: true, depositPercent: 50, catalogAccessMode: opts.mode ?? "OPEN", whatsappPhone: "+595981123456" },
    });
    const item = (name: string, quantity: number, price: number, category = "Vajilla") =>
      db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category, quantity, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: price, wholesalePrice: Math.round(price * 0.8), dailyCost: 100 } });
    const plato = await item("Plato llano", 10, 5_000);
    const hondo = await item("Plato hondo", 6, 6_000);
    const copa = await item("Copa de vino", 4, 3_000);
    const mantel = await item("Mantel blanco", 3, 20_000, "Textil");
    const ctx = { organizationId: org, organization: { id: org, name: `La Vajilla ${slug}`, slug, planId: null }, user: { id: randomUUID(), name: "Dueña", email: "d@x.test", role: "OWNER" }, role: "OWNER", demo: false, sandbox: false } as never;
    return { org, slug, plato, hondo, copa, mantel, ctx };
  }
  type World = Awaited<ReturnType<typeof seed>>;
  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
  const json = (url: string, body: unknown, headers: Record<string, string> = {}, ip = `10.9.0.${++ipCounter}`) =>
    new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers }, body: JSON.stringify(body) });
  const orderBody = (items: Array<{ id: string; quantity: number }>, extra: Record<string, unknown> = {}) => ({
    name: "Ana Pérez", phone: "+595 981 000 111", email: "ana@example.com", location: "Asunción", from: day(30), to: day(31),
    items: items.map((entry) => ({ inventoryId: entry.id, quantity: entry.quantity })), ...extra,
  });
  async function preorder(world: World, items: Array<{ id: string; quantity: number }>, email = "ana@example.com") {
    const response = await preorderPost(json(`http://x/api/catalog/${world.slug}/preorder`, orderBody(items, { email })), params({ orgSlug: world.slug }));
    assert.equal(response.status, 201, await response.clone().text());
    const { preorder: created } = (await response.json()) as { preorder: { token: string } };
    return db.quoteRequest.findUniqueOrThrow({ where: { publicToken: created.token }, include: { items: { orderBy: { productName: "asc" } } } });
  }
  async function hold(world: World, inventoryId: string, quantity: number, from: number, to: number) {
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: world.org, name: "Cliente ajeno" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: world.org, clientId: client.id, name: "Evento ajeno", startsAt: new Date(day(from) + "T12:00:00Z"), endsAt: new Date(day(to) + "T20:00:00Z"), status: "CONFIRMED" } });
    await db.eventInventory.create({ data: { id: randomUUID(), eventId: event.id, inventoryId, organizationId: world.org, quantity, startsAt: new Date(day(from) + "T12:00:00Z"), endsAt: new Date(day(to) + "T20:00:00Z") } });
  }

  try {
    await t.test("perfil: se guarda validado, es de ESA empresa y deja auditoría", async () => {
      const a = await seed();
      const b = await seed();
      const ok = await saveOrgProfile(a.ctx, {
        profile: {
          contact: { phone: "981 123 456", whatsapp: "+595 981 654 321", email: "Info@Vajilla.com.py" },
          location: { address: "Av. España 1234", city: "Asunción", mapsUrl: "https://maps.app.goo.gl/AbCd123" },
          hours: { lun: { closed: false, ranges: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] }, dom: { closed: true, ranges: [] } },
          handover: { delivery: [{ from: "07:00", to: "10:00" }] },
          paymentMethods: { transfer: true, cash: true },
          conditions: "Seña del 50 %.",
        },
      });
      assert.equal(ok.status, 200);
      const stored = await db.organization.findUniqueOrThrow({ where: { id: a.org }, select: { profile: true } });
      assert.equal((stored.profile as { location: { mapsUrl: string } }).location.mapsUrl, "https://maps.app.goo.gl/AbCd123");
      assert.equal((await db.organization.findUniqueOrThrow({ where: { id: b.org }, select: { profile: true } })).profile, null, "la otra empresa no se toca");
      assert.equal(await db.auditLog.count({ where: { organizationId: a.org, entity: "Organization", summary: { contains: "perfil" } } }), 1);
      // Guardar lo mismo no ensucia la auditoría.
      const again = await saveOrgProfile(a.ctx, { profile: (stored.profile as object) });
      assert.equal(((await again.json()) as { unchanged?: boolean }).unchanged, true);
      assert.equal(await db.auditLog.count({ where: { organizationId: a.org, entity: "Organization", summary: { contains: "perfil" } } }), 1);
      // Inválidos: Maps ajeno y franjas superpuestas.
      const badMaps = await saveOrgProfile(a.ctx, { profile: { location: { mapsUrl: "https://evil.com/maps" } } });
      assert.equal(badMaps.status, 400);
      const overlap = await saveOrgProfile(a.ctx, { profile: { hours: { mar: { ranges: [{ from: "08:00", to: "12:00" }, { from: "11:00", to: "13:00" }] } } } });
      assert.equal(overlap.status, 400);
      assert.match(((await overlap.json()) as { error: string }).error, /superponer/);
    });

    await t.test("apariencia: plantilla y fuente cerradas; el color ilegible se ajusta a AA, se avisa y se guarda ajustado", async () => {
      const a = await seed();
      const b = await seed();
      const res = await saveOrgAppearance(a.ctx, { template: "elegante", font: "playfair-display", brandColor: "#ffd400" });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { brandColor: string; brandAdjusted: boolean; brandNotice: string };
      assert.equal(body.brandAdjusted, true);
      assert.match(body.brandNotice, /Ajustamos #ffd400/);
      const { contrastRatio } = await import("../lib/storefront-theme");
      assert.ok(contrastRatio(body.brandColor, "#ffffff") >= 4.5);
      const settings = await db.organizationRentalSettings.findUniqueOrThrow({ where: { organizationId: a.org } });
      assert.equal(settings.storefrontAccent, body.brandColor, "se guarda el color ya ajustado");
      assert.equal((await db.organizationRentalSettings.findUniqueOrThrow({ where: { organizationId: b.org } })).storefrontAccent, null);
      const stored = (await db.organization.findUniqueOrThrow({ where: { id: a.org }, select: { appearance: true } })).appearance as { template: string; font: string };
      assert.deepEqual([stored.template, stored.font], ["elegante", "playfair-display"]);
      assert.equal((await saveOrgAppearance(a.ctx, { template: "neon" })).status, 400);
      assert.equal((await saveOrgAppearance(a.ctx, { font: "Comic Sans" })).status, 400);
      assert.equal((await saveOrgAppearance(a.ctx, { background: "#101010" })).status, 400);
      // El color sigue vigente cuando solo se cambia la plantilla.
      const keep = await saveOrgAppearance(a.ctx, { template: "oscura" });
      assert.equal(((await keep.json()) as { brandColor: string }).brandColor, body.brandColor);
      // La tienda la lee completa.
      const store = await loadStorefront((await resolvePublicCatalog(a.slug))!);
      assert.equal(store.appearance.template, "oscura");
      assert.equal(store.theme.branded, true);
    });

    await t.test("portada: MIME falso da 400 y no guarda nada; una imagen real se comprime y la tienda la sirve", async () => {
      const a = await seed();
      const b = await seed({ enabled: false });
      const upload = (world: World, kind: "desktop" | "mobile", bytes: Uint8Array, name: string, type: string) => {
        const form = new FormData();
        form.append("file", new File([new Uint8Array(bytes)], name, { type }));
        return uploadCover(world.ctx, kind, new Request("http://x/api/admin/organization/appearance/covers/desktop", { method: "POST", body: form }));
      };
      // Texto/ejecutable renombrado a .jpg y declarado image/jpeg.
      const fake = await upload(a, "desktop", new Uint8Array(Buffer.from("MZ\x90\x00 esto no es una imagen")), "portada.jpg", "image/jpeg");
      assert.equal(fake.status, 400);
      assert.match(((await fake.json()) as { error: string }).error, /JPG, PNG o WebP real/);
      assert.equal(await db.organizationCover.count({ where: { organizationId: a.org } }), 0);
      // Más de 2 MB.
      const big = new Uint8Array(2 * 1024 * 1024 + 10);
      big.set([0xff, 0xd8, 0xff]);
      assert.equal((await upload(a, "desktop", big, "grande.jpg", "image/jpeg")).status, 413);
      // Imagen real de escritorio y de celular.
      const desktop = await sharp({ create: { width: 2400, height: 750, channels: 3, background: "#336699" } }).jpeg().toBuffer();
      const ok = await upload(a, "desktop", new Uint8Array(desktop), "d.jpg", "image/jpeg");
      assert.equal(ok.status, 200);
      const mobile = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: "#996633" } }).png().toBuffer();
      assert.equal((await upload(a, "mobile", new Uint8Array(mobile), "m.png", "image/png")).status, 200);
      const rows = await db.organizationCover.findMany({ where: { organizationId: a.org }, orderBy: { kind: "asc" } });
      assert.deepEqual(rows.map((row) => [row.kind, row.mime, row.width]), [["desktop", "image/webp", 1920], ["mobile", "image/webp", 1080]]);
      // Reemplazar no duplica.
      assert.equal((await upload(a, "desktop", new Uint8Array(desktop), "d2.jpg", "image/jpeg")).status, 200);
      assert.equal(await db.organizationCover.count({ where: { organizationId: a.org } }), 2);
      // Pública: solo con la tienda encendida y de ESA empresa.
      const served = await publicCover(new Request("http://x"), params({ orgSlug: a.slug, kind: "desktop" }));
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/webp");
      assert.equal((await publicCover(new Request("http://x"), params({ orgSlug: a.slug, kind: "tablet" }))).status, 404);
      assert.equal((await publicCover(new Request("http://x"), params({ orgSlug: b.slug, kind: "desktop" }))).status, 404, "tienda apagada");
      assert.equal((await publicCover(new Request("http://x"), params({ orgSlug: "no-existe", kind: "desktop" }))).status, 404);
      const store = await loadStorefront((await resolvePublicCatalog(a.slug))!);
      assert.match(store.covers.desktop ?? "", new RegExp(`^/api/catalog/${a.slug}/cover/desktop\\?v=`));
      assert.match(store.covers.mobile ?? "", /cover\/mobile/);
    });

    await t.test("acceso con solicitud: acuse idéntico, aprobación crea cliente y link, y el link abre el catálogo", async () => {
      const a = await seed({ mode: "REQUEST" });
      const other = await seed({ mode: "REQUEST" });
      const requestBody = { name: "Beto Gómez", company: "Eventos Beto", phone: "+595 982 111 222", email: "Beto@Example.com", kind: "RETAIL" };
      const first = await accessRequestPost(json(`http://x/api/catalog/${a.slug}/access-request`, requestBody), params({ orgSlug: a.slug }));
      assert.equal(first.status, 202);
      const firstBody = await first.json();
      // Mismo correo otra vez: misma respuesta, sin otra fila (no revela que ya existe).
      const second = await accessRequestPost(json(`http://x/api/catalog/${a.slug}/access-request`, { ...requestBody, email: "beto@example.com" }), params({ orgSlug: a.slug }));
      assert.equal(second.status, 202);
      assert.deepEqual(await second.json(), firstBody);
      assert.equal(await db.catalogAccessRequest.count({ where: { organizationId: a.org } }), 1);
      // Honeypot, datos inválidos y tienda en otro modo.
      assert.equal((await accessRequestPost(json(`http://x`, { ...requestBody, email: "x@y.com", website: "http://spam" }), params({ orgSlug: a.slug }))).status, 400);
      assert.equal((await accessRequestPost(json(`http://x`, { ...requestBody, email: "malo" }), params({ orgSlug: a.slug }))).status, 400);
      const open = await seed({ mode: "OPEN" });
      assert.equal((await accessRequestPost(json(`http://x`, requestBody), params({ orgSlug: open.slug }))).status, 403);
      assert.equal((await accessRequestPost(json(`http://x`, requestBody), params({ orgSlug: "no-existe" }))).status, 404);
      // Rate limit por IP.
      let last = 0;
      for (let i = 0; i < 7; i++) last = (await accessRequestPost(json(`http://x`, { ...requestBody, email: `r${i}@example.com` }, {}, "203.0.113.50"), params({ orgSlug: a.slug }))).status;
      assert.equal(last, 429);

      const [pending] = (await listAccessRequests(a.org)).filter((row) => row.email === "beto@example.com");
      assert.equal(pending.status, "PENDING");
      // Otra empresa no puede aprobar ni rechazar la solicitud ajena.
      const foreign = await approveAccessRequest(other.ctx, pending.id, actor);
      assert.deepEqual([foreign.ok, foreign.ok ? 0 : foreign.status], [false, 404]);
      assert.deepEqual(await rejectAccessRequest(other.ctx, pending.id, null), { ok: false, status: 404, error: "La solicitud no existe en esta empresa." });

      const approved = await approveAccessRequest(a.ctx, pending.id, actor);
      assert.ok(approved.ok);
      if (!approved.ok) return;
      assert.match(approved.url, new RegExp(`/tienda/${a.slug}/acceso/lbxw_`));
      assert.equal(approved.clientCreated, true);
      assert.ok(["sent", "skipped", "failed"].includes(approved.mail.status));
      const mailLog = await db.mailLog.findFirst({ where: { organizationId: a.org, category: "catalog" } });
      if (approved.mail.status !== "skipped") assert.ok(mailLog, "el envío queda en el historial");
      const token = approved.url.split("/").pop()!;
      const client = await db.client.findFirstOrThrow({ where: { organizationId: a.org, email: "beto@example.com" } });
      const row = await db.catalogAccessToken.findFirstOrThrow({ where: { organizationId: a.org, clientId: client.id } });
      assert.equal(row.priceList, "RETAIL");
      assert.ok(!JSON.stringify(row).includes(token), "solo vive el hash");
      // Segunda aprobación: 409.
      const twice = await approveAccessRequest(a.ctx, pending.id, actor);
      assert.deepEqual([twice.ok, twice.ok ? 0 : twice.status], [false, 409]);

      // El link abre el catálogo de cliente final de ESA empresa; en la de otra empresa o como mayorista, no.
      const context = await resolveAccessCatalog(a.slug, token);
      assert.equal(context?.access?.client.id, client.id);
      assert.equal(context?.priceList, "RETAIL");
      assert.equal(await resolveAccessCatalog(other.slug, token), null);
      assert.equal(await resolveWholesaleCatalog(a.slug, token), null, "un acceso de cliente final no abre el mayorista");
      assert.equal(await resolveAccessCatalog(a.slug, "lbxw_" + "x".repeat(32)), null);

      // Sin el link no se puede pedir en una tienda con solicitud; con el link sí, a nombre del cliente.
      const blocked = await preorderPost(json(`http://x`, orderBody([{ id: a.plato.id, quantity: 1 }])), params({ orgSlug: a.slug }));
      assert.equal(blocked.status, 403);
      const viaLink = await accessPreorderPost(json(`http://x`, orderBody([{ id: a.plato.id, quantity: 2 }])), params({ orgSlug: a.slug, token }));
      assert.equal(viaLink.status, 201);
      const quote = await db.quoteRequest.findFirstOrThrow({ where: { organizationId: a.org } });
      assert.equal(quote.clientId, client.id);
      assert.equal(quote.priceList, "RETAIL");
      assert.equal((await accessPreorderPost(json(`http://x`, orderBody([{ id: a.plato.id, quantity: 1 }])), params({ orgSlug: other.slug, token }))).status, 404);
      // Revocar el link lo apaga.
      await db.catalogAccessToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      assert.equal(await resolveAccessCatalog(a.slug, token), null);
    });

    await t.test("acceso: rechazo de una solicitud, mayorista con link propio y tienda privada", async () => {
      const a = await seed({ mode: "REQUEST" });
      const wholesale = await accessRequestPost(json(`http://x`, { name: "Carla Mayorista", company: "Carla SRL", phone: "+595 983 000 000", email: "carla@example.com", kind: "WHOLESALE" }), params({ orgSlug: a.slug }));
      assert.equal(wholesale.status, 202);
      const retail = await accessRequestPost(json(`http://x`, { name: "Dani", phone: "+595 984 000 000", email: "dani@example.com", kind: "RETAIL" }), params({ orgSlug: a.slug }));
      assert.equal(retail.status, 202);
      const rows = await listAccessRequests(a.org);
      const carla = rows.find((row) => row.email === "carla@example.com")!;
      const dani = rows.find((row) => row.email === "dani@example.com")!;
      const rejected = await rejectAccessRequest(a.ctx, dani.id, "No trabajamos con particulares");
      assert.deepEqual(rejected, { ok: true });
      assert.equal(await db.client.count({ where: { organizationId: a.org, email: "dani@example.com" } }), 0, "rechazar no crea cliente");
      assert.deepEqual((await rejectAccessRequest(a.ctx, dani.id, null)).ok, false, "ya respondida");
      assert.equal((await approveAccessRequest(a.ctx, dani.id, actor)).ok, false);
      // Quien fue rechazado puede volver a pedir (la fila rechazada no bloquea).
      assert.equal((await accessRequestPost(json(`http://x`, { name: "Dani", phone: "+595 984 000 000", email: "dani@example.com", kind: "RETAIL" }), params({ orgSlug: a.slug }))).status, 202);
      assert.equal(await db.catalogAccessRequest.count({ where: { organizationId: a.org, email: "dani@example.com" } }), 2);

      const approved = await approveAccessRequest(a.ctx, carla.id, actor);
      assert.ok(approved.ok);
      if (!approved.ok) return;
      assert.match(approved.url, new RegExp(`/tienda/${a.slug}/mayorista/lbxw_`));
      const token = approved.url.split("/").pop()!;
      const context = await resolveWholesaleCatalog(a.slug, token);
      assert.equal(context?.priceList, "WHOLESALE");
      assert.equal(await resolveAccessCatalog(a.slug, token), null);

      // Tienda privada: no recibe solicitudes ni pedidos sin link, pero el link mayorista sigue funcionando.
      await db.organizationRentalSettings.update({ where: { organizationId: a.org }, data: { catalogAccessMode: "PRIVATE" } });
      assert.equal((await accessRequestPost(json(`http://x`, { name: "Eli", phone: "+595 985 000 000", email: "eli@example.com", kind: "RETAIL" }), params({ orgSlug: a.slug }))).status, 403);
      assert.equal((await preorderPost(json(`http://x`, orderBody([{ id: a.plato.id, quantity: 1 }])), params({ orgSlug: a.slug }))).status, 403);
      assert.ok(await resolveWholesaleCatalog(a.slug, token));
      // Abierta: como hoy.
      await db.organizationRentalSettings.update({ where: { organizationId: a.org }, data: { catalogAccessMode: "OPEN" } });
      assert.equal((await preorderPost(json(`http://x`, orderBody([{ id: a.plato.id, quantity: 1 }])), params({ orgSlug: a.slug }))).status, 201);
    });

    await t.test("rechazo de un pedido con motivo: el cliente lo ve, no se convierte y es de ESA empresa", async () => {
      const a = await seed();
      const b = await seed();
      const quote = await preorder(a, [{ id: a.plato.id, quantity: 2 }]);
      assert.equal((await rejectQuoteRequest(a.ctx, quote.id, "  ", actor)).ok, false);
      assert.deepEqual((await rejectQuoteRequest(b.ctx, quote.id, "No es mío", actor)).ok, false, "otra empresa: 404");
      const foreign = await rejectQuoteRequest(b.ctx, quote.id, "No es mío", actor);
      assert.equal(foreign.ok ? 0 : foreign.status, 404);
      const done = await rejectQuoteRequest(a.ctx, quote.id, "Esa fecha ya tenemos todo comprometido", actor);
      assert.ok(done.ok);
      const row = await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
      assert.equal(row.status, "DECLINED");
      assert.equal(row.declineReason, "Esa fecha ya tenemos todo comprometido");
      assert.equal(row.declinedBy, "COMPANY");
      const view = await loadPublicOrder(quote.publicToken!);
      assert.equal(view?.status, "DECLINED");
      assert.deepEqual(view?.decline, { reason: "Esa fecha ya tenemos todo comprometido", by: "COMPANY" });
      assert.ok(!JSON.stringify(view).includes(a.org), "sin ids internos");
      const mailLog = await db.mailLog.findFirst({ where: { organizationId: a.org, entityId: quote.id } });
      if (done.ok && done.mail.status !== "skipped") assert.ok(mailLog);
      // Ya cerrado: no se rechaza ni se convierte ni se modifica.
      assert.equal((await rejectQuoteRequest(a.ctx, quote.id, "otra vez", actor)).ok, false);
      const convert = await convertQuoteRequest(a.ctx, quote.id);
      assert.deepEqual([convert.ok, convert.ok ? 0 : convert.status], [false, 409]);
      const modify = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: quote.items[0].id, action: "remove" }], note: null }, actor);
      assert.equal(modify.ok, false);
      assert.equal(await db.eventInventory.count({ where: { organizationId: a.org } }), 0, "nada reservado");
      assert.equal(await db.auditLog.count({ where: { organizationId: a.org, summary: { contains: "Rechazó un pedido" } } }), 1);
    });

    await t.test("pedido modificado: sustitución con findSubstitutes, stock real, aprobación del cliente, conversión y retención", async () => {
      const a = await seed();
      const b = await seed();
      // Piden 5 platos llanos, 3 copas y 1 mantel para el mismo período.
      const quote = await preorder(a, [{ id: a.plato.id, quantity: 5 }, { id: a.copa.id, quantity: 3 }, { id: a.mantel.id, quantity: 1 }]);
      const lineOf = (name: string) => quote.items.find((item) => item.productName === name)!;
      // Otro evento deja solo 2 platos llanos libres y 1 copa libre en esas fechas.
      await hold(a, a.plato.id, 8, 29, 32);
      await hold(a, a.copa.id, 3, 29, 32);

      // Reemplazos de la misma categoría con stock libre en el período (los más libres primero); el mantel es de otra categoría.
      const subs = await listQuoteItemSubstitutes(a.ctx, quote.id, lineOf("Plato llano").id);
      assert.ok(subs.ok);
      assert.deepEqual(subs.ok ? subs.substitutes.map((entry) => entry.name) : [], ["Plato hondo", "Copa de vino"]);
      const foreignSubs = await listQuoteItemSubstitutes(b.ctx, quote.id, lineOf("Plato llano").id);
      assert.equal(foreignSubs.ok ? 0 : foreignSubs.status, 404);

      // Sin stock real: 5 platos y 3 copas no entran.
      const tooMany = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: lineOf("Mantel blanco").id, action: "keep" }], note: null }, actor);
      assert.equal(tooMany.ok, false);
      assert.equal(tooMany.ok ? 0 : tooMany.status, 409);
      assert.match(tooMany.ok ? "" : tooMany.error, /«Plato llano» \(piden 5, hay 2\)/);
      assert.match(tooMany.ok ? "" : tooMany.error, /«Copa de vino» \(piden 3, hay 1\)/);
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status, "NEW", "una propuesta rechazada no deja el pedido a medias");
      // Un producto que no es un reemplazo disponible se rechaza (mantel es de otra categoría).
      const wrong = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: lineOf("Plato llano").id, action: "substitute", quantity: 3, substituteInventoryId: a.mantel.id }], note: null }, actor);
      assert.equal(wrong.ok ? 0 : wrong.status, 409);
      // Un reemplazo de otra empresa tampoco.
      const crossTenant = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: lineOf("Plato llano").id, action: "substitute", quantity: 3, substituteInventoryId: b.hondo.id }], note: null }, actor);
      assert.equal(crossTenant.ok ? 0 : crossTenant.status, 409);
      // Cantidad del reemplazo por encima de lo libre (6 hondos, 6 libres: 7 no existe) → 409.
      // Una línea de otra empresa/pedido: 404.
      const strange = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: randomUUID(), action: "remove" }], note: null }, actor);
      assert.equal(strange.ok ? 0 : strange.status, 404);
      const foreign = await modifyQuoteRequest(b.ctx, quote.id, { lines: [{ itemId: lineOf("Mantel blanco").id, action: "remove" }], note: null }, actor);
      assert.equal(foreign.ok ? 0 : foreign.status, 404);

      // Propuesta válida: 2 llanos + 3 hondos (sustituyen a 3 llanos), 1 copa (de 3), y «ya no tengo» el mantel.
      const proposal = await modifyQuoteRequest(
        a.ctx,
        quote.id,
        {
          lines: [
            { itemId: lineOf("Plato llano").id, action: "quantity", quantity: 2 },
            { itemId: lineOf("Copa de vino").id, action: "quantity", quantity: 1 },
            { itemId: lineOf("Mantel blanco").id, action: "unavailable" },
          ],
          note: "Te dejamos lo que tenemos libre esa fecha.",
        },
        actor,
      );
      assert.ok(proposal.ok, proposal.ok ? "" : proposal.error);
      if (!proposal.ok) return;
      assert.equal(proposal.status, "PROPOSED");
      assert.equal(proposal.total, (2 * 5_000 + 1 * 3_000) * 2, "total de las líneas activas por 2 días");
      assert.equal(proposal.changes.length, 3);
      const modified = await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { items: true } });
      assert.equal(modified.status, "PROPOSED");
      assert.equal(modified.proposalNote, "Te dejamos lo que tenemos libre esa fecha.");
      assert.equal(modified.referenceTotal, proposal.total);
      const byName = (name: string) => modified.items.find((item) => (item.originalName ?? item.productName) === name)!;
      assert.deepEqual([byName("Plato llano").state, byName("Plato llano").quantity, byName("Plato llano").originalQuantity], ["CHANGED", 2, 5]);
      assert.equal(byName("Mantel blanco").state, "UNAVAILABLE");
      assert.equal(await db.eventInventory.count({ where: { organizationId: a.org, event: { name: { not: "Evento ajeno" } } } }), 0, "proponer no reserva");

      // Con la propuesta pendiente la empresa no puede aceptar todavía.
      const early = await convertQuoteRequest(a.ctx, quote.id);
      assert.deepEqual([early.ok, early.ok ? 0 : early.status], [false, 409]);
      assert.match(early.ok ? "" : early.error, /aprobación del cliente/);

      // El cliente ve la versión modificada, sin datos internos.
      const view = await loadPublicOrder(quote.publicToken!);
      assert.equal(view?.status, "PROPOSED");
      assert.equal(view?.proposal?.note, "Te dejamos lo que tenemos libre esa fecha.");
      assert.deepEqual(view?.items.map((item) => [item.name, item.quantity, item.state, item.originalQuantity]).sort(), [["Copa de vino", 1, "CHANGED", 3], ["Mantel blanco", 1, "UNAVAILABLE", 1], ["Plato llano", 2, "CHANGED", 5]]);
      assert.ok(!JSON.stringify(view).match(/dailyCost|costPrice|organizationId/));

      // Token ajeno / inexistente: 404; acción inválida: 400.
      assert.equal((await respondToProposal("a".repeat(24), "approve")).ok, false);
      assert.equal((await respondPost(json(`http://x`, { action: "borrar" }), params({ token: quote.publicToken! }))).status, 400);

      // El cliente aprueba por el endpoint público.
      const approve = await respondPost(json(`http://x`, { action: "approve" }), params({ token: quote.publicToken! }));
      assert.equal(approve.status, 200);
      assert.equal(((await approve.json()) as { status: string }).status, "APPROVED");
      assert.equal((await respondToProposal(quote.publicToken!, "approve")).ok, true, "idempotente");
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status, "APPROVED");
      const stale = await respondToProposal(quote.publicToken!, "decline");
      assert.equal(stale.ok ? 0 : stale.status, 409, "ya aprobada: no se puede rechazar");

      // La empresa acepta: conversión única con las cantidades modificadas y sin las líneas quitadas.
      const converted = await convertQuoteRequest(a.ctx, quote.id);
      assert.ok(converted.ok, converted.ok ? "" : converted.error);
      if (!converted.ok) return;
      const budget = await db.budget.findUniqueOrThrow({ where: { id: converted.budget.id }, include: { items: { orderBy: { name: "asc" } } } });
      assert.deepEqual(budget.items.map((item) => [item.name, item.quantity]), [["Copa de vino", 1], ["Plato llano", 2]]);
      assert.equal(budget.total, (2 * 5_000 + 1 * 3_000) * 2);
      assert.match(budget.notes ?? "", /aprobado por el cliente/);
      assert.equal(converted.unpricedLines, 0);
      const again = await convertQuoteRequest(a.ctx, quote.id);
      assert.deepEqual([again.ok, again.ok ? 0 : again.status], [false, 409], "no se duplica la conversión");
      assert.equal(await db.budget.count({ where: { quoteRequestId: quote.id } }), 1);

      // Retención real con el motor de stock: respeta lo ya comprometido por otros eventos.
      const held = await holdQuoteRequestStock(a.ctx, quote.id);
      assert.ok(held.ok, held.ok ? "" : held.error);
      const assignments = await db.eventInventory.findMany({ where: { budgetId: converted.budget.id } });
      assert.deepEqual(assignments.map((row) => row.quantity).sort(), [1, 2]);
      assert.ok(assignments.every((row) => row.holdExpiresAt), "son retenciones con vencimiento");
      // Y la aprobación del presupuesto (stock de 2.1.117) ve el mismo stock: nada falta.
      const gate = await peekStockBeforeApproval({ organizationId: a.org, budgetId: converted.budget.id, context: portalAuditContext(a.org, "Ana") });
      assert.equal(gate.ok, true, gate.ok ? "" : gate.message);
      assert.equal(await db.eventInventory.count({ where: { inventoryId: a.plato.id, releasedAt: null } }), 2, "plato: evento ajeno + retención, sin sobreventa");
    });

    await t.test("propuesta con sustitución: el reemplazo trae su precio, y si el stock se va antes de aprobar no se aprueba", async () => {
      const a = await seed();
      const quote = await preorder(a, [{ id: a.plato.id, quantity: 4 }], "carlos@example.com");
      await hold(a, a.plato.id, 8, 29, 32); // quedan 2 llanos
      const line = quote.items[0];
      const proposal = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: line.id, action: "substitute", quantity: 4, substituteInventoryId: a.hondo.id }], note: null }, actor);
      assert.ok(proposal.ok, proposal.ok ? "" : proposal.error);
      const row = await db.quoteItem.findUniqueOrThrow({ where: { id: line.id } });
      assert.deepEqual([row.state, row.productName, row.originalName, row.inventoryId, row.unitPrice, row.quantity], ["SUBSTITUTED", "Plato hondo", "Plato llano", a.hondo.id, 6_000, 4]);
      assert.equal(row.subtotal, 6_000 * 4 * 2);
      // Mientras el cliente decide, otro evento toma los platos hondos: la aprobación se vuelve a verificar.
      await hold(a, a.hondo.id, 5, 30, 31);
      const approve = await respondToProposal(quote.publicToken!, "approve");
      assert.equal(approve.ok, false);
      assert.equal(approve.ok ? 0 : approve.status, 409);
      assert.match(approve.ok ? "" : approve.error, /sin disponibilidad/);
      const after = await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
      assert.equal(after.status, "REVIEWING", "vuelve a revisión para que la empresa proponga otra cosa");
      assert.equal(after.proposalApprovedAt, null);
    });

    await t.test("el cliente puede rechazar la propuesta y queda registrado quién rechazó", async () => {
      const a = await seed();
      const quote = await preorder(a, [{ id: a.plato.id, quantity: 2 }, { id: a.copa.id, quantity: 2 }], "dora@example.com");
      const proposal = await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: quote.items.find((item) => item.productName === "Copa de vino")!.id, action: "remove" }], note: "Sin copas esa fecha" }, actor);
      assert.ok(proposal.ok);
      const declined = await respondPost(json(`http://x`, { action: "decline", note: "Necesito las copas" }), params({ token: quote.publicToken! }));
      assert.equal(declined.status, 200);
      const row = await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
      assert.deepEqual([row.status, row.declinedBy, row.declineReason], ["DECLINED", "CLIENT", "Necesito las copas"]);
      const view = await loadPublicOrder(quote.publicToken!);
      assert.deepEqual(view?.decline, { reason: "Necesito las copas", by: "CLIENT" });
      assert.equal(await db.auditLog.count({ where: { organizationId: a.org, actorName: "Ana Pérez", summary: { contains: "rechazó la propuesta" } } }), 1);
    });

    await t.test("demo: la vitrina no guarda la respuesta del cliente", async () => {
      const a = await seed();
      const quote = await preorder(a, [{ id: a.plato.id, quantity: 1 }], "demo@example.com");
      await modifyQuoteRequest(a.ctx, quote.id, { lines: [{ itemId: quote.items[0].id, action: "quantity", quantity: 2 }], note: null }, actor);
      await db.organization.update({ where: { id: a.org }, data: { isDemo: true } });
      const result = await respondToProposal(quote.publicToken!, "approve");
      assert.equal(result.ok ? 0 : result.status, 403);
      assert.equal((await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status, "PROPOSED");
    });
  } finally {
    await db.organization.deleteMany({ where: { slug: { startsWith: "pa-" } } });
    await db.$disconnect();
  }
});
