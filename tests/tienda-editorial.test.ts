import assert from "node:assert/strict";
import { test } from "node:test";
import { moveId, moveIdBefore, parseStorefrontOrder, sortStorefrontItems, sortValueAt } from "../lib/storefront-order";
import { EMPTY_STORE_CART, readLocalStoreCart, sanitizeStoreCart, serializeStoreCart, storeCartKey, writeLocalStoreCart } from "../lib/store-cart";
import { parsePriceAmount, parsePriceRequest, parsePriceResponse } from "../lib/price-request";
import { DEFAULT_APPEARANCE, FONTS, TEMPLATES, TEMPLATE_META, appearanceView, parseAppearance, readAppearance } from "../lib/appearance";
import { contrastRatio } from "../lib/storefront-theme";
import { THEMES, themePrimary } from "../lib/storefront-templates";

// ── Orden ───────────────────────────────────────────────────────────────────

test("orden: secciones por sortOrder de la categoría y productos por webSortOrder, después por nombre", () => {
  const items = [
    { name: "Mesa", category: "Mesas", categorySort: 20, webSortOrder: 0 },
    { name: "Sofá B", category: "Living", categorySort: 10, webSortOrder: 20 },
    { name: "Sofá A", category: "Living", categorySort: 10, webSortOrder: 10 },
    { name: "Puff", category: "Living", categorySort: 10, webSortOrder: 20 },
    { name: "Suelto", category: "Sin árbol", categorySort: null, webSortOrder: 0 },
  ];
  assert.deepEqual(sortStorefrontItems(items).map((item) => item.name), ["Sofá A", "Puff", "Sofá B", "Mesa", "Suelto"]);
  // No muta la lista de entrada.
  assert.equal(items[0].name, "Mesa");
});

test("orden: mover arriba/abajo y arrastrar conservan todos los elementos", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "x", 1), ["a", "b", "c"]);
  assert.deepEqual(moveIdBefore(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveIdBefore(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
  assert.equal(sortValueAt(0), 10);
  assert.equal(sortValueAt(4), 50);
});

test("orden: el cuerpo del panel se valida (sin repetidos ni vacíos)", () => {
  assert.equal(parseStorefrontOrder(null).ok, false);
  assert.equal(parseStorefrontOrder({ sections: [] }).ok, false);
  assert.equal(parseStorefrontOrder({ sections: [{ categoryId: "c1", itemIds: ["i1"] }, { categoryId: "c1", itemIds: [] }] }).ok, false);
  assert.equal(parseStorefrontOrder({ sections: [{ categoryId: "c1", itemIds: ["i1"] }, { categoryId: "c2", itemIds: ["i1"] }] }).ok, false);
  assert.equal(parseStorefrontOrder({ sections: [{ categoryId: "", itemIds: [] }] }).ok, false);
  const ok = parseStorefrontOrder({ sections: [{ categoryId: "c2", itemIds: ["i2", "i1"] }, { categoryId: "c1", itemIds: [] }] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value.sections.map((section) => section.categoryId), ["c2", "c1"]);
});

// ── Carrito local ───────────────────────────────────────────────────────────

test("carrito: serializa y restaura solo referencias (sin precios) y es idempotente", () => {
  const state = { items: [{ id: "a", quantity: 2 }, { id: "b", quantity: 99 }], from: "2026-11-01", to: "2026-11-03", zone: "COORDINATE", seenTotal: 450000 };
  const text = serializeStoreCart(state);
  assert.deepEqual(sanitizeStoreCart(text), state);
  assert.deepEqual(sanitizeStoreCart(serializeStoreCart(sanitizeStoreCart(text))), state);
  assert.ok(!/price|precio|unit/i.test(text), "no se guardan precios");
});

test("carrito: descarta líneas rotas, repetidas o fuera de rango y fechas incoherentes", () => {
  const dirty = {
    items: [{ id: "a", quantity: 0 }, { id: "a", quantity: 1 }, { id: "a", quantity: 3 }, { id: "b", quantity: 100 }, { id: "", quantity: 1 }, { inventoryId: "c", quantity: 2.5 }, { inventoryId: "d", quantity: 4 }, null, "x"],
    from: "2026-11-05",
    to: "2026-11-01",
    zone: "z".repeat(80),
    seenTotal: -5,
  };
  const clean = sanitizeStoreCart(dirty);
  assert.deepEqual(clean.items, [{ id: "a", quantity: 1 }, { id: "d", quantity: 4 }]);
  assert.equal(clean.from, null);
  assert.equal(clean.to, null);
  assert.equal(clean.zone, "");
  assert.equal(clean.seenTotal, null);
});

test("carrito: JSON roto o basura devuelve un carrito vacío sin lanzar", () => {
  for (const raw of ["{no es json", "[]", "null", "42", undefined, null]) assert.deepEqual(sanitizeStoreCart(raw).items, []);
  assert.deepEqual(sanitizeStoreCart("").items, []);
  assert.equal(EMPTY_STORE_CART.items.length, 0);
});

test("carrito: la clave es por tienda y por tipo de acceso", () => {
  assert.notEqual(storeCartKey("Acme"), storeCartKey("otra"));
  assert.notEqual(storeCartKey("acme", "public"), storeCartKey("acme", "mayorista"));
  assert.equal(storeCartKey("  ACME "), storeCartKey("acme"));
});

test("carrito: con el almacenamiento roto no lanza y avisa que no pudo guardar", () => {
  const broken = {
    getItem() { throw new Error("bloqueado"); },
    setItem() { throw new Error("bloqueado"); },
    removeItem() { throw new Error("bloqueado"); },
  };
  assert.deepEqual(readLocalStoreCart("k", broken).items, []);
  assert.equal(writeLocalStoreCart("k", { ...EMPTY_STORE_CART, items: [{ id: "a", quantity: 1 }] }, broken), false);
  assert.equal(writeLocalStoreCart("k", EMPTY_STORE_CART, null), false);
  const memory = new Map<string, string>();
  const ok = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) };
  assert.equal(writeLocalStoreCart("k", { ...EMPTY_STORE_CART, items: [{ id: "a", quantity: 2 }] }, ok), true);
  assert.deepEqual(readLocalStoreCart("k", ok).items, [{ id: "a", quantity: 2 }]);
  writeLocalStoreCart("k", EMPTY_STORE_CART, ok);
  assert.equal(memory.has("k"), false);
});

