import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ADMIN_ROUTES, isAdminRoute } from "../lib/admin-routes";
import { adminModuleVisible, canManageTrash, canWriteOperations } from "../lib/admin-policy";
import { EVENT_ARCHIVABLE_STATUSES as SERVER_ARCHIVABLE, namesMatch as serverNamesMatch, normalizeName as serverNormalize } from "../lib/server/trash-ops";
import {
  ARCHIVE_FIRST_TITLE,
  EVENT_ARCHIVABLE_STATUSES,
  TRASH_ENTITIES,
  canConfirmPurge,
  canOfferAnonymize,
  eventArchiveBlockedReason,
  filterTrashItems,
  formatBlocker,
  formatBlockers,
  namesMatch,
  normalizeName,
  readBlockers,
  trashActionPath,
  trashDayKey,
  trashMenuEntries,
  type TrashItem,
} from "../lib/trash-shared";

const root = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

test("el formateador de bloqueos habla en castellano y concuerda en número", () => {
  assert.equal(formatBlocker({ kind: "payments", count: 2 }), "Tiene 2 cobros");
  assert.equal(formatBlocker({ kind: "payments", count: 1 }), "Tiene 1 cobro");
  assert.equal(formatBlocker({ kind: "assignments", count: 3 }), "Tiene 3 reservas sin devolver");
  assert.equal(formatBlocker({ kind: "incidents", count: 1 }), "Tiene 1 incidente abierto");
  assert.equal(formatBlocker({ kind: "usedInCombos", count: 2 }), "Es componente de 2 combos");
  assert.equal(formatBlocker({ kind: "invoices", count: 4 }), "Tiene 4 facturas");
  assert.equal(formatBlocker({ kind: "status", count: 1 }), "Está confirmado o en curso");
  // Un tipo que todavía no conocemos no se inventa: cae en un texto genérico con su cantidad.
  assert.equal(formatBlocker({ kind: "otraCosa", count: 5 }), "Tiene 5 otraCosa");
  assert.deepEqual(formatBlockers([{ kind: "payments", count: 2 }, { kind: "assignments", count: 1 }]), ["Tiene 2 cobros", "Tiene 1 reserva sin devolver"]);
});

test("readBlockers solo acepta la forma { kind, count } del 409", () => {
  assert.deepEqual(readBlockers({ error: "x", blockers: [{ kind: "payments", count: 2 }, { kind: 3 }, null, { kind: "a", count: 0 }] }), [{ kind: "payments", count: 2 }]);
  assert.deepEqual(readBlockers({ error: "x" }), []);
  assert.deepEqual(readBlockers(null), []);
});

test("el nombre de confirmación se normaliza igual que en el servidor", () => {
  for (const sample of ["  Fiesta  de Año Nuevo ", "ÁRBOL", "Cámara  4K", "", "   "]) {
    assert.equal(normalizeName(sample), serverNormalize(sample), sample);
  }
  assert.equal(namesMatch("fiesta DE año   nuevo", "Fiesta de Año Nuevo"), true);
  assert.equal(namesMatch("fiesta de ano nuevo", "Fiesta de Año Nuevo"), true);
  assert.equal(namesMatch("fiesta", "Fiesta de Año Nuevo"), false);
  assert.equal(namesMatch("", ""), false);
  assert.equal(serverNamesMatch("Cámara 4K", "camara 4k"), namesMatch("Cámara 4K", "camara 4k"));
  assert.deepEqual([...EVENT_ARCHIVABLE_STATUSES], [...SERVER_ARCHIVABLE]);
});

test("el borrado definitivo se habilita con el nombre exacto y un motivo de hasta 200 caracteres", () => {
  assert.equal(canConfirmPurge("Fiesta", "fiesta", "Duplicado"), true);
  assert.equal(canConfirmPurge("Fiest", "fiesta", "Duplicado"), false);
  assert.equal(canConfirmPurge("Fiesta", "fiesta", "   "), false);
  assert.equal(canConfirmPurge("Fiesta", "fiesta", "x".repeat(200)), true);
  assert.equal(canConfirmPurge("Fiesta", "fiesta", "x".repeat(201)), false);
});

