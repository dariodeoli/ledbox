import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Ítem completo editable + «visible en la web» (issue #111): el formulario de
 * edición cubre datos, estado, costos, notas, foto y precios; el endpoint de
 * inventario suma el kind `item` (aditivo y validado) y la foto se cambia o se
 * quita. La cantidad queda afuera (va en #112).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("la migración de «visible en la web» es aditiva y nada se publica solo", () => {
  const sql = repoFile("prisma/migrations/202610010003_inventory_visible_on_web/migration.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "visibleOnWeb" BOOLEAN NOT NULL DEFAULT false/);
  assert.equal(/\bINSERT\b/i.test(sql), false);
  const schema = repoFile("prisma/schema.prisma");
  assert.match(schema, /model InventoryItem \{[\s\S]*?visibleOnWeb\s+Boolean\s+@default\(false\)/);
  const types = repoFile("lib/admin-types.ts");
  assert.match(types, /visibleOnWeb: boolean/, "falta en AdminInventoryRow");
  assert.match(types, /imageUploaded: boolean/, "la fila tiene que decir si la foto es subida");
});

test("el endpoint suma la edición del ítem sin romper los contratos", () => {
  const route = repoFile("app/api/admin/inventory/route.ts");
  assert.match(route, /kind === "item"/);
  assert.match(route, /function readInventoryItemUpdate/);
  assert.match(route, /INVENTORY_ITEM_FIELDS/);
  // La cantidad no se toca acá (issue #112): no está entre los campos editables.
  assert.equal(
    /type InventoryItemUpdate = Partial<\{[^}]*quantity/m.test(route),
    false,
    "la cantidad no se edita en este alcance",
  );
  assert.equal(/data\.quantity/.test(route), false, "la cantidad no se edita en este alcance");
  const image = repoFile("app/api/admin/inventory/[id]/image/route.ts");
  assert.match(image, /export async function DELETE/, "la foto tiene que poder quitarse");
  assert.match(image, /imageData: null, imageMime: null/);
  const list = repoFile("app/api/admin/inventory/route.ts");
  assert.match(list, /imageUploaded: Boolean\(item\.imageMime\)/);
});

test("el formulario de edición cubre el ítem completo", () => {
  const module = repoFile("components/admin/modules/InventarioModule.tsx");
  assert.match(module, /title=\{`Editar ítem · \$\{editForm\.name \|\| editItem\.name\}`\}/);
  assert.match(module, /onSubmit=\{\(event\) => void submitEditItem\(event\)\}/);
  assert.match(module, /<AdminDialog[\s\S]{0,200}title=\{`Editar ítem/, "la edición vive en una ventana (AdminDialog)");
  for (const label of [
    "Artículo",
    "Categoría",
    "Tipo",
    "Estado",
    "Visible en la web",
    "Imagen (URL)",
    "Subir foto",
    "Reposición",
    "Costo diario",
    "Notas internas",
    "Precio normal",
    "Precio desde esos días",
    "Piso de venta",
  ]) {
    assert.ok(module.includes(`label="${label}"`), `falta el campo «${label}» en la edición`);
  }
  // La foto se comparte con el alta y se puede cambiar o quitar.
  assert.match(module, /function PhotoFields/);
  assert.match(module, /adminApiUpload\(`\/api\/admin\/inventory\/\$\{editItem\.id\}\/image`/);
  assert.match(module, /adminSend\(`\/api\/admin\/inventory\/\$\{editItem\.id\}\/image`, \{\}, "DELETE"\)/);
  assert.match(module, /setEditPhotoRemoved/);
  // El alta también trae el toggle y el detalle lo muestra.
  assert.match(module, /visibleOnWeb: form\.visibleOnWeb/);
  assert.match(module, /selected\.visibleOnWeb \? "Visible en la web" : "No visible en la web"/);
});
