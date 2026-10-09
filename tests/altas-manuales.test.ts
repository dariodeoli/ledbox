import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Altas manuales (issue #131, auditoría #123 §2): menos campos a la vista,
 * errores es-PY con las reglas del kit y ningún control muerto. Cada alta tiene
 * su guarda: inventario (precios/foto plegados + SKU), evento (cliente y fin),
 * cliente (nombre), proveedor (estado y condiciones) y promotora (correo).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("inventario: «Precios» y «Foto y web» plegados, SKU en «Más datos» y nombre es-PY", () => {
  const module = repoFile("components/admin/modules/InventarioModule.tsx");
  assert.match(module, /<AdminDisclosure title="Más datos" hint="SKU">/, "el SKU vive en Más datos");
  assert.match(module, /<AdminDisclosure title="Foto y web" hint="foto y visibilidad">/, "foto y web van plegados");
  assert.match(module, /<AdminDisclosure title="Precios" hint="final, mayorista y mínimo">/, "los precios van plegados");
  // El SKU viaja al POST y el API lo acepta (antes no existía en el alta).
  assert.match(module, /sku: sku \|\| undefined/, "el SKU tiene que viajar en el alta");
  assert.match(module, /error=\{inventorySkuError\(form\.sku\)\}/, "el SKU se avisa con la regla del kit");
  const route = repoFile("app/api/admin/resources/route.ts");
  assert.match(route, /inventorySkuValid\(skuRaw\)/, "el API revalida el SKU");
  assert.match(route, /sku: skuRaw \|\| null/, "el POST guarda el SKU");
  // El SKU es único por empresa: repetirlo avisa en es-PY (nada de 500).
  assert.match(route, /isUniqueConstraintError\(error\)[\s\S]{0,140}Ya hay un ítem con el SKU/, "el SKU repetido avisa en es-PY");
  // Nombre: check del front con el mensaje del kit (antes caía en el inglés del API).
  assert.match(module, /if \(!personNameValid\(form\.name\)\) \{\n\s+setFormError\(FIELD_MESSAGES\.name\);/);
  assert.match(route, /personNameValid\(itemName\)[\s\S]{0,60}FIELD_MESSAGES\.name/, "el API responde el mismo mensaje");
});

test("evento: check es-PY del cliente y «Fin» en Más datos", () => {
  const module = repoFile("components/admin/modules/EventosModule.tsx");
  const shared = repoFile("components/admin/modules/EventQuickForm.tsx");
  assert.match(
    module,
    /if \(!form\.clientId\.trim\(\)\) \{\n\s+setFormError\("Elegí el cliente del evento\."\);\n\s+return;\n\s+\}/,
    "falta el check es-PY del cliente",
  );
  assert.match(module, /const EMPTY_EVENT_FORM = \{ \.\.\.EMPTY_EVENT_QUICK/, "el módulo usa el estado compartido");
  assert.match(repoFile("components/admin/modules/OperationQuickRules.ts"), /endsAt: ""/, "el fin tiene estado propio");
  assert.match(shared, /label="Fin"[\s\S]{0,200}onChange=/, "el fin se edita en Más datos");
  assert.match(module, /eventQuickPayload\(form\)/, "el fin viaja en el alta completa");
});

test("cliente: el nombre se valida en el front con el mensaje del kit", () => {
  const quick = repoFile("components/admin/modules/ClientQuickForm.tsx");
  assert.match(quick, /name: values\.name\.length > 200/, "el nombre histórico valida como texto comercial sin truncar");
  assert.match(quick, /error=\{errors\?\.name \?\? null\}/, "el campo muestra el aviso");
  assert.match(quick, /if \(!values\.name\.trim\(\) && !values\.tradeName\.trim\(\)\) \{\n\s+setError\(FIELD_MESSAGES\.name\);/, "el diálogo acepta solo nombre comercial");
  assert.equal(quick.includes('"Ingresá el nombre del cliente."'), false, "sin mensaje propio paralelo");
});

test("proveedor: el estado del alta ya no es muerto y las condiciones de pago son select", () => {
  const route = repoFile("app/api/admin/suppliers/route.ts");
  assert.match(route, /active: typeof body\.active === "boolean" \? body\.active : true/, "el POST respeta el estado");
  assert.match(route, /El estado del proveedor tiene que ser activo o inactivo\./, "aviso es-PY");
  assert.match(route, /personNameValid\(name\)[\s\S]{0,60}FIELD_MESSAGES\.name/, "nombre es-PY");
  assert.match(route, /FIELD_MESSAGES\.email/, "correo es-PY");
  const module = repoFile("components/admin/modules/ProveedoresModule.tsx");
  for (const value of ["Contado", "15 días", "30 días", "60 días"]) {
    assert.ok(module.includes(`value: "${value}"`), `falta la condición «${value}»`);
  }
  assert.equal((module.match(/label="Condiciones de pago"/g) ?? []).length, 1, "un solo campo de condiciones");
  assert.match(module, /<SelectField\n\s+label="Condiciones de pago"/, "las condiciones van con el select del kit");
  // Lo cargado antes como texto libre se conserva como opción extra.
  assert.match(module, /label: `\$\{value\} \(cargado\)`/, "lo ya cargado no se pierde al editar");
});

test("promotora: el alta suma «Correo» y los mensajes quedan es-PY", () => {
  const module = repoFile("components/admin/modules/PromotorasModule.tsx");
  assert.match(module, /<EmailField[\s\S]{0,120}label="Correo"/, "falta el correo en el alta");
  assert.match(module, /email: form\.email\.trim\(\) \|\| undefined/, "el correo tiene que viajar en el alta");
  const route = repoFile("app/api/admin/resources/route.ts");
  assert.match(route, /email: promoterEmail \|\| null/, "el API guarda el correo");
  assert.match(route, /emailValid\(promoterEmail\)[\s\S]{0,60}FIELD_MESSAGES\.email/, "el correo se valida con el kit");
  assert.match(route, /personNameValid\(promoterName\)[\s\S]{0,60}FIELD_MESSAGES\.name/, "el nombre se valida con el kit");
});
