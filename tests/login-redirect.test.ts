import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PANEL_HOME } from "../lib/admin-routes";

/**
 * Issue #134: con sesión iniciada, `/login` va directo al panel; la raíz del
 * host del panel y el retorno de Google usan la misma home; el PIN no se
 * saltea (una sesión bloqueada cuenta como sesión y el shell dibuja el
 * desbloqueo).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("la home canónica del panel es una sola constante", () => {
  assert.equal(PANEL_HOME, "/dashboard");
  assert.match(repoFile("lib/admin-routes.ts"), /export const PANEL_HOME = "\/dashboard"/);
});

test("con sesión, /login redirige al panel antes de mostrar el formulario", () => {
  const page = repoFile("app/(admin)/login/page.tsx");
  assert.match(page, /if \(await sesionDePanelDisponible\(\)\) redirect\(PANEL_HOME\)/);
  assert.ok(
    page.indexOf("sesionDePanelDisponible") < page.indexOf("<AdminLoginForm"),
    "la sesión se mira antes del formulario",
  );
  assert.match(page, /export const dynamic = "force-dynamic"/, "el login siempre mira la cookie");
});

test("la sesión de panel usa la misma resolución que el layout (PIN incluido)", () => {
  const session = repoFile("lib/server/admin-session.ts");
  assert.match(session, /export async function sesionDePanelDisponible/);
  assert.match(session, /getAuthenticatedAdmin\(\)/);
  assert.match(session, /requireAdminContext\(undefined, \{ allowLocked: true \}\)/, "una sesión bloqueada cuenta: el shell dibuja el PIN");
});

test("la raíz del host del panel y el retorno de Google usan la misma home", () => {
  const middleware = repoFile("middleware.ts");
  assert.match(middleware, /url\.pathname = PANEL_HOME/);
  assert.doesNotMatch(middleware, /url\.pathname = "\/dashboard"/);
  const callback = repoFile("app/api/auth/callback/google/route.ts");
  assert.match(callback, /PANEL_HOME/);
  assert.doesNotMatch(callback, /\/dashboard/);
  const form = repoFile("components/admin/AdminLoginForm.tsx");
  assert.match(form, /router\.replace\(next\)/);
  assert.doesNotMatch(form, /router\.replace\("\/dashboard"\)/);
});
