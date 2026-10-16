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
  budgetArchiveBlockedReason,
  eventArchiveBlockedReason,
  isTrashEntityType,
  leadArchiveBlockedReason,
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

test("el registro cubre las 8 entidades de la papelera con su ruta de API", () => {
  assert.deepEqual(Object.keys(TRASH_ENTITIES).sort(), ["Budget", "Client", "Event", "InventoryFamily", "InventoryItem", "Lead", "Promoter", "Supplier"]);
  assert.equal(trashActionPath("InventoryFamily", "f1", "restore"), "/api/admin/inventory/families/f1/restore");
  assert.equal(canOfferAnonymize("InventoryFamily", [{ kind: "familyVariants", count: 1 }]), false);
  assert.equal(trashActionPath("Client", "c1", "archive"), "/api/admin/clients/c1/archive");
  assert.equal(trashActionPath("Promoter", "p1", "trash"), "/api/admin/promoters/p1/trash");
  assert.equal(trashActionPath("Budget", "b1", "purge"), "/api/admin/budgets/b1/purge");
  for (const type of ["Client", "Lead", "Supplier", "Promoter"]) assert.equal(canOfferAnonymize(type, [{ kind: "payments", count: 1 }]), true, type);
  // El presupuesto no ofrece anonimizar (el servidor responde 409).
  assert.equal(canOfferAnonymize("Budget", [{ kind: "payments", count: 1 }]), false);
  assert.equal(isTrashEntityType("Budget"), true);
});

test("cada kind de bloqueo del servidor tiene un texto concreto (no el genérico)", () => {
  const sources = ["lib/server/trash.ts", "lib/server/trash-crm.ts", "lib/server/trash-ops.ts"].map((file) => read(...file.split("/"))).join("\n");
  const kinds = new Set<string>();
  for (const match of sources.matchAll(/kind: "(\w+)"/g)) kinds.add(match[1]);
  // Los que salen de tablas `{ clave: "kind" }` y `Object.entries({ kind: n })`.
  for (const kind of ["supplierJobs", "expenses", "purchaseInvoices", "tasks", "pendingJobs", "futureTasks", "events", "budgets", "notDraft", "budgetsWithHistory", "eventExpenses", "eventInvoices", "eventSupplierJobs", "eventIncidents", "eventAssignments", "signatureRequests", "paymentProofs", "confirmedExpectedPayments", "approvedBudgets", "signedBudgets", "eventsWithPayments", "invoices", "payments"]) kinds.add(kind);
  for (const kind of kinds) {
    const text = formatBlocker({ kind, count: 2 });
    assert.doesNotMatch(text, new RegExp(`Tiene 2 ${kind}$`), `${kind}: sin texto en castellano`);
  }
  assert.equal(formatBlocker({ kind: "eventExpenses", count: 3 }), "Sus eventos tienen 3 gastos");
  assert.equal(formatBlocker({ kind: "pendingJobs", count: 1 }), "Tiene 1 trabajo de proveedor pendiente");
  assert.equal(formatBlocker({ kind: "notDraft", count: 1 }), "Ya no está en borrador");
});

test("las reglas de archivado de Lead y Presupuesto coinciden con el servidor", () => {
  assert.equal(budgetArchiveBlockedReason("DRAFT"), null);
  assert.equal(budgetArchiveBlockedReason("LOST"), null);
  assert.equal(budgetArchiveBlockedReason("CANCELLED"), null);
  assert.notEqual(budgetArchiveBlockedReason("APPROVED"), null);
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(leadArchiveBlockedReason("WON", null, now), null);
  assert.equal(leadArchiveBlockedReason("LOST", null, now), null);
  assert.equal(leadArchiveBlockedReason("NEW", "2026-08-01T00:00:00Z", now), null);
  assert.notEqual(leadArchiveBlockedReason("NEW", "2026-10-10T00:00:00Z", now), null);
});

