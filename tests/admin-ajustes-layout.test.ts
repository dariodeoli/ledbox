import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Balance de Ajustes (issue #124): la barra de sub-tabs no aporta aire propio
 * —el superior y el lateral los pone `.admin-main-body` (#115)— y solo separa
 * la sección de abajo con el mismo ritmo que `.admin-module-page` (10px). Así
 * las cuatro secciones (Empresa/Correo/Plan/Usuarios) quedan alineadas con su
 * contenido y con el respiro inferior del layout base.
 */
const root = process.cwd();
const css = readFileSync(join(root, "app", "globals.css"), "utf8");
const ajustes = readFileSync(join(root, "components", "admin", "modules", "AjustesModule.tsx"), "utf8");

test("la barra de sub-tabs no agrega aire superior ni lateral", () => {
  const rules = [...css.matchAll(/\.admin-subtabs-bar\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.equal(rules.length, 1, "tiene que haber una sola regla de la barra");
  assert.match(rules[0], /padding: 0 0 10px/, "la barra vuelve a sumar padding arriba o a los costados");
  assert.doesNotMatch(css, /\.admin-subtabs-bar\s*\{[^}]*padding: 12px/, "quedó una regla vieja con 12px");
});

test("el gap a la sección acompaña el ritmo del módulo", () => {
  const module = css.match(/\.admin-module-page\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(module, /display:\s*grid\s*;/, "el módulo conserva su grilla");
  assert.match(module, /gap:\s*10px\s*;/, "cambió el ritmo de los módulos");
  const bar = css.match(/\.admin-subtabs-bar\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(bar, /padding: 0 0 10px/, "el gap de la barra no acompaña el del módulo");
});

test("el respiro inferior lo aporta el layout base, no la barra", () => {
  const body = css.match(/\.admin-main-body\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(body, /padding: 22px 26px 40px/, "el cuerpo de página perdió su respiro inferior");
  assert.doesNotMatch(css, /\.admin-subtabs-bar[^{]*\{[^}]*padding-bottom: 40px/, "la barra no debe inventar respiro propio");
});

test("las cuatro secciones se renderizan después de la barra", () => {
  const bar = ajustes.indexOf('className="admin-subtabs-bar"');
  assert.ok(bar > 0, "falta la barra de sub-tabs");
  for (const section of ["EmpresaModule", "CorreoModule", "PlanModule", "UsuariosModule"]) {
    assert.ok(ajustes.indexOf(`<${section} />`) > bar, `${section} no se renderiza después de la barra`);
  }
});
