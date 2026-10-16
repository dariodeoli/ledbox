import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dispatchStoreLab } from "../lib/store-lab-http";
import { storeCartKey } from "../lib/store-cart";
import { appearanceView, DEFAULT_APPEARANCE, isTemplateId } from "../lib/appearance";
const nativeRequire = createRequire(import.meta.url);
function loadSource(path: string, mocks: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require: (id: string) => mocks[id] ?? nativeRequire(id), Response, Promise });
  return exports;
}
const labAuth = (options: { role?: string; organizationId?: string; denied?: number; quote?: boolean } = {}) => {
  let settingsReads = 0;
  const module = loadSource("lib/server/store-lab.ts", {
    "./tenancy": { requireAdminContext: async () => options.denied ? { ok: false, response: new Response(null, { status: options.denied }) } : { ok: true, context: { role: options.role ?? "OWNER", organizationId: options.organizationId ?? "tenant-a", organization: { id: options.organizationId ?? "tenant-a", name: "Aurora", slug: "aurora" } } } },
    "./rental-settings": { getRentalSettings: async () => { settingsReads++; return { publicShowPrices: true, catalogAccessMode: "PRIVATE", publicCatalogEnabled: false }; } },
    "./org-presentation": { loadOrgPresentation: async () => ({ appearance: { priceMode: options.quote ? "quote" : "day" } }) },
    "./http": { jsonError: (error: string, status: number) => Response.json({ error }, { status }) },
  });
  return { run: module.requireStoreLab, reads: () => settingsReads };
};

