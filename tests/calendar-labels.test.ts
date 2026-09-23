import assert from "node:assert/strict";
import { test } from "node:test";
import { placeLabel } from "../lib/server/notifications";

/**
 * Lugar del marcador del calendario (issue #68): «Lugar» (el venue) y «Ciudad»
 * son campos separados, y el lugar se escribe libre. La ciudad suma cuando
 * aporta; cuando el lugar ya la nombra, no se repite.
 */

test("el lugar suma la ciudad solo cuando no está nombrada", () => {
  assert.equal(placeLabel("Centro de Convenciones", "Asunción"), "Centro de Convenciones · Asunción");
  assert.equal(placeLabel("Paseo La Galería, Asunción", "Asunción"), "Paseo La Galería, Asunción");
  assert.equal(placeLabel("Costanera de Encarnación", "encarnacion"), "Costanera de Encarnación");
  assert.equal(placeLabel("Predio Ferial de Mariano Roque Alonso", "MARIANO ROQUE ALONSO"), "Predio Ferial de Mariano Roque Alonso");
});

test("sin uno de los dos datos queda el otro; sin ninguno, null", () => {
  assert.equal(placeLabel(null, "Luque"), "Luque");
  assert.equal(placeLabel("", "Luque"), "Luque");
  assert.equal(placeLabel("Predio Ferial", null), "Predio Ferial");
  assert.equal(placeLabel("Predio Ferial", ""), "Predio Ferial");
  assert.equal(placeLabel("", ""), null);
  assert.equal(placeLabel(null, null), null);
  assert.equal(placeLabel(undefined, undefined), null);
});

test("los espacios de más no ensucian el texto", () => {
  assert.equal(placeLabel("  Centro de Convenciones  ", "  Asunción  "), "Centro de Convenciones · Asunción");
  assert.equal(placeLabel("   ", "Luque"), "Luque");
});
