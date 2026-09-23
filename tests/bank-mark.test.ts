import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { colorDeBanco, inicialesDeBanco, normalizarBanco, sugerenciasDeBanco } from "owncoding-ui";
import { bankKey, bankMark, bankSuggestions } from "../lib/bank-mark";

/**
 * Catálogo y marcas de bancos (issue #47, paso 4 de docs/ADOPCION-OWNCODING-UI.md):
 * la fuente es `owncoding-ui` — `BANCOS_PARAGUAY`, `normalizarBanco`,
 * `logoDeBanco` y `sugerenciasDeBanco` —, no una lista local. Los tests cubren
 * los contratos que consumen Tesorería, Datos de pago, el portal y el imprimible;
 * la aserción de fuente falla si alguien vuelve a escribir el catálogo en el repo.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("las sugerencias salen del catálogo de la librería", () => {
  assert.ok(bankSuggestions("").length >= 20, "el catálogo del BCP llega completo");
  assert.deepEqual(bankSuggestions("cont"), sugerenciasDeBanco("cont"));
  assert.ok(bankSuggestions("itau").includes("Banco Itaú Paraguay"));
  assert.ok(bankSuggestions("").includes("Bancop"));
});

test("las sugerencias son una copia: nadie muta el catálogo compartido", () => {
  const first = bankSuggestions("");
  first.length = 0;
  assert.ok(bankSuggestions("").length >= 20);
});

test("banco del catálogo: etiqueta canónica y monograma de la librería", () => {
  const mark = bankMark("banco continental");
  assert.equal(mark?.key, normalizarBanco("banco continental"));
  assert.equal(mark?.label, "Banco Continental");
  assert.equal(mark?.asset, null);
  assert.equal(mark?.initials, inicialesDeBanco("banco continental"));
  assert.equal(mark?.color, colorDeBanco("banco continental"));
});

test("los alias y el tipeo suelto se resuelven con el registro de la librería", () => {
  assert.equal(bankMark("itau")?.label, "Banco Itaú Paraguay");
  assert.equal(bankMark("ITAU")?.label, "Banco Itaú Paraguay");
  assert.equal(bankMark("banco continental")?.label, "Banco Continental");
});

test("si el nombre canónico viene en minúsculas, se respeta el tipeo capitalizado", () => {
  assert.equal(bankMark("Ueno Bank")?.label, "Ueno Bank");
});

test("asset versionado: Ueno Bank usa el svg del repo", () => {
  assert.equal(bankMark("Ueno Bank")?.asset, "/assets/banks/ueno.svg");
  assert.equal(bankMark("ueno")?.asset, "/assets/banks/ueno.svg");
});

test("fuera del catálogo: monograma estable del fallback de la librería", () => {
  const mark = bankMark("Banco Zeta");
  assert.equal(mark?.label, "Banco Zeta");
  assert.equal(mark?.asset, null);
  assert.equal(mark?.initials, inicialesDeBanco("Banco Zeta"));
  assert.equal(mark?.color, colorDeBanco("Banco Zeta"));
  assert.deepEqual(bankMark("Banco Zeta"), mark);
  // Nombre corto que el registro de la librería no lista como alias: cae al
  // monograma genérico (el campo lo sugiere como «Banco Continental»).
  const corto = bankMark("continental");
  assert.equal(corto?.label, "continental");
  assert.equal(corto?.asset, null);
  assert.ok(bankSuggestions("continental").includes("Banco Continental"));
});

test("sin nombre de banco no hay marca", () => {
  assert.equal(bankMark(""), null);
  assert.equal(bankMark("   "), null);
  assert.equal(bankMark(null), null);
  assert.equal(bankMark(undefined), null);
});

test("bankKey es la normalización de la librería", () => {
  assert.equal(bankKey("Itaú"), normalizarBanco("Itaú"));
  assert.equal(bankKey(null), "");
});

test("lib/bank-mark.ts no guarda listas locales de bancos", () => {
  const source = repoFile("lib/bank-mark.ts");
  assert.match(source, /from "owncoding-ui"/);
  assert.doesNotMatch(source, /BANK_REGISTRY|MONOGRAM_COLORS|STOP_WORDS/);
});

test("el campo Banco de Tesorería y de Datos de pago usa el catálogo", () => {
  for (const file of ["components/admin/modules/FinanzasModule.tsx", "components/admin/modules/PresupuestosModule.tsx"]) {
    const source = repoFile(file);
    assert.match(source, /bankSuggestions\(/, `${file}: el campo Banco tiene que sugerir el catálogo`);
    assert.match(source, /<datalist/, `${file}: el campo Banco necesita su datalist del catálogo`);
  }
});