test("laboratorio exige sesión desbloqueada y OWNER/ADMIN antes de leer catálogo", async () => {
  for (const denied of [401, 423]) { const auth = labAuth({ denied }); assert.equal((await auth.run()).response.status, denied); assert.equal(auth.reads(), 0); }
  for (const role of ["VIEWER", "OPERATIONS", "FINANCE"]) { const auth = labAuth({ role }); assert.equal((await auth.run()).response.status, 403); assert.equal(auth.reads(), 0); }
  for (const role of ["OWNER", "ADMIN"]) { const auth = labAuth({ role }); assert.equal((await auth.run()).ok, true); }
});
test("empresa en URL debe coincidir con empresa activa; nunca selecciona otro tenant", async () => {
  const auth = labAuth(); assert.equal((await auth.run("tenant-b")).response.status, 409); assert.equal(auth.reads(), 0);
  const { context } = await auth.run("tenant-a");
  assert.equal(context.organization.id, "tenant-a"); assert.equal(context.priceList, "RETAIL"); assert.equal(context.access, null);
  assert.equal(context.settings.catalogAccessMode, "PRIVATE"); assert.equal(context.settings.publicCatalogEnabled, false);
});
test("modo a cotizar oculta importes también en cálculo server del laboratorio", async () => {
  assert.equal((await labAuth({ quote: true }).run()).context.settings.publicShowPrices, false);
});
test("envío real forzado sólo devuelve simulación sin leer cuerpo ni llamar dependencias", async () => {
  const request = new Request("http://local/preorder", { method: "POST", body: "datos personales inválidos" });
  let called = 0;
  const response = await dispatchStoreLab(request, ["preorder"], { price: async () => { called++; }, product: async () => { called++; return null; } });
  assert.equal((await response.json()).simulated, true); assert.equal(request.bodyUsed, false); assert.equal(called, 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("carrito y ficha usan dependencias de lectura; guardar/contactar y rutas maliciosas se rechazan", async () => {
  const seen: unknown[] = [];
  const dependencies = { price: async (value: unknown) => { seen.push(value); return { total: null }; }, product: async (code: string) => code === "visible" ? { item: { id: code } } : null };
  const cart = await dispatchStoreLab(new Request("http://local/cart", { method: "POST", body: JSON.stringify({ items: [] }) }), ["cart"], dependencies);
  assert.equal(cart.status, 200); assert.equal(seen.length, 1);
  assert.equal((await dispatchStoreLab(new Request("http://local/product"), ["product", "hidden"], dependencies)).status, 404);
  assert.equal((await dispatchStoreLab(new Request("http://local/product"), ["product", "visible"], dependencies)).status, 200);
  for (const [method, action] of [["PUT", "cart"], ["DELETE", "cart"], ["POST", "contact"], ["POST", "reserve"], ["POST", "access-request"]]) assert.equal((await dispatchStoreLab(new Request("http://local/", { method }), [action], dependencies)).status, 405);
  assert.equal(seen.length, 1);
});
test("carrito de laboratorio queda separado de producción y no se registra plantilla publicable", () => {
  assert.notEqual(storeCartKey("aurora", "lab"), storeCartKey("aurora", "public"));
  assert.equal(isTemplateId("landing"), false); assert.equal(isTemplateId("lab"), false);
});
test("SSR real de laboratorio adapta identidad, reutiliza hero y deja un solo carrito canónico aislado", () => {
  const hero = loadSource("components/public/LandingHero.tsx");
  const lab = loadSource("components/store-lab/LandingStoreLab.tsx", {
    "@/lib/appearance": { appearanceView, DEFAULT_APPEARANCE },
    "@/components/catalog-public/CatalogBrowser": { CatalogBrowser: (props: any) => createElement("div", { "data-cart-engine": "canonical", "data-scope": props.cartScope, "data-preorder": props.preorderPath, "data-cart": props.cartPath, "data-ficha": props.fichaBase ?? "", "data-items": props.items.length }) },
    "@/components/catalog-public/StoreChrome": { StoreChrome: ({ children }: any) => createElement("div", { className: "cp-theme" }, children) },
    "@/components/catalog-public/StoreLogo": { storeInitials: () => "AE" },
    "@/components/public/LandingHero": hero,
    "@/components/public/InstagramIcon": { InstagramIcon: () => createElement("svg") },
    "@/lib/storefront-ui": { PREORDER_COPY: { notice: "Sin reserva automática", logistics: "Logística a cotizar" } },
  });
  const markup = renderToStaticMarkup(createElement(lab.LandingStoreLab, { store: { name: "Aurora Eventos", slug: "aurora", tagline: "Experiencias Aurora", profile: { contact: { instagram: "aurora_eventos" }, location: { city: "Asunción" } }, logos: { light: false, dark: false }, covers: { desktop: null, mobile: null }, appearance: { priceMode: "day" } }, items: [], zones: [], organizationId: "tenant-a", range: null }));
  assert.match(markup, /Aurora Eventos/); assert.match(markup, /Experiencias Aurora/); assert.match(markup, /instagram\.com\/aurora_eventos/);
  assert.match(markup, /class="mega rise on"/); assert.match(markup, /data-scope="lab"/); assert.match(markup, /data-preorder="\/api\/admin\/store-lab\/tenant-a\/preorder"/);
  assert.equal((markup.match(/data-cart-engine=/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /whatsapp\.com|wa\.me|api\/catalog|ledboxpy|Santiago|\+100|Soporte incluido/);
});
test("ruta real verifica autorización/tenant antes de delegar cualquier método", async () => {
  let dispatched = 0;
  const route = loadSource("app/api/admin/store-lab/[organizationId]/[...action]/route.ts", {
    "@/lib/server/store-lab": { requireStoreLab: async (id: string) => ({ ok: false, response: Response.json({ error: id }, { status: 409 }) }) },
    "@/lib/store-lab-http": { dispatchStoreLab: async () => { dispatched++; return new Response(); } },
    "@/lib/server/store-cart": { priceStoreCart() { throw new Error("No debe preciar sin autorización"); } },
    "@/lib/server/catalog-product": { loadProductDetail() { throw new Error("No debe leer ficha sin autorización"); } },
  });
  for (const method of ["GET", "POST", "PUT", "DELETE"]) assert.equal((await route[method](new Request("http://local/", { method }), { params: Promise.resolve({ organizationId: "otra-empresa", action: ["preorder"] }) })).status, 409);
  assert.equal(dispatched, 0);
});
test("loader canónico filtra organización y audiencia; selección no pide costos internos", async () => {
  const file = ts.createSourceFile("catalog-public.ts", readFileSync("lib/server/catalog-public.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "loadVisibleRows"); assert.ok(declaration);
  const compiled = ts.transpileModule(`${declaration.getText(file).replace(/^export /, "")}\nloadVisibleRows;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let captured: any;
  const load = runInNewContext(compiled, { db: { inventoryItem: { findMany: async (query: unknown) => { captured = query; return []; } } }, catalogAudienceWhere: (list: string) => ({ audience: { in: list === "RETAIL" ? ["RETAIL", "BOTH"] : ["WHOLESALE", "BOTH"] } }), sortStorefrontItems: (rows: unknown) => rows, TIER_SELECT: {}, MAINTENANCE_UNITS_SELECT: {} });
  await load("tenant-a", "RETAIL", ["arbitrary-foreign-id"]);
  assert.equal(captured.where.organizationId, "tenant-a"); assert.equal(captured.where.archivedAt, null); assert.equal(captured.where.comboIncomplete, false);
  assert.deepEqual(Array.from(captured.where.audience.in), ["RETAIL", "BOTH"]);
  for (const field of ["dailyCost", "replacementCost", "purchasePrice", "notes", "imageData"]) assert.equal(captured.select[field], undefined);
});
test("hero compartido conserva el HTML exacto de la landing anterior", () => {
  const shared = loadSource("components/public/LandingHero.tsx");
  const props = { kicker: "LedBox Paraguay · Alquileres & Eventos", title: createElement("span", null, "Tecnología visual"), description: "Descripción", actions: createElement("a", { href: "#productos", className: "btn-line" }, "Ver productos"), foot: createElement("span", null, "Alquileres") };
  const before = createElement("header", { id: "hero" }, createElement("div", null, createElement("div", { className: "hero-kicker rise on" }, props.kicker), createElement("h1", { className: "mega rise on" }, props.title), createElement("p", { className: "hero-sub rise on" }, props.description), createElement("div", { className: "hero-actions rise on" }, props.actions)), createElement("div", { className: "hero-foot" }, props.foot));
  assert.equal(renderToStaticMarkup(createElement(shared.LandingHero, props)), renderToStaticMarkup(before));
});