// ── Pedido de mejor precio ──────────────────────────────────────────────────

test("mejor precio: comentario obligatorio, monto opcional y siempre menor al total", () => {
  assert.equal(parsePriceRequest({ comment: "  " }).ok, false);
  assert.equal(parsePriceRequest({ comment: "ab" }).ok, false);
  assert.equal(parsePriceRequest({ comment: "x".repeat(501) }).ok, false);
  const sinMonto = parsePriceRequest({ comment: "Somos clientes frecuentes" });
  assert.ok(sinMonto.ok && sinMonto.value.desiredAmount === null);
  const conMonto = parsePriceRequest({ comment: "Es para una boda", desiredAmount: "1.250.000" }, { total: 1_500_000 });
  assert.ok(conMonto.ok && conMonto.value.desiredAmount === 1_250_000);
  assert.equal(parsePriceRequest({ comment: "Es para una boda", desiredAmount: 1_500_000 }, { total: 1_500_000 }).ok, false);
  assert.equal(parsePriceRequest({ comment: "Es para una boda", desiredAmount: -5 }).ok, false);
  assert.equal(parsePriceRequest({ comment: "Es para una boda", desiredAmount: 1.5 }).ok, false);
  assert.equal(parsePriceRequest({ comment: "Es para una boda", desiredAmount: "abc" }).ok, false);
  assert.equal(parsePriceAmount(""), null);
});

test("mejor precio: la respuesta de la empresa exige lo que corresponde a cada acción", () => {
  const request = { desiredAmount: 900_000, originalTotal: 1_000_000 };
  const accept = parsePriceResponse({ action: "accept" }, request);
  assert.ok(accept.ok && accept.value.offeredAmount === 900_000);
  assert.equal(parsePriceResponse({ action: "accept" }, { desiredAmount: null, originalTotal: 1_000_000 }).ok, false);
  const counter = parsePriceResponse({ action: "counter", offeredAmount: 950_000, note: "Es lo mejor que podemos" }, request);
  assert.ok(counter.ok && counter.value.offeredAmount === 950_000 && counter.value.note === "Es lo mejor que podemos");
  assert.equal(parsePriceResponse({ action: "counter" }, request).ok, false);
  assert.equal(parsePriceResponse({ action: "counter", offeredAmount: 1_200_000 }, request).ok, false);
  assert.equal(parsePriceResponse({ action: "reject" }, request).ok, false);
  const reject = parsePriceResponse({ action: "reject", note: "Ya tiene el mejor precio" }, request);
  assert.ok(reject.ok && reject.value.offeredAmount === null);
  assert.equal(parsePriceResponse({ action: "borrar" }, request).ok, false);
});

// ── Plantilla Boutique (heredera de «Catálogo editorial») ───────────────────

