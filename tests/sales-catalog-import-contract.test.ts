import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSalesCatalogImportV1 } from "../lib/sales-catalog-import-contract";

const product: Record<string, unknown> = {
  codigo: "PANT-01-43-NEGRO",
  nombre: "Pantalla de ejemplo",
  descripcion: null,
  categoria: "Pantallas",
  familia: "PANT-01",
  variante: { pulgadas: "43", color: "Negro" },
  especificaciones: { tecnologia: "LCD", resolucionNativa: null, brilloNits: null },
  foto: "fotos/PANT-01-43-NEGRO.webp",
  costos: {
    productoEnOrigen: { amount: null, currency: "USD" },
    trasladoHastaPuertoChina: null,
    cbm: null,
    importacionPorcentaje: null,
  },
  precios: {
    minorista: null,
    mayorista: [],
  },
};

const catalog = (products: unknown[] = [product]) => ({ formato: "ledbox.catalogo-venta", version: 1, productos: products });

test("acepta producto de venta con datos comerciales desconocidos como null", () => {
  const result = parseSalesCatalogImportV1(catalog());
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.productos[0].costos.productoEnOrigen?.amount, null);
    assert.equal(result.data.productos[0].precios.minorista, null);
  }
});

test("rechaza cantidades y campos de alquiler o stock en la importación de venta", () => {
  const result = parseSalesCatalogImportV1(catalog([{ ...product, cantidad: 48, precio: 100_000, cobro: "dia" }]));
  assert.equal(result.success, false);
});

test("rechaza SKU duplicado sin distinguir mayúsculas", () => {
  const result = parseSalesCatalogImportV1(catalog([product, { ...product, codigo: "pant-01-43-negro", variante: { pulgadas: "55", color: "Negro" } }]));
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /Código repetido/);
});

test("rechaza la misma variante repetida dentro de una familia", () => {
  const result = parseSalesCatalogImportV1(catalog([product, { ...product, codigo: "PANT-01-OTRO" }]));
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error.issues.some((issue) => issue.message.includes("combinación de opciones")));
});

test("exige familia cuando hay opciones y opciones cuando hay familia", () => {
  assert.equal(parseSalesCatalogImportV1(catalog([{ ...product, familia: null }])).success, false);
  assert.equal(parseSalesCatalogImportV1(catalog([{ ...product, variante: {} }])).success, false);
});

test("rechaza rutas de foto absolutas o con traversal", () => {
  for (const foto of ["/etc/foto.jpg", "../foto.png", "fotos\\foto.webp", "fotos/foto.svg", "https://example.com/foto.webp", "file:fotos/foto.webp"]) {
    const result = parseSalesCatalogImportV1(catalog([{ ...product, foto }]));
    assert.equal(result.success, false, `foto inesperadamente aceptada: ${foto}`);
  }
});

test("rechaza umbrales mayoristas repetidos y documentos de otra versión", () => {
  const repeatedTiers = parseSalesCatalogImportV1(catalog([{
    ...product,
    precios: { minorista: null, mayorista: [
      { cantidadMinima: 10, precioUnitario: { amount: 100, currency: "USD" } },
      { cantidadMinima: 10, precioUnitario: { amount: 90, currency: "USD" } },
    ] },
  }]));
  assert.equal(repeatedTiers.success, false);
  assert.equal(parseSalesCatalogImportV1({ ...catalog(), version: 2 }).success, false);
});
