import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Regla de las vistas del panel (issues #57, #139/#140 y #143): un módulo que
 * dibuja la cuadrícula de tarjetas (`AdminCardGrid`) tiene que hacerla
 * alcanzable por alguna de las dos vías del kit: si declara `"grid"` entre las
 * vistas, el conmutador recordado por usuario (`useAdminModuleView` +
 * `AdminViewSwitch`); si la usa solo para el ancho compacto (≤980 px la tabla
 * densa se reemplaza por tarjetas), `useAdminNarrowViewport`. Si la cuadrícula
 * no se puede alcanzar por ninguna, este test lo frena.
 */
const MODULES_DIR = join(process.cwd(), "components", "admin", "modules");

test("los módulos con cuadrícula la ofrecen en el conmutador o en la lista compacta", () => {
  const files = readdirSync(MODULES_DIR).filter((file) => file.endsWith(".tsx"));
  const withGrid = files.filter((file) => readFileSync(join(MODULES_DIR, file), "utf8").includes("AdminCardGrid"));

  assert.ok(withGrid.length >= 3, `se esperaban al menos 3 módulos con cuadrícula (hay ${withGrid.length})`);

  for (const file of withGrid) {
    const source = readFileSync(join(MODULES_DIR, file), "utf8");
    if (/useAdminModuleView\(/.test(source) && /["']grid["']/.test(source)) {
      assert.match(source, /AdminViewSwitch/, `${file}: falta el conmutador de vistas`);
    } else {
      // Cuadrícula solo para el ancho compacto (≤980 px): la regla es la del kit.
      assert.match(
        source,
        /useAdminNarrowViewport/,
        `${file}: la cuadrícula no es alcanzable (sin conmutador de cuadrícula ni ancho compacto)`,
      );
    }
  }
});

test("promotoras suma lista y cuadrícula con las mismas acciones (issue #118)", () => {
  const source = readFileSync(join(MODULES_DIR, "PromotorasModule.tsx"), "utf8");
  assert.match(source, /useAdminModuleView\("promotoras", PROMOTORAS_VIEWS\)/, "falta la vista recordada de promotoras");
  assert.match(source, /const PROMOTORAS_VIEWS = \["list", "grid"\]/, "las vistas tienen que ser lista y cuadrícula");
  // Paridad de acciones entre la fila y la tarjeta (las mismas de siempre).
  assert.equal((source.match(/<AdminWhatsappLink phone=\{promoter\.phone\}/g) ?? []).length, 2, "WhatsApp en fila y tarjeta");
  assert.equal((source.match(/mailto:\$\{promoter\.email\}/g) ?? []).length, 2, "correo en fila y tarjeta");
  assert.equal((source.match(/startAvailabilityEdit\(promoter\)/g) ?? []).length, 2, "editar disponibilidad en fila y tarjeta");
  // Búsqueda y filtro compartidos por las dos vistas (mismo `rows`).
  assert.match(source, /view === "grid" \? \(\n\s*<AdminCardGrid/, "la cuadrícula tiene que usar las filas filtradas");
});

/**
 * Eventos (#56/#119): selector único Lista + Tarjetas + Calendario; el tablero
 * permanece fuera y el calendario conserva su URL histórica.
 */
test("eventos ofrece lista, tarjetas y calendario canónicos con entrada por URL", () => {
  const source = readFileSync(join(MODULES_DIR, "EventosModule.tsx"), "utf8");
  assert.match(source, /useAdminModuleView\("eventos", EVENTOS_VIEWS\)/, "falta la vista recordada de eventos");
  assert.match(source, /const EVENTOS_VIEWS = \["list", "grid", "calendar"\]/, "el selector ofrece las tres vistas");
  assert.match(source, /labels=\{\{ grid: "Tarjetas" \}\}/, "el rótulo local usa el selector canónico");
  // Fuera el tablero: ni render ni handler (el kit queda para otros módulos).
  assert.doesNotMatch(source, /useAdminBoardMove|<AdminBoard\b/, "el tablero salió de eventos");
  assert.doesNotMatch(source, /"board"/, "el tablero no puede seguir declarado en eventos");
  // La entrada por URL se conserva junto al selector.
  assert.match(source, /useSearchParams\(\)/, "el calendario tiene que leer ?vista= de la URL");
  assert.match(source, /calendarRequested/, "falta la detección de ?vista=calendario");
  assert.match(source, /<CalendarioModule events=\{operations.data \?\? \[\]\}/, "el calendario reutiliza la ficha del recurso real");
  // Selector fijo: el filtro de estado ya no depende de la vista (no salta al alternar).
  assert.doesNotMatch(source, /view === "list"/, "el filtro de estado no puede quedar solo en lista");
  // Paridad de acciones entre la fila y la tarjeta (las mismas de siempre).
  assert.equal((source.match(/eventActions\(event\)/g) ?? []).length, 2, "acciones en fila y tarjeta");
  // Búsqueda y filtro compartidos por las dos vistas (mismo `rows`): la
  // cuadrícula y el ancho compacto comparten las tarjetas (issue #139).
  assert.match(source, /const eventCards: AdminCardData\[\] = rows\.map\(/, "las tarjetas tienen que salir de las filas filtradas");
  assert.match(source, /cardView \? \(\n\s*<AdminCardGrid label="Eventos" cards=\{eventCards\} \/>/, "la cuadrícula tiene que usar las filas filtradas");
});

/**
 * Conmutador solo con íconos (issue #89): el nombre de la vista vive en
 * `title`/`aria-label` y el estado en `aria-pressed`; el texto visible se
 * retiró. Estas guardas frenan una vuelta atrás silenciosa.
 */
test("el conmutador de vistas va solo con íconos accesibles", () => {
  const source = readFileSync(join(process.cwd(), "components", "admin", "AdminBoard.tsx"), "utf8");
  const switchSource = source.slice(source.indexOf("export function AdminViewSwitch"));
  assert.ok(switchSource.length > 0, "no se encontró AdminViewSwitch");

  assert.match(source, /list: \{ label: "Lista", icon: "menu" \}/);
  assert.match(source, /board: \{ label: "Tablero", icon: "overview" \}/);
  assert.match(source, /grid: \{ label: "Cuadrícula", icon: "overview" \}/);
  assert.match(source, /calendar: \{ label: "Calendario", icon: "calendar" \}/);

  assert.match(switchSource, /aria-pressed={view === option}/, "el estado sigue en aria-pressed");
  assert.match(switchSource, /aria-label={optionLabel}/, "cada botón lleva aria-label con la vista");
  assert.match(switchSource, /title={optionLabel}/, "cada botón lleva title con la vista");
  assert.match(switchSource, /<AdminIcon name={MODULE_VIEW_OPTIONS\[option\]\.icon}/, "el botón dibuja el ícono");
  assert.doesNotMatch(switchSource, /\{MODULE_VIEW_OPTIONS\[option\]\.label\}/, "el nombre ya no se dibuja como texto");
});

/** Alineación de las barras (issue #89): los ítems se anclan abajo y los controles miden igual. */
test("la barra de herramientas ancla los controles a una misma línea", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  assert.match(css, /\.admin-toolbar\s*\{[^}]*align-items:\s*flex-end/, "la barra alinea por la base del control");
  assert.match(css, /\.admin-toolbar \.admin-viewswitch\s*\{[^}]*height:\s*36px/, "el conmutador mide igual que los campos en la barra");
  assert.match(css, /\.admin-toolbar \.admin-btn\s*\{[^}]*min-height:\s*36px/, "los botones miden igual que los campos en la barra");
  assert.match(css, /\.admin-viewswitch-btn\s*\{[^}]*width:\s*30px[^}]*height:\s*30px/, "el botón del conmutador es cuadrado (solo ícono)");
});