test("plantilla: la editorial pasa a Boutique y la empresa elige entre las 4 plantillas nuevas", () => {
  assert.ok((TEMPLATES as readonly string[]).includes("boutique"));
  assert.match(TEMPLATE_META.boutique.label, /boutique/i);
  assert.equal(DEFAULT_APPEARANCE.template, "boutique");
  assert.equal(readAppearance({ template: "editorial", font: "cormorant-garamond" }).template, "boutique", "alias de lectura");
  const parsed = parseAppearance({ template: "boutique", font: "cormorant-garamond" });
  assert.ok(parsed.ok && parsed.appearance.template === "boutique");
  assert.equal(parseAppearance({ template: "otra" }).ok, false);
});

test("plantilla: tipografías de lista cerrada (serif de Boutique y de títulos)", () => {
  assert.ok(FONTS.some((font) => font.id === "cormorant-garamond"));
  assert.equal(parseAppearance({ font: "comic-sans" }).ok, false);
  assert.equal(readAppearance({ template: "elegante", font: "inter" }).template, "boutique");
});

test("plantilla: Boutique minimalista usa blanco y negro, letra del sistema y pie claro", () => {
  const view = appearanceView({ ...DEFAULT_APPEARANCE, template: "boutique" });
  assert.equal(view.attrs["data-store-theme"], "boutique");
  assert.match(view.vars["--font-display"], /system-ui/);
  assert.equal(view.fontHref, null);
  assert.equal(view.vars["--color-primary"], "#111111");
  assert.equal(view.vars["--color-ink"], "#F5F5F7");
  assert.equal(view.vars["--color-bg"], "#FFFFFF");
  const otros = appearanceView({ ...DEFAULT_APPEARANCE, template: "escenario" });
  assert.ok(!otros.fontHref?.includes("Pinyon"));
});

test("plantilla: negro por defecto con contraste AA y marca personalizada conservada", () => {
  const { colors } = THEMES.boutique;
  assert.ok(contrastRatio(colors.primary, colors.bg) >= 4.5, "negro sobre blanco");
  assert.ok(contrastRatio(colors.primary, "#ffffff") >= 4.5, "negro sobre superficie");
  const sinMarca = themePrimary("boutique", null);
  assert.equal(sinMarca.primary, colors.primary);
  assert.ok(contrastRatio(sinMarca.onPrimary, sinMarca.primary) >= 4.5, "texto del botón");
  assert.equal(themePrimary("boutique", "#0b5cd5").primary, "#0b5cd5");
});

// ── Contacto del visitante y sugeridos de la ficha ──────────────────────────

import { parseVisitorContact, selfShareLinks } from "../lib/store-contact";
import { pickRelated, RELATED_MAX } from "../lib/server/catalog-product";

test("contacto del carrito: nombre y al menos WhatsApp o correo, validados con field-rules", () => {
  assert.equal(parseVisitorContact({ name: "A", phone: "+595981000111" }).ok, false);
  assert.equal(parseVisitorContact({ name: "Ana Pérez" }).ok, false, "sin WhatsApp ni correo no se guarda");
  assert.equal(parseVisitorContact({ name: "Ana Pérez", email: "no-es-correo" }).ok, false);
  assert.equal(parseVisitorContact({ name: "Ana Pérez", phone: "12" }).ok, false);
  const ok = parseVisitorContact({ name: "  Ana   Pérez ", email: " ANA@Example.COM " });
  assert.ok(ok.ok && ok.value.name === "Ana Pérez" && ok.value.email === "ana@example.com" && ok.value.phone === null);
  const links = selfShareLinks({ phone: "+595 981 000 111", email: "ana@example.com" }, "https://x.test/tienda/a/carrito/lbxw_abc", "La Vajilla");
  assert.match(links.whatsapp ?? "", /^https:\/\/wa\.me\/595981000111\?text=/);
  assert.match(links.mailto ?? "", /^mailto:ana@example\.com\?subject=/);
  assert.equal(selfShareLinks({ phone: null, email: null }, "u", "n").whatsapp, null);
});

test("ficha: «Te puede interesar» pone primero los combos que lo contienen, después la categoría, con tope de 8 y sin repetir", () => {
  const mk = (id: string, category: string) => ({ id, category }) as never;
  const all = [mk("a", "Sillas"), mk("c1", "Juegos"), mk("b", "Sillas"), ...Array.from({ length: 10 }, (_, i) => mk(`o${i}`, "Mesas")), mk("c2", "Sillas")];
  const picked = pickRelated({ id: "a", category: "Sillas" }, all as never, new Set(["c1", "c2"]));
  assert.deepEqual(picked.slice(0, 4).map((entry) => entry.id), ["c1", "c2", "b", "o0"]);
  assert.equal(picked.length, RELATED_MAX);
  assert.ok(!picked.some((entry) => entry.id === "a"));
  assert.equal(new Set(picked.map((entry) => entry.id)).size, picked.length);
  assert.deepEqual(pickRelated({ id: "solo", category: "X" }, [mk("solo", "X")] as never, new Set()), []);
});