test("anonimizar se ofrece solo si el tipo lo soporta y hay bloqueos", () => {
  const blockers = [{ kind: "payments", count: 1 }];
  assert.equal(canOfferAnonymize("Event", blockers), true);
  assert.equal(canOfferAnonymize("Event", []), false);
  assert.equal(canOfferAnonymize("InventoryItem", blockers), false);
  assert.equal(canOfferAnonymize("Desconocido", blockers), false);
});

test("el registro de tipos arma la ruta de cada acción", () => {
  assert.equal(trashActionPath("Event", "ev1", "trash"), "/api/admin/events/ev1/trash");
  assert.equal(trashActionPath("InventoryItem", "it 1", "purge"), "/api/admin/inventory/it%201/purge");
  for (const entity of Object.values(TRASH_ENTITIES)) {
    assert.ok(entity.label && entity.typeLabel && entity.icon && entity.apiBase.startsWith("/api/admin/"));
  }
});

test("el menú «•••» no muestra acciones a VIEWER ni a roles sin escritura", () => {
  for (const role of ["VIEWER", "FINANCE"] as const) {
    assert.equal(canWriteOperations(role), false);
    assert.deepEqual(trashMenuEntries({ type: "Event", name: "Fiesta", archived: false, canWrite: canWriteOperations(role) }), []);
    assert.deepEqual(trashMenuEntries({ type: "InventoryItem", name: "Parlante", archived: true, canWrite: canWriteOperations(role) }), []);
  }
  assert.deepEqual(trashMenuEntries({ type: "Event", name: "Fiesta", archived: false, canWrite: canWriteOperations(null) }), []);
});

test("Eliminar solo funciona en lo archivado; en lo activo avisa «Archivalo primero»", () => {
  const active = trashMenuEntries({ type: "Event", name: "Fiesta", archived: false, canWrite: true });
  assert.deepEqual(active.map((entry) => entry.key), ["archive", "trash"]);
  const trashActive = active.find((entry) => entry.key === "trash");
  assert.equal(trashActive?.disabled, true);
  assert.equal(trashActive?.title, ARCHIVE_FIRST_TITLE);
  assert.equal(ARCHIVE_FIRST_TITLE, "Archivalo primero");
  const archived = trashMenuEntries({ type: "Event", name: "Fiesta", archived: true, canWrite: true });
  assert.deepEqual(archived.map((entry) => entry.key), ["unarchive", "trash"]);
  assert.equal(archived.find((entry) => entry.key === "trash")?.disabled, undefined);
  // Un evento en curso no se archiva: la entrada queda deshabilitada con el motivo.
  assert.equal(eventArchiveBlockedReason("IN_PROGRESS") !== null, true);
  assert.equal(eventArchiveBlockedReason("COMPLETED"), null);
  const blocked = trashMenuEntries({ type: "Event", name: "Fiesta", archived: false, canWrite: true, archiveBlockedReason: eventArchiveBlockedReason("CONFIRMED") });
  assert.equal(blocked[0].disabled, true);
});

