import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeAltaInput, orgSlugError, suggestOrgSlug, validateAltaInput } from "../lib/platform/alta-empresa";

test("el slug se sugiere desde el nombre: sin tildes, minúsculas y guiones", () => {
  assert.equal(suggestOrgSlug("La Vajilla Alquileres"), "la-vajilla-alquileres");
  assert.equal(suggestOrgSlug("  Eventos Ñandú & Cía.  "), "eventos-nandu-y-cia");
  assert.equal(suggestOrgSlug("!!!"), "");
  const long = suggestOrgSlug("a".repeat(30) + " " + "b".repeat(30));
  assert.ok(long.length <= 40 && !long.endsWith("-"));
});

test("el slug se valida: formato, largo y reservados (incluida la demo)", () => {
  assert.equal(orgSlugError("la-vajilla"), null);
  for (const bad of ["ab", "La-Vajilla", "-vajilla", "vajilla-", "va--jilla", "va jilla", "a".repeat(41)]) {
    assert.ok(orgSlugError(bad), `${bad} debe rechazarse`);
  }
  for (const reserved of ["demo", "admin", "superadmin", "api", "app"]) {
    assert.match(orgSlugError(reserved) ?? "", /reservado/, reserved);
  }
});

test("la validación del alta pide nombre, slug, plan y al menos un invitado con correo y rol válidos", () => {
  const ok = normalizeAltaInput({
    name: "  La   Vajilla ", slug: " LA-VAJILLA ", planCode: "inicial",
    inviteeEmail: [" Uno@Example.COM ", "dos@example.com"], inviteeRole: ["owner", "ADMIN"],
  });
  assert.deepEqual(ok, {
    name: "La Vajilla", slug: "la-vajilla", planCode: "inicial",
    invitees: [{ email: "uno@example.com", role: "OWNER" }, { email: "dos@example.com", role: "ADMIN" }],
  });
  assert.deepEqual(validateAltaInput(ok), {});
  const bad = validateAltaInput(normalizeAltaInput({ name: "", slug: "x", planCode: "", inviteeEmail: [], inviteeRole: [] }));
  assert.deepEqual(Object.keys(bad).sort(), ["invitees", "name", "planCode", "slug"]);
  const rows = validateAltaInput(normalizeAltaInput({
    name: "Ok", slug: "ok-slug", planCode: "p",
    inviteeEmail: ["no-es-correo", "", "a@example.com", "a@example.com", "b@example.com"],
    inviteeRole: ["ADMIN", "ADMIN", "ADMIN", "ADMIN", "SUPERUSER"],
  })).inviteeRows ?? {};
  assert.deepEqual(Object.keys(rows).map(Number), [0, 1, 3, 4], "correo malo, fila vacía, repetido y rol inválido");
  const many = Array.from({ length: 11 }, (_, i) => `p${i}@example.com`);
  assert.match(validateAltaInput(normalizeAltaInput({ name: "Ok", slug: "ok-slug", planCode: "p", inviteeEmail: many, inviteeRole: many.map(() => "ADMIN") })).invitees ?? "", /hasta 10/);
  assert.equal(normalizeAltaInput({ name: 5, slug: null }).invitees.length, 0, "tipos raros no rompen");
});

test("el formulario de cliente solo importa la parte pura (nunca guard, base ni queries)", () => {
  const source = readFileSync(join(process.cwd(), "components", "platform", "NuevaEmpresaForm.tsx"), "utf8");
  assert.doesNotMatch(source, /platform\/(guard|queries)|server\/db|alta-empresa-server/);
});

test("la alta no crea cuentas ni contraseñas y el link nunca vuelve al navegador", () => {
  const server = readFileSync(join(process.cwd(), "lib", "platform", "alta-empresa-server.ts"), "utf8");
  assert.doesNotMatch(server, /adminUser\.(create|upsert)|hashPassword|passwordHash/);
  const actions = readFileSync(join(process.cwd(), "app", "(superadmin)", "superadmin", "empresas", "acciones.ts"), "utf8");
  assert.doesNotMatch(actions, /token|invitationAcceptUrl/i);
});

test("Mi perfil trae el selector «Empresa predeterminada» y la API valida la elección", () => {
  const perfil = readFileSync(join(process.cwd(), "components", "admin", "modules", "PerfilModule.tsx"), "utf8");
  assert.match(perfil, /Empresa predeterminada/);
  assert.match(perfil, /\/api\/admin\/profile\/default-organization/);
  const route = readFileSync(join(process.cwd(), "app", "api", "admin", "profile", "default-organization", "route.ts"), "utf8");
  assert.match(route, /setDefaultOrganization/);
  const tenancy = readFileSync(join(process.cwd(), "lib", "server", "tenancy.ts"), "utf8");
  assert.match(tenancy, /slug: \{ not: DEMO_ORGANIZATION_SLUG \}/, "la demo nunca es elegible");
});
