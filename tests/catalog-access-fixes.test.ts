import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { preorderSchema } from "../lib/server/catalog-public";

const base = {
  name: "Ana Pérez",
  phone: "+595 981 000 111",
  email: "ana@example.com",
  location: "Asunción",
  from: "2031-01-10",
  to: "2031-01-11",
  items: [{ inventoryId: "abc", quantity: 1 }],
};

test("deliveryCoordinate es estricto: el texto \"false\" no se convierte en true", () => {
  const read = (value: unknown) => {
    const parsed = preorderSchema.safeParse({ ...base, deliveryCoordinate: value });
    return parsed.success ? parsed.data.deliveryCoordinate : "invalid";
  };
  assert.equal(read(true), true);
  assert.equal(read(false), false);
  assert.equal(read("true"), true);
  assert.equal(read("false"), false);
  assert.equal(read(undefined), undefined);
  for (const bad of ["", "0", "1", "yes", "no", 0, 1, null]) assert.equal(read(bad), "invalid", `rechaza ${JSON.stringify(bad)}`);
});

test("la tienda por link de acceso carga y pasa las zonas de flete, como la abierta y la mayorista", () => {
  const page = readFileSync(new URL("../app/(catalogo)/tienda/[orgSlug]/acceso/[token]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /loadPublicZones\(context\)/);
  assert.match(page, /zones=\{zones\}/);
});
