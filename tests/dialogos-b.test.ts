import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Rediseño de los diálogos de edición, tanda 2 parte B (13-10-2026): finanzas,
 * presupuestos y ajustes adoptan la base común (`footer`, `error`, secciones,
 * «Más opciones», `busyLabel`, `dirty`). Pruebas de fuente: el JSX no cambia
 * payloads, cálculos ni validación; solo se mueve a la estructura común.
 */
const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const m = (name: string) => read("components", "admin", "modules", name);
const a = (name: string) => read("components", "admin", name);

const SOURCES: Record<string, string> = {
  finanzas: m("FinanzasModule.tsx"),
  facturacion: m("FacturacionModule.tsx"),
  presupuestos: m("PresupuestosModule.tsx"),
  pricing: m("BudgetPricingDialog.tsx"),
  quick: m("BudgetQuickCreate.tsx"),
  detail: m("BudgetDetailDialog.tsx"),
  deposit: m("BudgetSecurityDeposit.tsx"),
  signature: m("SignatureDialog.tsx"),
  conciliacion: m("ConciliacionBancaria.tsx"),
  firmas: m("FirmasModule.tsx"),
  plantillas: m("PlantillasModule.tsx"),
  mensaje: a("AdminMessageTemplateDialog.tsx"),
  usuarios: m("UsuariosModule.tsx"),
  apiKeys: a("ApiKeysPanel.tsx"),
  catalogo: m("ClientCatalogAccess.tsx"),
  plan: m("PlanModule.tsx"),
};

/** Fuente de cada `<AdminDialog …>` (apertura hasta su cierre), para mirar uno por uno. */
function dialogsOf(source: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<AdminDialog", from);
    if (start < 0) break;
    if (source[start + "<AdminDialog".length] === "S") {
      from = start + 1;
      continue;
    }
    const end = source.indexOf("</AdminDialog>", start);
    out.push(source.slice(start, end < 0 ? undefined : end));
    from = end < 0 ? source.length : end;
  }
  return out;
}

test("ningún diálogo de la parte B arma su pie a mano: todos usan footer o AdminConfirmDialog", () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    const handMade = (source.match(/className="admin-dialog-foot[ "]/g) ?? []).length;
    // Presupuestos conserva el pie del formulario en línea «Nuevo presupuesto» (no es un diálogo).
    const allowed = name === "presupuestos" ? 1 : 0;
    assert.equal(handMade, allowed, `${name}: pie armado a mano`);
    assert.doesNotMatch(source, /admin-dialog-footer-note/, `${name}: el error va en error=, no en una nota del pie`);
    for (const dialog of dialogsOf(source)) {
      assert.match(dialog, /footer=/, `${name}: un AdminDialog sin footer`);
    }
  }
});

