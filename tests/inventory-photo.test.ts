import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  detectInventoryImageMime,
  INVENTORY_IMAGE_MAX_BYTES,
  isInventoryImageMime,
} from "../lib/admin-types";
import { inventoryImagePath, inventoryImageUrl } from "../lib/server/inventory-images";

/**
 * Foto del ítem de inventario (issue #109): el binario vive en la base
 * (`imageData`/`imageMime`, migración aditiva), se valida por magic bytes y se
 * sirve público por UUID con caché inmutable. El `imageUrl` efectivo —el mismo
 * contrato que consume el portal de #107— es la URL manual o, si no, la subida.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("la firma de la foto sale del contenido (JPG, PNG o WebP; nada más)", () => {
  const ascii = (text: string) => new Uint8Array([...text].map((character) => character.charCodeAt(0)));
  const webp = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);
  assert.equal(detectInventoryImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectInventoryImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectInventoryImageMime(webp), "image/webp");
  // Un PDF o un HTML renombrado a .png se rechazan por contenido.
  assert.equal(detectInventoryImageMime(ascii("%PDF-1.7")), null);
  assert.equal(detectInventoryImageMime(ascii("<html>hola</html>")), null);
  assert.equal(INVENTORY_IMAGE_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(isInventoryImageMime("image/webp"), true);
  assert.equal(isInventoryImageMime("application/pdf"), false);
  assert.equal(isInventoryImageMime(null), false);
});

test("la URL efectiva de la foto: la manual manda; si no, la subida con su versión", () => {
  assert.equal(inventoryImageUrl({ id: "inv_1", imageUrl: "/assets/products/x.png", imageMime: "image/webp" }), "/assets/products/x.png");
  assert.equal(
    inventoryImageUrl({ id: "inv_1", imageUrl: null, imageMime: "image/webp", updatedAt: "2026-10-01T10:00:00.000Z" }),
    "/api/inventory-images/inv_1?v=2026-10-01T10%3A00%3A00.000Z",
  );
  assert.equal(inventoryImageUrl({ id: "inv_1", imageUrl: null, imageMime: null }), null);
  assert.equal(inventoryImageUrl({ id: "inv_1", imageUrl: "", imageMime: null }), null);
  assert.equal(inventoryImagePath("inv_1"), "/api/inventory-images/inv_1");
});

test("la migración de la foto es aditiva, idempotente y sin datos de arranque", () => {
  const sql = repoFile("prisma/migrations/202610010001_inventory_item_photo/migration.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "imageData" BYTEA/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "imageMime" TEXT/);
  assert.equal(/\bINSERT\b/i.test(sql), false);
  const schema = repoFile("prisma/schema.prisma");
  assert.match(schema, /model InventoryItem \{[\s\S]*?imageData\s+Bytes\?/);
  assert.match(schema, /model InventoryItem \{[\s\S]*?imageMime\s+String\?/);
});

test("el endpoint público sirve solo imágenes y con caché inmutable", () => {
  const route = repoFile("app/api/inventory-images/[id]/route.ts");
  assert.match(route, /isInventoryImageMime\(item\.imageMime\)/, "tiene que revalidar el MIME guardado");
  assert.match(route, /"Cache-Control": "public, max-age=31536000, immutable"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.equal(/requireAdminContext/.test(route), false, "la foto es pública por UUID: sin sesión");

  const upload = repoFile("app/api/admin/inventory/[id]/image/route.ts");
  assert.match(upload, /requireAdminContext\("inventory\.write"\)/);
  assert.match(upload, /detectInventoryImageMime\(data\)/, "el tipo se decide por magic bytes");
  assert.match(upload, /INVENTORY_IMAGE_MAX_BYTES/, "tope de 2 MB en el servidor");
  assert.match(upload, /recordAudit\(/, "la subida queda auditada");
});

test("las listas exponen la URL efectiva y nunca el binario", () => {
  const list = repoFile("app/api/admin/inventory/route.ts");
  assert.match(list, /omit: \{ imageData: true \}/, "la lista no puede traer el binario");
  assert.match(list, /imageUrl: inventoryImageUrl\(item\)/);
  const resources = repoFile("app/api/admin/resources/route.ts");
  assert.match(resources, /omit: \{ imageData: true \}/);
  assert.match(resources, /imageUrl: inventoryImageUrl\(item\)/);
});

test("el alta suma la categoría buscable/creable y la subida con vista previa", () => {
  const module = repoFile("components/admin/modules/InventarioModule.tsx");
  assert.match(module, /<Combobox/, "la categoría usa el combobox del kit");
  assert.match(module, /Crear categoría «\$\{query\}»/);
  assert.match(module, /categoryChoices/, "las opciones salen de las categorías de la empresa");
  assert.match(module, /<AdminDialogSection title="Ítem">/, "los datos del ítem van en su sección de la ventana");
  assert.match(module, /admin-form-group--photo/, "la foto va en su propia fila");
  assert.match(module, /<AttachmentInput/);
  assert.match(module, /prepareInventoryPhoto/, "la foto se comprime en el navegador");
  assert.match(module, /adminApiUpload\(`\/api\/admin\/inventory\/\$\{createdId\}\/image`/, "la subida es multipart al endpoint del ítem");
  assert.match(module, /Quitar foto/, "falta el quitar foto del alta");
});
