import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Guarda estructural (no ejecuta la ruta): la rama `purchase` convierte la colisión de código en 409.
test("«Registrar compra» captura la colisión de código de unidad como 409", () => {
  const route = read("app/api/admin/inventory/route.ts");
  const branch = route.slice(route.indexOf('if (kind === "purchase")'), route.indexOf('if (kind === "prices")'));
  assert.match(branch, /catch \(error\)[\s\S]*isUniqueConstraintError\(error\)[\s\S]*jsonError\([^)]*409\)/);
});

test("el seed deja categoryId y el texto espejo con resolveInventoryCategory", () => {
  const seed = read("prisma/seed.ts");
  assert.match(seed, /resolveInventoryCategory\(tx, organization\.id/);
  assert.match(seed, /categoryWriteData\(resolved\)/, "el helper deja categoryId y el texto espejo");
});
