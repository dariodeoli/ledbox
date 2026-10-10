import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Páginas legales, de estado y 404 de EventOS (issue #168): privacidad propia
 * —separada del sitio de LedBox y sin `PENDIENTE-DUEÑO`—, términos, estado con
 * el health real, 404 con identidad y recuperación, pie del producto con los
 * enlaces y URLs limpias servidas por host.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const PRIVACY = "app/(product)/producto/privacidad/page.tsx";
const TERMS = "app/(product)/producto/terminos/page.tsx";
const STATUS = "app/(product)/producto/status/page.tsx";

test("las páginas de EventOS existen y usan la piel del producto", () => {
  for (const page of [PRIVACY, TERMS, STATUS]) {
    assert.ok(existsSync(join(root, page)), `falta ${page}`);
    const source = read(page);
    assert.match(source, /ProductoShell/, `${page} no usa la piel de EventOS`);
    assert.doesNotMatch(source, /PublicNav|PublicFooter/, `${page} no debe usar la nav/pie del sitio de LedBox`);
  }
});

test("la privacidad es de EventOS, completa y sin marcadores", () => {
  const source = read(PRIVACY);
  const legal = read("lib/legal.ts");
  assert.match(source, /canonical: `\$\{publicConfig\.productUrl\}\/privacidad`/, "la canónica es la de EventOS");
  assert.match(legal, /\+595 982 029 217/, "el canal de contacto es el WhatsApp publicado");
  for (const copy of [
    "responsable",
    "encargado",
    "base legal",
    "Minimización y conservación",
    "Destinatarios y transferencias",
    "Seguridad",
    "Tus derechos",
    "30 días corridos",
    "Agencia Nacional de Protección de Datos Personales",
    "MITIC",
    "Ley 7593/2025",
  ]) {
    assert.ok(source.includes(copy), `falta en la privacidad: ${copy}`);
  }
  for (const right of ["Acceso", "Rectificación", "Supresión", "Oposición", "Portabilidad", "Revocación del consentimiento"]) {
    assert.ok(source.includes(right), `falta el derecho de ${right}`);
  }
  assert.doesNotMatch(source, /PENDIENTE-DUEÑO/, "no quedan marcadores de dueño en la página");
  assert.doesNotMatch(legal, /PENDIENTE-DUEÑO/, "no quedan marcadores de dueño en los datos legales");
  assert.match(legal, /NEXT_PUBLIC_EVENTOS_LEGAL_REGISTRATION/, "los datos registrales se completan en un solo lugar");
  assert.match(source, /EVENTOS_LEGAL\.registration/, "la página no inventa los datos registrales");
});

test("los términos cubren el servicio y no inventan precios", () => {
  const source = read(TERMS);
  assert.match(source, /canonical: `\$\{publicConfig\.productUrl\}\/terminos`/, "la canónica es la de EventOS");
  for (const copy of [
    "Objeto y aceptación",
    "Cuenta, acceso y roles",
    "Uso aceptable",
    "Planes, límites y pagos",
    "Datos de la empresa",
    "Disponibilidad, mantenimiento y soporte",
    "Propiedad intelectual",
    "Responsabilidad",
    "Cambios y ley aplicable",
  ]) {
    assert.ok(source.includes(copy), `falta en los términos: ${copy}`);
  }
  assert.match(source, /propuesta comercial aceptada/, "los planes y precios remiten a la propuesta, sin inventar valores");
  assert.match(source, /política de privacidad<\/a>/, "los términos enlazan la privacidad");
});

test("el estado consulta el health real y admite el fallo", () => {
  const page = read(STATUS);
  const live = read("components/producto/StatusLive.tsx");
  assert.match(page, /canonical: `\$\{publicConfig\.productUrl\}\/status`/, "la canónica es la de EventOS");
  assert.match(page, /StatusLive/, "la página muestra el estado en vivo");
  assert.match(live, /fetch\("\/api\/health", \{ cache: "no-store" \}\)/, "consulta el health real");
  for (const state of ["operativo", "degradado", "sin-conexion"]) {
    assert.ok(live.includes(state), `falta el estado ${state}`);
  }
  assert.match(live, /CHECK_INTERVAL_MS = 60_000/, "la verificación se repite sola");
  assert.doesNotMatch(page, /99,9|disponibilidad del 100/i, "no se prometen métricas inventadas");
});

test("el pie del producto enlaza privacidad, términos, estado, soporte y empresa", () => {
  const footer = read("components/app-footer.tsx");
  const landing = read("app/(product)/producto/page.tsx");
  assert.match(footer, /variant === "product"/, "falta la variante del pie de EventOS");
  for (const link of ['${publicConfig.productUrl}/privacidad', '${publicConfig.productUrl}/terminos', '${publicConfig.productUrl}/status']) {
    assert.ok(footer.includes(link), `el pie no enlaza ${link}`);
  }
  assert.match(footer, /etiqueta: "Soporte"/, "falta el enlace de soporte");
  assert.match(footer, /Operado por LedBox Paraguay/, "falta la empresa responsable");
  assert.match(read("app/layout.tsx"), /<AppFooter variant="product" \/>/, "el layout raíz usa el pie del producto");
  assert.doesNotMatch(landing, /<AppFooter/, "la landing no duplica el pie global");
});

test("la 404 de EventOS tiene identidad y rutas de recuperación", () => {
  assert.ok(existsSync(join(root, "components/producto/EventosNotFound.tsx")), "falta la 404 de EventOS");
  const notFound = read("components/producto/EventosNotFound.tsx");
  assert.match(notFound, /ProductoShell/, "la 404 no usa la piel de EventOS");
  assert.match(notFound, /producto-error-code/, "falta el código 404");
  for (const copy of ["Volver al inicio", "Abrir la demo", "Ingresar al panel", "Privacidad", "Términos", "Estado", "Soporte", "Sitio de LedBox"]) {
    assert.ok(notFound.includes(copy), `la 404 no ofrece: ${copy}`);
  }
  const rootNotFound = read("app/not-found.tsx");
  assert.match(rootNotFound, /EventosNotFound/, "la 404 raíz no elige la de EventOS");
  assert.match(rootNotFound, /headers\(\)/, "la 404 raíz necesita el host/path de la request");
  assert.match(rootNotFound, /kind === "eventos"/, "la 404 raíz no distingue el host de EventOS");
  assert.match(rootNotFound, /pathname\.startsWith\("\/producto\/"\)/, "la 404 raíz no cubre la vista previa en /producto");
});

test("los hosts sirven las URLs limpias y el sitemap de EventOS las lista", () => {
  const middleware = read("middleware.ts");
  for (const [clean, internal] of [
    ["/privacidad", "/producto/privacidad"],
    ["/terminos", "/producto/terminos"],
    ["/status", "/producto/status"],
  ]) {
    assert.ok(middleware.includes(`"${clean}": "${internal}"`), `falta el rewrite ${clean} → ${internal}`);
  }
  assert.match(middleware, /PRODUCT_PAGE_REWRITES\[pathname\]/, "el host del producto no aplica los rewrites");
  assert.match(middleware, /pathname\.startsWith\("\/producto\/"\)/, "el host público no redirige el prefijo interno");
  const sitemap = read("app/sitemap.ts");
  for (const page of ["/privacidad", "/terminos", "/status"]) {
    assert.ok(sitemap.includes(`\${profile.siteUrl}${page}`), `el sitemap de EventOS no lista ${page}`);
  }
});
