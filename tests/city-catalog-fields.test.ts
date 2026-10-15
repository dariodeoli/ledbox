import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseClientFields } from "../app/api/admin/clients/client-fields";
import { catalogCity } from "../lib/field-rules";
import { parseOrgProfileUpdate, readOrgProfile } from "../lib/org-profile";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("ciudades nuevas de clientes sólo de catálogo; departamento se completa al elegir", () => {
  const result = parseClientFields({ city: "asuncion" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, { city: "Asunción", department: catalogCity("Asunción")!.departamento });
  assert.equal(parseClientFields({ city: "AsunciónX" }).ok, false);
  assert.equal(parseClientFields({ city: "Ciudad desconocida" }).ok, false);
  assert.deepEqual(parseClientFields({ city: null }), { ok: true, data: { city: null } });
});

test("edición preserva ciudad histórica sin convertirla; no permite agregar otra ajena", () => {
  assert.deepEqual(parseClientFields({ city: "Ciudad histórica", notes: "Otra nota" }, "Ciudad histórica"), { ok: true, data: { city: "Ciudad histórica", notes: "Otra nota" } });
  assert.equal(parseClientFields({ city: "Nueva histórica" }, "Ciudad histórica").ok, false);
  assert.deepEqual(parseClientFields({ city: "Asuncion" }, "Asuncion"), { ok: true, data: { city: "Asuncion" } }, "no convierte aliases guardados al editar otro campo");
  assert.match(read("app/api/admin/clients/[id]/route.ts"), /parseClientFields\(body, before\.city\)/);
});

test("perfil de empresa valida sólo escritura de ciudad nueva, conserva lectura histórica", () => {
  const old = readOrgProfile({ location: { city: "Ciudad histórica" }, conditions: "Condiciones guardadas" });
  assert.equal(old.location.city, "Ciudad histórica");
  const unchanged = parseOrgProfileUpdate({ ...old, conditions: "Condiciones editadas" }, old.location.city);
  assert.equal(unchanged.ok, true);
  if (unchanged.ok) assert.equal(unchanged.value.location.city, old.location.city);
  assert.equal(parseOrgProfileUpdate({ ...old, location: { ...old.location, city: "AsunciónX" } }, old.location.city).ok, false);
  const selected = parseOrgProfileUpdate({ location: { city: "Asuncion" } });
  assert.equal(selected.ok, true); if (selected.ok) assert.equal(selected.value.location.city, "Asunción");
  assert.equal(parseOrgProfileUpdate({ location: { city: null } }).ok, true);
  assert.match(read("lib/server/org-presentation.ts"), /parseOrgProfileUpdate\(profileBody, before\.location\.city\)/);
});

test("un solo CityField cerrado por defecto en empresa, cliente, evento, tienda y carga", () => {
  const field = read("components/admin/AdminFields.tsx");
  assert.match(field, /catalogOnly = true/);
  assert.match(field, /Valor guardado anteriormente/);
  for (const file of ["components/admin/modules/EmpresaPerfil.tsx", "components/admin/modules/ClientQuickForm.tsx", "components/admin/modules/EventQuickForm.tsx", "components/catalog-public/CartDrawer.tsx", "components/admin/AdminCargaIa.tsx"]) {
    const source = read(file);
    assert.match(source, /<CityField/);
    assert.ok(!/<TextField\s+label="Ciudad"/.test(source), file);
    assert.ok(!/catalogOnly=\{false\}/.test(source), file);
  }
});


test("CityField real es un selector accesible y conserva el valor histórico visible", async () => {
  const { default: React, createElement } = await import("react");
  Object.assign(globalThis, { React });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { CityField } = await import("../components/admin/AdminFields");
  for (const value of ["Asunción", "Ciudad histórica"]) {
    const html = renderToStaticMarkup(createElement(CityField, { label: "Ciudad", value, onChange() {}, onSelect() {} }));
    assert.match(html, /role="combobox"/);
    assert.ok(html.includes(`value="${value}"`));
    assert.ok(!html.includes("Crear nuevo"));
  }
});
