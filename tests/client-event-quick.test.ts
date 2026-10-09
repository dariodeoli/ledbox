import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Alta rápida de cliente y evento (issue #106): el alta mínima (Nombre con foco
 * + teléfono/correo; evento: Nombre + Cliente + Inicio) y el resto detrás de
 * «Más datos», que no se desmonta (lo cargado no se pierde). El evento suma el
 * «+ Nuevo cliente» con el mismo formulario mínimo del módulo Clientes
 * (patrón de #88). Sin cambios de API ni de modelo: solo UX del panel.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("el kit suma la sección plegable, el foco automático y Escape para cancelar", () => {
  const ui = repoFile("components/admin/AdminUI.tsx");
  assert.match(ui, /export function AdminDisclosure\(/, "falta el objeto plegable del panel");
  // El contenido sigue montado: solo se oculta (lo plegado no pierde lo cargado).
  assert.match(ui, /className="admin-disclosure-body"[\s\S]{0,120}hidden=\{!open\}/, "la sección plegable no puede desmontar su contenido");
  assert.match(ui, /aria-expanded=\{open\}/, "el botón de la sección plegable necesita aria-expanded");
  assert.match(ui, /onEscape\?: \(\) => void;/, "AdminFormPanel tiene que aceptar Escape para cancelar");
  const fields = repoFile("components/admin/AdminFields.tsx");
  assert.match(fields, /autoFocus\?: boolean;/, "TextField necesita el prop de autofoco");
  assert.match(fields, /autoFocus=\{autoFocus\}/, "TextField tiene que pasar el autofoco al input");
  const css = repoFile("app/globals.css");
  assert.match(css, /\.admin-disclosure-body\[hidden\] \{ display: none; \}/, "el cuerpo plegado tiene que ocultarse de verdad");
});

test("Clientes usa el alta mínima compartida y pliega el resto", () => {
  const module = repoFile("components/admin/modules/ClientesModule.tsx");
  assert.match(module, /<ClientQuickFields/, "el alta tiene que usar el formulario mínimo compartido");
  assert.match(module, /autoFocus=\{!editingId\}/, "el Nombre va con foco al crear");
  assert.match(module, /moreOpen=\{Boolean\(editingId\)\}/, "al editar, «Más datos» se muestra abierto");
  assert.match(module, /onEscape=\{closeForm\}/, "Escape cancela el formulario");
  assert.match(module, /clientQuickErrors\(form\)/, "los avisos de campos salen de la regla única");
  assert.match(module, /<TextAreaField/, "las notas siguen dentro de «Más datos»");
});

