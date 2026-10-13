import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Diálogos de edición, tanda 2 parte A (operación y CRM, 13-10-2026): cada
 * diálogo usa la base común (footer fijo, secciones, error fuera del cuerpo,
 * busyLabel) y no queda ningún pie armado a mano.
 */
const read = (name: string) => readFileSync(join(process.cwd(), "components", "admin", "modules", name), "utf8");
const FILES = [
  "EventosModule.tsx",
  "EventQuickForm.tsx",
  "LeadsModule.tsx",
  "LeadQuickForm.tsx",
  "ProveedoresModule.tsx",
  "PromotorasModule.tsx",
  "ComboDialog.tsx",
  "InventoryMovementDialog.tsx",
  "InventoryBulkEditor.tsx",
  "InventoryIncidents.tsx",
  "ClientQuickForm.tsx",
  "EventoFicha.tsx",
];
const sources = Object.fromEntries(FILES.map((name) => [name, read(name)]));

test("ningún diálogo de la parte A arma el pie a mano ni mete el error en el pie", () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.doesNotMatch(source, /className="admin-dialog-foot"/, `${name}: pie a mano`);
    assert.doesNotMatch(source, /admin-dialog-footer-note/, `${name}: error dentro del footer`);
  }
});

test("cada diálogo usa footer o secciones de la base", () => {
  const withFooter = ["EventosModule.tsx", "LeadsModule.tsx", "LeadQuickForm.tsx", "ProveedoresModule.tsx", "PromotorasModule.tsx", "ComboDialog.tsx", "InventoryMovementDialog.tsx", "InventoryBulkEditor.tsx", "InventoryIncidents.tsx", "ClientQuickForm.tsx", "EventoFicha.tsx"];
  for (const name of withFooter) assert.match(sources[name], /footer=\{/, `${name}: sin footer`);
  const withSections = ["EventQuickForm.tsx", "LeadQuickForm.tsx", "ProveedoresModule.tsx", "PromotorasModule.tsx", "ComboDialog.tsx", "InventoryMovementDialog.tsx", "InventoryBulkEditor.tsx", "InventoryIncidents.tsx"];
  for (const name of withSections) assert.match(sources[name], /<AdminDialogSection/, `${name}: sin secciones`);
});

test("lo avanzado va en una sección plegable «Más opciones»", () => {
  for (const name of ["EventQuickForm.tsx", "LeadQuickForm.tsx", "ProveedoresModule.tsx", "PromotorasModule.tsx", "ComboDialog.tsx", "InventoryMovementDialog.tsx"]) {
    assert.match(sources[name], /title="Más opciones" collapsible/, `${name}: sin «Más opciones»`);
  }
  assert.match(sources["EventosModule.tsx"], /layout="sections"/, "el diálogo de Eventos usa las secciones");
});

test("los errores van en error= y el botón principal tiene busyLabel", () => {
  for (const name of ["EventosModule.tsx", "LeadsModule.tsx", "LeadQuickForm.tsx", "ProveedoresModule.tsx", "PromotorasModule.tsx", "ComboDialog.tsx", "InventoryMovementDialog.tsx", "InventoryBulkEditor.tsx", "InventoryIncidents.tsx", "ClientQuickForm.tsx", "EventoFicha.tsx"]) {
    assert.match(sources[name], /\n\s+error=\{/, `${name}: sin error=`);
  }
  for (const name of FILES.filter((file) => file !== "EventQuickForm.tsx" && file !== "EventoFicha.tsx")) {
    assert.match(sources[name], /busyLabel="Guardando…"/, `${name}: sin busyLabel`);
  }
  assert.doesNotMatch(sources["LeadQuickForm.tsx"], /<AdminNote tone="error">/, "el error del lead no vive en el cuerpo");
  assert.doesNotMatch(sources["ComboDialog.tsx"], /<AdminNote tone="error">/);
  assert.doesNotMatch(sources["InventoryMovementDialog.tsx"], /<AdminNote tone="error">/);
});

test("cada diálogo de edición avisa de cambios sin guardar con dirty", () => {
  for (const name of ["EventosModule.tsx", "LeadsModule.tsx", "LeadQuickForm.tsx", "ProveedoresModule.tsx", "PromotorasModule.tsx", "ComboDialog.tsx", "InventoryMovementDialog.tsx", "InventoryBulkEditor.tsx", "InventoryIncidents.tsx", "ClientQuickForm.tsx"]) {
    assert.match(sources[name], /dirty=\{/, `${name}: sin dirty`);
  }
});

test("el alta rápida de cliente sigue mínima: «Más datos» es lo único plegado", () => {
  assert.match(sources["ClientQuickForm.tsx"], /<AdminDisclosure title="Más datos"/);
  assert.match(sources["ClientQuickForm.tsx"], /layout = "quick"/);
});

test("el payload del evento no cambia con las secciones", () => {
  const form = sources["EventQuickForm.tsx"];
  for (const field of ["name", "startsAt", "endsAt", "location", "city", "department", "address", "addressReference", "locationUrl", "venueContactName", "responsibleEmail", "modality", "attendees"]) {
    assert.match(form, new RegExp(`values\\.${field}\\b`), `${field} sigue en el formulario`);
  }
});
