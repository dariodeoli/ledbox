import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Selectores de listas largas (issue #108): los `SelectField` que listan
 * **entidades que crecen** (clientes, proveedores, cuentas, presupuestos,
 * eventos, proyectos) pasan a `Combobox` con búsqueda; los **filtros estáticos**
 * (estados, métodos, categorías, plazos) siguen como `SelectField`. Estas
 * guardas verifican, en la fuente, qué componente dibuja cada campo: si alguien
 * vuelve a un select nativo en una lista larga, el test lo frena.
 */
const MODULES = join(process.cwd(), "components", "admin", "modules");
const source = (file: string) => readFileSync(join(MODULES, file), "utf8");

/** ¿Qué componente dibuja el campo con este label? */
function fieldComponent(file: string, label: string): "combobox" | "select" {
  const text = source(file);
  // Los campos inline se rotulan con `ariaLabel`; el resto, con `label`.
  const positions = [`label="${label}"`, `ariaLabel="${label}"`]
    .map((needle) => text.indexOf(needle))
    .filter((index) => index > 0);
  assert.ok(positions.length > 0, `${file}: no se encontró el campo «${label}»`);
  const at = Math.min(...positions);
  const combobox = text.lastIndexOf("<Combobox", at);
  const select = text.lastIndexOf("<SelectField", at);
  return combobox > select ? "combobox" : "select";
}

test("las entidades que crecen se eligen con búsqueda (Combobox)", () => {
  const largas: Array<[string, string]> = [
    ["FinanzasModule.tsx", "Cliente"],
    ["FinanzasModule.tsx", "Presupuesto"],
    ["FinanzasModule.tsx", "Cuenta de tesorería"],
    ["FinanzasModule.tsx", "Cuenta destino"],
    ["FinanzasModule.tsx", "Proyecto"],
    ["FacturacionModule.tsx", "Presupuesto aprobado"],
    ["FacturacionModule.tsx", "Cliente"],
    ["FacturacionModule.tsx", "Proveedor del directorio"],
    ["ProveedoresModule.tsx", "Proveedor"],
    ["ProveedoresModule.tsx", "Evento"],
    ["ConciliacionBancaria.tsx", "Cuenta de tesorería"],
  ];
  for (const [file, label] of largas) {
    assert.equal(fieldComponent(file, label), "combobox", `${file} · «${label}»: lista larga sin búsqueda`);
  }
});

test("los filtros estáticos siguen siendo SelectField", () => {
  const estaticos: Array<[string, string]> = [
    ["FinanzasModule.tsx", "Método"],
    ["FinanzasModule.tsx", "Categoría"],
    ["FinanzasModule.tsx", "Días de plazo"],
    ["FinanzasModule.tsx", "Movimiento"],
    ["FinanzasModule.tsx", "Tipo"],
    ["FacturacionModule.tsx", "Tipo de IVA"],
    ["ProveedoresModule.tsx", "Rubro del trabajo"],
    ["ProveedoresModule.tsx", "Método del anticipo"],
  ];
  for (const [file, label] of estaticos) {
    assert.equal(fieldComponent(file, label), "select", `${file} · «${label}»: es un catálogo cerrado, no necesita búsqueda`);
  }
});

test("los módulos con listas largas usan el Combobox del kit", () => {
  for (const file of ["FinanzasModule.tsx", "FacturacionModule.tsx", "ProveedoresModule.tsx", "ConciliacionBancaria.tsx"]) {
    const text = source(file);
    assert.match(text, /Combobox,/, `${file}: falta el import del Combobox`);
    assert.match(text, /<Combobox\b/, `${file}: no usa el Combobox del kit`);
  }
});