test("los módulos de CRM enchufan el menú de la papelera solo con permiso y filtran lo archivado", () => {
  const modules: Array<[string, string, RegExp]> = [
    ["ClientesModule.tsx", "Client", /\{ value: "ARCHIVED", label: "Archivados" \}/],
    ["LeadsModule.tsx", "Lead", /key: "ARCHIVED", label: "Archivados"/],
    ["ProveedoresModule.tsx", "Supplier", /\{ value: "ARCHIVED", label: "Archivados" \}/],
    ["PromotorasModule.tsx", "Promoter", /\{ value: "ARCHIVED", label: "Archivadas" \}/],
    ["PresupuestosModule.tsx", "Budget", /\{ value: "ARCHIVED", label: "Archivados" \}/],
  ];
  for (const [file, type, filter] of modules) {
    const source = read("components", "admin", "modules", file);
    assert.match(source, new RegExp(`useTrashFlow\\("${type}"`), `${file}: sin useTrashFlow`);
    assert.match(source, filter, `${file}: sin filtro de archivados`);
    assert.match(source, /canWrite: (writable|canEdit)/, `${file}: el menú no depende del permiso de escritura`);
  }
  // La ficha del cliente y el detalle del presupuesto también.
  assert.match(read("components", "admin", "modules", "ClienteFichaModule.tsx"), /useTrashFlow\("Client"/);
  assert.match(read("components", "admin", "modules", "BudgetDetailDialog.tsx"), /actions\.trashMenu/);
  for (const role of ["VIEWER"] as const) {
    for (const type of ["Client", "Lead", "Supplier", "Promoter", "Budget"] as const) {
      assert.deepEqual(trashMenuEntries({ type, name: "X", archived: true, canWrite: canWriteOperations(role) }), []);
    }
  }
});

test("lo archivado no cuenta en dashboard, resumen, calendario ni contadores del menú", () => {
  for (const file of ["lib/server/resumen.ts", "app/api/admin/overview/route.ts", "app/api/admin/calendar/route.ts", "lib/server/notifications.ts"]) {
    assert.match(read(...file.split("/")), /archivedAt: null/, `${file}: no excluye lo archivado`);
  }
  assert.match(read("lib", "server", "resumen-board.ts"), /"deletedAt" IS NULL AND "archivedAt" IS NULL/);
  // Reportes de dinero e historial del cliente siguen viendo todo.
  assert.doesNotMatch(read("lib", "server", "report-events.ts"), /archivedAt/);
  assert.doesNotMatch(read("app", "api", "admin", "clients", "[id]", "route.ts"), /archivedAt: null/);
  // Sin cuenta regresiva en eventos archivados.
  for (const file of ["EventoLista.tsx", "EventosModule.tsx", "EventoFicha.tsx"]) {
    assert.match(read("components", "admin", "modules", file), /event\.archivedAt \|\|/, `${file}: el archivado muestra «en N d»`);
  }
});

test("clientes: los saldos cuentan también a los archivados (la plata no se archiva)", () => {
  const source = readFileSync(join(process.cwd(), "components/admin/modules/ClientesModule.tsx"), "utf8");
  assert.match(source, /withBalance: all\.withBalance, balanceAmount: all\.balanceAmount/);
  assert.match(source, /owing \? allClients/);
});

test("Eliminados compacta acciones de tabla y conserva texto y click de Restaurar en tarjetas", async () => {
  const ts = (await import("typescript")).default;
  const { runInNewContext } = await import("node:vm");
  const React = await import("react");
  const text = read("components/admin/modules/EliminadosModule.tsx");
  const ast = ts.createSourceFile("trash.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn: import("typescript").FunctionDeclaration | undefined;
  const visit = (node: import("typescript").Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "actions") fn = node; ts.forEachChild(node, visit); }; visit(ast); assert(fn);
  let headers = 0, cells = 0;
  const countColumns = (node: import("typescript").Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "columns" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrayLiteralExpression(node.initializer.expression)) headers = node.initializer.expression.elements.length;
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "AdminCell") cells++;
    ts.forEachChild(node, countColumns);
  }; countColumns(ast); assert.equal(headers, 8); assert.equal(cells, headers, "one shared table with matching header/row columns");
  const code = ts.transpileModule(fn.getText(ast) + ";actions;", { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  for (const compact of [false, true]) {
    const restored: string[] = [];
    const actions = runInNewContext(code, { React, compact, isTrashEntityType, canOfferAnonymize, busyKey: "", key: (item: TrashItem) => item.id, blockersText: () => "", AdminButton: "canonical-button", setTarget() {}, restore: (item: TrashItem) => restored.push(item.id) });
    const rendered = actions({ id: "family", type: "InventoryFamily", name: "Familia larga", blockers: [], anonymized: false });
    const children = React.Children.toArray(rendered.props.children) as import("react").ReactElement<any>[];
    const restore = children[0]; assert.equal(restore.props.icon, "refresh"); assert.equal(restore.props["aria-label"], "Restaurar Familia larga"); assert.match(restore.props.title, /vuelve a archivados/);
    assert.equal(restore.props.size, compact ? "md" : "sm"); assert.equal(restore.props.children, compact ? "Restaurar" : null);
    restore.props.onClick(); assert.deepEqual(restored, ["family"]);
    assert.equal(children[1].props.children, compact ? "Eliminar" : null);
  }
  const css = read("app/globals.css");
  const rule = css.match(/\.admin-table--eliminados \{([^}]+)\}/)?.[1]; assert(rule);
  assert.match(rule, /--admin-table-min: 0/); assert.doesNotMatch(rule, /64rem|17\.25rem/);
  assert.match(rule, /--admin-cols: var\(--trash-cols\)/); assert.match(rule, /minmax\(0,/);
});