test("los errores de acción van en error= (franja sobre el pie) y no dentro del formulario", () => {
  for (const name of ["facturacion", "finanzas", "plantillas", "usuarios", "firmas", "conciliacion", "plan", "mensaje", "signature", "pricing"]) {
    assert.match(SOURCES[name], /\berror=\{/, `${name}: sin error=`);
  }
  const fin = SOURCES.finanzas;
  for (const state of ["formError", "payError", "accountError", "movementError", "expenseError"]) {
    assert.match(fin, new RegExp(`error=\\{${state}\\}`), `Finanzas: ${state} en error=`);
    assert.doesNotMatch(fin, new RegExp(`\\{${state} \\? <AdminNote`), `Finanzas: ${state} no se repite en el cuerpo`);
  }
  assert.match(SOURCES.facturacion, /error=\{formError\}/);
  assert.doesNotMatch(SOURCES.facturacion, /\{formError \? <AdminNote/);
});

test("el botón principal avisa «Guardando…» y los formularios largos usan secciones", () => {
  for (const name of ["finanzas", "facturacion", "presupuestos", "pricing", "quick", "signature", "conciliacion", "plantillas", "usuarios", "plan", "deposit"]) {
    assert.match(SOURCES[name], /busyLabel=/, `${name}: sin busyLabel`);
  }
  for (const name of ["finanzas", "facturacion", "presupuestos", "pricing", "signature", "conciliacion", "firmas", "usuarios", "plan", "mensaje", "deposit"]) {
    assert.match(SOURCES[name], /<AdminDialogSection\b/, `${name}: sin secciones`);
  }
});

test("lo avanzado queda en «Más opciones» plegable", () => {
  const collapsibles: Record<string, RegExp> = {
    finanzas: /title="Más opciones"\s+collapsible/,
    facturacion: /title="Más opciones" collapsible/,
    presupuestos: /title="Más opciones" collapsible/,
    signature: /title="Más opciones" collapsible/,
    conciliacion: /title="Más opciones" collapsible/,
  };
  for (const [name, pattern] of Object.entries(collapsibles)) assert.match(SOURCES[name], pattern, `${name}: sin «Más opciones»`);
  const fin = SOURCES.finanzas;
  assert.match(fin, /title="Más opciones" collapsible defaultOpen=\{Boolean\(payJob\.receipt\)\}/, "pago a proveedor: comprobante plegado");
  // Se reabre al pasar a plazo sin remontarse (#186): defaultOpen={term} + AdminDisclosure abre cuando defaultOpen pasa a true.
  assert.match(fin, /title="Más opciones"\s+collapsible\s+defaultOpen=\{term\}/, "registrar cobro: el bloque avanzado se reabre al pasar a plazo");
  assert.match(fin, /title="Costos internos y margen" collapsible/.test(SOURCES.pricing) ? /./ : /./);
  assert.match(SOURCES.pricing, /title="Costos internos y margen" collapsible hint="no los ve el cliente"/);
});

test("registrar cobro: lo más usado primero (cliente, monto, método, cuenta) y la grilla de dos columnas", () => {
  const fin = SOURCES.finanzas;
  const start = fin.indexOf('title="Nuevo cobro de cliente"');
  const dialog = fin.slice(start, fin.indexOf("</AdminDialog>", start));
  assert.match(dialog, /size="lg"/);
  const order = ['label="Cliente"', 'label="Monto"', 'label="Método"', 'label="Cuenta de tesorería"'].map((label) => dialog.indexOf(label));
  assert.ok(order.every((index) => index > 0), "faltan campos");
  assert.deepEqual([...order].sort((x, y) => x - y), order, "orden Cliente → Monto → Método → Cuenta");
  assert.ok(order[3] < dialog.indexOf('title="Más opciones"'), "la cuenta va antes de «Más opciones»");
  assert.match(dialog, /<MoneyField\b[^>]*\blabel="Monto"/, "monto con MoneyField, aunque tenga un límite explícito antes del label");
  assert.match(dialog, /busyLabel="Guardando…"/);
  // El cálculo y el payload de cobros no se tocan.
  assert.match(fin, /async function submit\(/);
});

test("la ayuda de cierre sin guardar (dirty) está en los diálogos con edición", () => {
  const editing: Array<[string, number]> = [
    ["finanzas", 6],
    ["facturacion", 4],
    ["presupuestos", 5],
    ["usuarios", 3],
    ["signature", 1],
    ["conciliacion", 1],
    ["firmas", 1],
    ["plan", 1],
  ];
  for (const [name, min] of editing) {
    const count = (SOURCES[name].match(/\bdirty=\{/g) ?? []).length;
    assert.ok(count >= min, `${name}: ${count} dirty= (mínimo ${min})`);
  }
  // La foto del formulario sale de un ref, sin tocar el estado que viaja al servidor.
  assert.match(SOURCES.facturacion, /invoiceBase\.current/);
  assert.match(SOURCES.presupuestos, /planBaseRef/);
  assert.match(SOURCES.presupuestos, /loadedRef/);
});

test("las confirmaciones destructivas usan AdminConfirmDialog, no diálogos armados a mano", () => {
  assert.match(SOURCES.facturacion, /<AdminConfirmDialog\s+title=\{`Borrar compra/);
  assert.match(SOURCES.facturacion, /<AdminConfirmDialog\s+title=\{`Cerrar \$\{monthKeyLabel\(month\)\}`\}/);
  assert.match(SOURCES.plantillas, /<AdminConfirmDialog\s+title=\{`Eliminar plantilla/);
  assert.match(SOURCES.usuarios, /<AdminConfirmDialog\s+title="Revocar invitación"/);
  assert.match(SOURCES.apiKeys, /<AdminConfirmDialog\s+title="Revocar la API key"/);
  assert.match(SOURCES.catalogo, /<AdminConfirmDialog\s+title="Revocar el link mayorista"/);
  assert.doesNotMatch(SOURCES.apiKeys, /<AdminDialog\b/);
  assert.doesNotMatch(SOURCES.catalogo, /<AdminDialog\b/);
  for (const source of Object.values(SOURCES)) assert.doesNotMatch(source, /window\.confirm\(/);
});

test("mensajes usa editor en página con tres paneles, estado visible y confirmación de cambios sin guardar", () => {
  const source = SOURCES.plantillas;
  assert.doesNotMatch(source, /<AdminDialog\b/, "la edición ya no vuelve al diálogo antiguo");
  for (const panel of [/title="Plantillas"/, /title=\{form\?\.id \? "Personalizar mensaje" : "Nuevo mensaje"\}/, /title="Vista previa"/]) assert.match(source, panel);
  for (const field of ["Nombre de la plantilla", "Categoría de la plantilla", "Mensaje", "Disponible al preparar mensajes"]) assert.ok(source.includes(`label="${field}"`), `falta el campo ${field}`);
  assert.match(source, /previewMessageTemplate\(form\.body, form\.category\)/, "vista previa del motor compartido");
  assert.match(source, /messageTemplateVariablesOf\(form\.category\)/, "variables del contexto editado");
  assert.match(source, /const dirty = form !== null && JSON\.stringify\(form\) !== baseRef\.current/);
  assert.match(source, /if \(dirty\) setPendingChange\(\(\) => action\)/, "cambiar selección difiere la acción");
  assert.match(source, /<AdminConfirmDialog title="Reemplazar edición"/);
  assert.match(source, /onNavigate=\{\(href\) => requestChange\(\(\) => router\.push\(href\)\)\}/, "salir al Directorio usa la misma confirmación");
  assert.match(source, /window\.addEventListener\("beforeunload", onUnload\)/, "cerrar pestaña conserva el aviso de edición");
  assert.match(source, /<AdminConfirmDialog\s+title=\{`Eliminar plantilla[^>]*danger[^>]*onConfirm=\{\(\) => void deleteTemplate\(\)\}/, "borrar exige confirmación destructiva común");
});

test("anular y reabrir: el aviso irreversible va en warning= y el motivo en su sección", () => {
  const fact = SOURCES.facturacion;
  assert.match(fact, /warning="La factura no se borra: queda anulada/);
  assert.match(fact, /warning="Reabrir habilita de nuevo/);
  assert.match(fact, /title="Motivo"/);
  assert.match(fact, /form=\{voidFormId\}/);
  assert.match(fact, /form=\{reopenFormId\}/);
  assert.match(fact, /onSubmit=\{reopenMonth\}/);
});

test("precio y condiciones: pie fijo, costos internos plegados y secciones del documento intactas", () => {
  const pricing = SOURCES.pricing;
  assert.match(pricing, /warning=\{closed \?/);
  assert.match(pricing, /size="lg"/);
  assert.match(pricing, /busy=\{busy\} busyLabel="Guardando…"/);
  // Las secciones del documento se conservan (las fija portal-resumen.test.ts).
  for (const name of ["conditions", "observations", "payments", "issuer"]) {
    assert.match(pricing, new RegExp(`quote-document-section quote-document-section--${name}`));
  }
  // El costo interno sigue detrás de su desplegable propio: ni el pie ni el depósito lo muestran.
  assert.match(pricing, /internalCostOf/);
  for (const name of ["deposit", "quick", "signature"]) assert.doesNotMatch(SOURCES[name], /internalCost|costPrice|materialCost|laborCost/, `${name}: sin costos internos`);
});

test("plan de pagos del presupuesto: secciones Anticipo y condiciones / Cuotas con MoneyField", () => {
  const pres = SOURCES.presupuestos;
  const start = pres.indexOf("title={`Plan de pagos · ${plan.budget.title}`}");
  const dialog = pres.slice(start, pres.indexOf("</AdminDialog>", start));
  assert.match(dialog, /size="lg"/);
  assert.match(dialog, /<AdminDialogSection title="Anticipo y condiciones">/);
  assert.match(dialog, /<AdminDialogSection title="Cuotas" stack>/);
  assert.match(dialog, /<MoneyField\s+label="Anticipo \(Gs\)"/);
  assert.match(dialog, /busyLabel="Guardando…"/);
  assert.match(dialog, /error=\{dialogError\}/);
  assert.match(dialog, /resolveBudgetPaymentPlan\(conditionPayload\(plan\.installments\), plan\.budget\.total, Number\(plan\.advance\) \|\| 0\)\.ok/, "la validación del plan no cambia");
});

test("invitar usuario: hoja chica con error en la franja y la nota de tope del plan dentro del cuerpo", () => {
  const users = SOURCES.usuarios;
  const start = users.indexOf('title="Invitar por correo"');
  const dialog = users.slice(start, users.indexOf("</AdminDialog>", start));
  assert.match(dialog, /size="sm"/);
  assert.match(dialog, /error=\{\(invite !== EMPTY_INVITE \? inviteValidity\.error : null\) \?\? \(localError \|\| \(!limitError && error \? error : null\)\)\}/);
  assert.match(dialog, /limitError && error \? <AdminPlanLimitNote message=\{error\} \/>/);
  assert.match(dialog, /busyLabel="Enviando…"/);
});

test("el monto de los diálogos ocupa la columna completa y usa cifras tabulares", () => {
  const css = read("app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.admin-dialog \.admin-money > span\s*\{\s*width:\s*100%/);
  assert.match(css, /\.admin-dialog \.admin-money input\s*\{\s*font-variant-numeric:\s*tabular-nums/);
});

test("invitar: la validación del correo aparece recién después de editar; el límite del plan conserva «Ver planes»", () => {
  const usuarios = readFileSync(join(process.cwd(), "components/admin/modules/UsuariosModule.tsx"), "utf8");
  assert.match(usuarios, /invite !== EMPTY_INVITE \? inviteValidity\.error : null/);
  const eventos = readFileSync(join(process.cwd(), "components/admin/modules/EventosModule.tsx"), "utf8");
  assert.match(eventos, /formLimit \? <AdminPlanLimitNote message=\{formLimit\} \/>/);
});