test("el formulario mínimo compartido no duplica campos y usa el endpoint existente", () => {
  const quick = repoFile("components/admin/modules/ClientQuickForm.tsx");
  assert.match(quick, /label="Nombre fantasía \/ comercial"[\s\S]{0,200}autoFocus=\{autoFocus\}/, "Nombre comercial con foco automático");
  assert.match(quick, /<PhoneField/, "teléfono visible en el alta mínima");
  assert.match(quick, /<EmailField/, "correo visible en el alta mínima");
  assert.match(quick, /<AdminDisclosure title="Más datos"/, "el resto vive en «Más datos»");
  for (const label of ["Empresa", "Tipo", "Nombre del encargado", "Cargo", "Sitio web", "Instagram", "WhatsApp"]) {
    assert.ok(quick.includes(`label="${label}"`), `falta «${label}» dentro de Más datos`);
  }
  assert.match(repoFile("components/admin/modules/ClientFiscalFields.tsx"), /label="RUC \/ CI"/);
  assert.match(quick, /adminSend<\{ client\?: AdminClientOption \}>\("\/api\/admin\/clients"/, "el alta usa el endpoint existente");
  assert.match(quick, /export function ClientQuickDialog/, "falta el diálogo para el evento");
});

test("Eventos deja lo mínimo a la vista y crea clientes desde el selector", () => {
  const module = repoFile("components/admin/modules/EventosModule.tsx");
  const shared = repoFile("components/admin/modules/EventQuickForm.tsx");
  // Orden mínimo: Nombre (foco), Cliente con «+ Nuevo cliente» e Inicio.
  assert.match(module, /<EventQuickFields[\s\S]{0,200}autoFocus/, "el formulario único lleva foco al nombre");
  assert.match(shared, /label="Nombre del evento"[\s\S]{0,120}autoFocus/, "el Nombre del evento va con foco");
  assert.match(module, /<Combobox[\s\S]{0,600}label="Cliente"/, "el selector de cliente es el combobox del kit");
  assert.match(module, /className="admin-field-action"/, "el botón tiene que ir junto al selector");
  assert.match(module, /Nuevo cliente\n/, "falta el botón «+ Nuevo cliente»");
  assert.match(module, /setNewClientName\(name\)/, "el combobox ofrece crear con el texto tipeado");
  assert.match(module, /<ClientQuickDialog/, "falta el diálogo de alta rápida");
  assert.match(shared, /<AdminDisclosure title="Más datos"/, "los datos operativos van plegados");
  // El fin se sumó al alta completa en #131 (el quick de presupuestos ya lo mandaba).
  assert.match(shared, /label="Fin"[\s\S]{0,200}onChange=/, "falta el «Fin» en Más datos");
  assert.match(module, /eventQuickPayload\(form\)/, "el fin viaja en el payload único");
  assert.match(module, /Elegí el cliente del evento\./, "el check del cliente va en es-PY");
  // Al crear, el cliente queda elegido y el catálogo se refresca.
  assert.match(module, /function selectCreatedClient[\s\S]{0,300}clientId: client\.id[\s\S]{0,200}clients\.reload\(\)/, "el cliente creado tiene que quedar elegido");
});

/**
 * Alta de presupuesto (auditoría #123 §2.4, issue #132): el costo interno vive
 * en «Más datos» —fuera del camino del alta—, el API rechaza un presupuesto sin
 * ítems y los mensajes de los endpoints del alta están en español.
 */
test("el alta de presupuesto pliega el costo interno y el API rechaza sin ítems (issue #132)", () => {
  const module = repoFile("components/admin/modules/PresupuestosModule.tsx");
  const formSection = module.match(/<form className="admin-form-panel"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.ok(formSection, "el alta de presupuesto existe");
  assert.match(formSection, /<BudgetItemsEditor/, "creación consume el editor compartido");
  const editor = repoFile("components/admin/modules/BudgetItemsEditor.tsx");
  const priceIndex = editor.indexOf('label="Precio unitario"');
  const disclosureIndex = editor.indexOf('title="Detalles"');
  const costIndex = editor.indexOf('label="Costo unitario (interno)"');
  assert.ok(priceIndex > 0, "el precio unitario queda a la vista");
  assert.ok(disclosureIndex > priceIndex && costIndex > disclosureIndex, "el costo interno va plegado después del precio");
  assert.match(
    editor,
    /<AdminDisclosure title="Detalles"[\s\S]*?label="Costo unitario \(interno\)"[\s\S]*?<\/AdminDisclosure>/,
    "el costo unitario vive dentro de «Más datos»",
  );

  // API: sin ítems no se crea el presupuesto y el error es claro.
  const route = repoFile("app/api/admin/budgets/route.ts");
  assert.match(
    route,
    /if \(items\.length === 0\) \{[\s\S]{0,120}El presupuesto necesita al menos un ítem con nombre\./,
    "el POST tiene que rechazar un presupuesto sin ítems",
  );
  assert.match(route, /Elegí el cliente y escribí el título del presupuesto\./);
  assert.match(route, /El cliente no existe en esta empresa\./);
  // Mensajes es-PY: sin literales en inglés en los endpoints del alta.
  for (const file of [
    "app/api/admin/budgets/route.ts",
    "app/api/admin/budgets/token/route.ts",
    "app/api/admin/budgets/approval/route.ts",
    "app/api/admin/budgets/requests/route.ts",
  ]) {
    assert.doesNotMatch(repoFile(file), /(is|are) required\.|not found\./i, `${file}: mensaje en inglés`);
  }
});