test("los filtros de Eliminados cruzan tipo, persona y rango de fechas (día de Asunción)", () => {
  const item = (over: Partial<TrashItem>): TrashItem => ({ type: "Event", id: "1", name: "A", deletedAt: "2026-10-10T12:00:00.000Z", deletedById: "u1", deletedByName: "Ana", reason: null, anonymized: false, blockers: [], ...over });
  const rows = [item({ id: "1" }), item({ id: "2", type: "InventoryItem", deletedById: "u2" }), item({ id: "3", deletedAt: "2026-10-12T12:00:00.000Z", deletedById: null })];
  const none = { type: "ALL", by: "ALL", from: "", to: "" };
  assert.equal(filterTrashItems(rows, none).length, 3);
  assert.deepEqual(filterTrashItems(rows, { ...none, type: "InventoryItem" }).map((r) => r.id), ["2"]);
  assert.deepEqual(filterTrashItems(rows, { ...none, by: "u1" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterTrashItems(rows, { ...none, by: "none" }).map((r) => r.id), ["3"]);
  assert.deepEqual(filterTrashItems(rows, { ...none, from: "2026-10-11" }).map((r) => r.id), ["3"]);
  assert.deepEqual(filterTrashItems(rows, { ...none, to: "2026-10-10" }).map((r) => r.id), ["1", "2"]);
  // 01:00 UTC del 11 es todavía el 10 en Asunción (UTC-3 / UTC-4).
  assert.equal(trashDayKey("2026-10-11T01:00:00.000Z"), "2026-10-10");
});

test("/ajustes/eliminados está registrada, restringida a OWNER/ADMIN y en la nav de Ajustes", () => {
  assert.ok((ADMIN_ROUTES as readonly string[]).includes("/ajustes/eliminados"));
  assert.equal(isAdminRoute("/ajustes/eliminados"), true);
  for (const role of ["OWNER", "ADMIN"] as const) {
    assert.equal(adminModuleVisible("/ajustes/eliminados", role), true);
    assert.equal(canManageTrash(role), true);
  }
  for (const role of ["FINANCE", "OPERATIONS", "VIEWER"] as const) {
    assert.equal(adminModuleVisible("/ajustes/eliminados", role), false);
    assert.equal(canManageTrash(role), false);
  }
  assert.match(read("components", "admin", "modules", "AjustesTabs.tsx"), /href: "\/ajustes\/eliminados"/);
  assert.match(read("components", "admin", "modules", "AjustesModule.tsx"), /section === "eliminados" && canManage/);
  assert.match(read("app", "(admin)", "(panel)", "ajustes", "eliminados", "page.tsx"), /AdminModuleGuard href="\/ajustes\/eliminados"/);
});

test("la lista de Eliminados usa una sola plantilla --trash-cols y los campos del kit", () => {
  const css = read("app", "globals.css");
  assert.match(css, /\.admin-table--eliminados \{ --trash-cols:[^;]+; --admin-cols: var\(--trash-cols\)/);
  const module = read("components", "admin", "modules", "EliminadosModule.tsx");
  assert.match(module, /view="eliminados"/);
  assert.match(module, /DayField/);
  assert.match(module, /AdminSelect/);
  assert.doesNotMatch(module, /<(input|select|textarea)\b/);
});

test("Eventos e Inventario enchufan el menú «•••» de la papelera solo con permiso de escritura", () => {
  const eventos = read("components", "admin", "modules", "EventosModule.tsx");
  assert.match(eventos, /trashMenuItems\(\{\s*type: "Event"[\s\S]*canWrite: writable/);
  assert.match(eventos, /\{ value: "ARCHIVED", label: "Archivados" \}/);
  const list = read("components", "admin", "modules", "InventoryList.tsx");
  assert.match(list, /trashMenuItems\(\{\s*type: "InventoryItem"[\s\S]*canWrite: writable/);
  const ficha = read("components", "admin", "modules", "InventoryFicha.tsx");
  assert.match(ficha, /trashMenuItems\(\{\s*type: "InventoryItem"[\s\S]*canWrite: writable/);
  // El diálogo de borrado definitivo usa AdminDialog y bloquea el botón hasta que coincide el nombre.
  const dialog = read("components", "admin", "TrashDialogs.tsx");
  assert.match(dialog, /<AdminDialog/);
  assert.match(dialog, /canConfirmPurge\(typed, name, reason\)/);
  assert.match(dialog, /disabled=\{!ready/);
});
