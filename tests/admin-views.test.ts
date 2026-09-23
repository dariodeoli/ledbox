import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Regla de las vistas del panel (issue #57): un módulo que dibuja la cuadrícula
 * de tarjetas (`AdminCardGrid`) tiene que ofrecerla en su conmutador y recordar
 * la vista por usuario (`useAdminModuleView`). Si la cuadrícula queda sin opción
 * en el conmutador, el objeto es inalcanzable: este test lo frena.
 */
const MODULES_DIR = join(process.cwd(), "components", "admin", "modules");

test("los módulos con cuadrícula la ofrecen en el conmutador y recuerdan la vista", () => {
  const files = readdirSync(MODULES_DIR).filter((file) => file.endsWith(".tsx"));
  const withGrid = files.filter((file) => readFileSync(join(MODULES_DIR, file), "utf8").includes("AdminCardGrid"));

  assert.ok(withGrid.length >= 3, `se esperaban al menos 3 módulos con cuadrícula (hay ${withGrid.length})`);

  for (const file of withGrid) {
    const source = readFileSync(join(MODULES_DIR, file), "utf8");
    assert.match(
      source,
      /useAdminModuleView\(/,
      `${file}: la vista no se recuerda con useAdminModuleView`,
    );
    assert.match(source, /AdminViewSwitch/, `${file}: falta el conmutador de vistas`);
    assert.match(source, /["']grid["']/, `${file}: la cuadrícula no está declarada entre las vistas`);
  }
});
