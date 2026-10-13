import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Cajas de imagen uniformes del inventario (issue #98): lista, tarjetas y
 * detalle usan una caja cuadrada fija y la foto entra completa con `contain`
 * (vertical, horizontal o cuadrada). La imagen se ancla a la caja (`inset: 0`)
 * porque dentro de un grid de fila automática `height: 100%` no resuelve y la
 * foto vertical se desborda y se recorta. La vista previa del alta usa la misma
 * caja: si la URL no carga, cae al ícono (nunca un cuadro roto).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("la caja de la imagen ancla la foto y la contiene entera", () => {
  const css = repoFile("app/globals.css");
  assert.match(css, /\.admin-item-thumb \{[^}]*position:\s*relative;[^}]*overflow:\s*hidden;/, "la caja necesita position: relative y overflow: hidden");
  assert.match(
    css,
    /\.admin-item-thumb img \{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/,
    "la imagen necesita estar anclada a la caja (inset: 0) y usar contain",
  );
  // La caja no puede quedar a merced de la relación de la foto.
  assert.equal(/\.admin-item-thumb img \{[^}]*height:\s*auto/.test(css), false, "la imagen no puede quedar con alto automático");
});

test("el módulo usa la caja fija compartida en lista, tarjetas y detalle", () => {
  const box = repoFile("components/admin/AdminImageBox.tsx");
  assert.match(box, /style=\{\{ width: size, height: size \}\}/, "la caja tiene que ser fija e igual para todos");
  assert.match(box, /onError=\{\(\) => setFailed\(true\)\}/, "falta el fallback al ícono");
  assert.match(box, /<AdminIcon name=\{icon\}/, "sin imagen (o si falla) dibuja el ícono");
  const module = inventoryModuleSource();
  assert.match(module, /function InventoryThumb\(\{ item, size = 26 \}/, "falta la caja base de 26 px");
  assert.match(module, /<AdminImageBox imageUrl=\{item\.imageUrl\} size=\{size\} \/>/, "la miniatura delega en la caja compartida");
  assert.match(module, /identity\(item, 36\)/, "las filas usan una caja de 36 px");
  assert.match(module, /identity\(item, 48\)/, "las tarjetas usan una caja de 48 px");
  assert.match(module, /<InventoryThumb item=\{item\} size=\{96\} \/>/, "la ficha usa una caja de 96 px");
});

test("la vista previa del alta usa la misma caja y valida la URL antes de mostrarla", () => {
  const module = inventoryModuleSource();
  assert.match(module, /admin-image-preview/, "la vista previa usa la caja canónica de imagen");
  assert.match(
    module,
    /inventoryImageValid\(form\.imageUrl\.trim\(\)\) \? form\.imageUrl\.trim\(\) : null/,
    "la vista previa solo dibuja URLs válidas (el resto cae al ícono)",
  );
});
