import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeStoreListState, readStoreListState, storeListStateFromQuery, storeListStateHref } from "../lib/storefront-list-state";

test("el estado de búsqueda, orden y filtros es compartible sin perder fecha, categoría o ficha", () => {
  const params = new URLSearchParams("desde=2026-10-20&hasta=2026-10-21&categoria=Living&p=item-1&q=mesa&orden=nombre&capacidad=4&precioDesde=0&precioHasta=250000&etiqueta=blanco&disponible=1");
  const state = readStoreListState(params);
  assert.deepEqual(state, {
    query: "mesa", sort: "nombre",
    filters: { capacity: "4", priceMin: null, priceMax: 250000, tags: ["blanco"], collection: null, onlyAvailable: true },
  });
  const href = storeListStateHref("https://ledbox.online/tienda/demo?desde=2026-10-20&hasta=2026-10-21&categoria=Living&p=item-1#catalogo", state);
  const url = new URL(href, "https://ledbox.online");
  assert.equal(url.searchParams.get("desde"), "2026-10-20");
  assert.equal(url.searchParams.get("hasta"), "2026-10-21");
  assert.equal(url.searchParams.get("categoria"), "Living");
  assert.equal(url.searchParams.get("p"), "item-1");
  assert.equal(url.searchParams.get("orden"), "nombre");
  assert.equal(url.searchParams.get("precioDesde"), null, "cero no se interpreta como un precio cargado");
  assert.equal(url.searchParams.get("disponible"), "1");
});

test("la URL de una categoría conserva el estado actual y los datos nulos quedan vacíos", () => {
  const state = storeListStateFromQuery({ q: "sillón", orden: "precio-desc", etiqueta: ["negro", "madera"], precioHasta: "", disponible: "0" });
  const next = mergeStoreListState("/tienda/demo/categoria/sillas?desde=2026-11-01&hasta=2026-11-01#catalogo", state);
  const url = new URL(next, "https://ledbox.online");
  assert.equal(url.pathname, "/tienda/demo/categoria/sillas");
  assert.equal(url.searchParams.get("desde"), "2026-11-01");
  assert.equal(url.searchParams.get("q"), "sillón");
  assert.equal(url.searchParams.get("orden"), "precio-desc");
  assert.deepEqual(url.searchParams.getAll("etiqueta"), ["negro", "madera"]);
  assert.equal(url.searchParams.get("precioHasta"), null);
  assert.equal(url.searchParams.get("disponible"), null);
});
