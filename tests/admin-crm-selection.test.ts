import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import type { AdminClientRow, AdminPromoterRow, AdminSupplierRow } from "../lib/admin-types";
import { filterClientSelection, filterSupplierSelection, filterPromoterSelection, clientBulkRow, supplierBulkRow, promoterBulkRow } from "../lib/admin-crm-selection";
import { bulkTrashEligibility } from "../lib/bulk-trash";

function client(id: string, fields: Partial<AdminClientRow> = {}): AdminClientRow {
  return { id, name: `Cliente ${id}`, type: "FINAL", archivedAt: null, active: true, createdAt: "2026-01-01", contactName: null, metrics: { balance: 0, overdue: 0, contracts: 0 }, ...fields } as AdminClientRow;
}
const clientScope = { query: "", segment: "ALL" as const, kpi: null, filter: "ALL" };
const ids = (rows: { id: string }[]) => rows.map(row => row.id);

test("cartera preserva excepciones de deuda archivada y combina segmento/KPI/filtro/búsqueda", () => {
  const rows = [client("live"), client("archived", { archivedAt: "2026-10-01", metrics: { balance: 90, overdue: 10, contracts: 1 } as AdminClientRow["metrics"] }), client("reseller", { type: "RESELLER", contactName: "Ana", billingEmail: "factura@ejemplo.test", metrics: { balance: 20, overdue: 0, contracts: 2 } as AdminClientRow["metrics"] })];
  assert.deepEqual(ids(filterClientSelection(rows, clientScope)), ["live", "reseller"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, filter: "ARCHIVED" })), ["archived"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, filter: "OVERDUE" })), ["archived"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, kpi: "BALANCE" })), ["archived", "reseller"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, kpi: "BALANCE", segment: "RESELLER", query: "factura@ejemplo.test" })), ["reseller"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, filter: "NO_RESPONSIBLE" })), ["live"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, filter: "NO_PURCHASES" })), ["live"]);
  assert.deepEqual(ids(filterClientSelection(rows, { ...clientScope, filter: "ARCHIVED", query: "no coincide" })), []);
});

test("todos filtrados incluye más de300 registros usando el mismo predicado sin mutar la fuente", () => {
  const rows = Array.from({ length: 603 }, (_, i) => client(String(i), { contactName: i % 2 ? "Ana" : null }));
  const scope = { ...clientScope, filter: "NO_RESPONSIBLE" };
  const visible = filterClientSelection(rows.slice(0, 200), scope);
  const all = filterClientSelection(rows, scope);
  assert.equal(visible.length, 100); assert.equal(all.length, 302);
  assert.equal(all.at(-1)?.id, "602");
  assert.equal(rows.length, 603); assert.equal(rows[1].contactName, "Ana");
});

test("proveedores conservan búsqueda por empresa/rubro y separación activo/archivado", () => {
  const rows = [{ id: "a", name: "Uno", company: "Decoración", category: "OTHER", archivedAt: null }, { id: "b", name: "Dos", company: "Decoración", archivedAt: "2026-10-01" }] as AdminSupplierRow[];
  assert.deepEqual(ids(filterSupplierSelection(rows, { query: "Decoración", supplierScope: "ACTIVE" })), ["a"]);
  assert.deepEqual(ids(filterSupplierSelection(rows, { query: "Decoración", supplierScope: "ARCHIVED" })), ["b"]);
  assert.deepEqual(ids(filterSupplierSelection(rows, { query: "otra", supplierScope: "ACTIVE" })), []);
});

test("promotoras combinan disponibilidad, contacto y archivo sin seleccionar otras vistas", () => {
  const rows = [{ id: "a", name: "Ana", specialties: "Eventos", availability: "AVAILABLE", archivedAt: null }, { id: "b", name: "Beto", specialties: "Eventos", availability: "UNAVAILABLE", archivedAt: null }, { id: "c", name: "Ana anterior", availability: "AVAILABLE", archivedAt: "2026-10-01" }] as AdminPromoterRow[];
  assert.deepEqual(ids(filterPromoterSelection(rows, { query: "eventos", availabilityFilter: "ALL" })), ["a", "b"]);
  assert.deepEqual(ids(filterPromoterSelection(rows, { query: "eventos", availabilityFilter: "AVAILABLE" })), ["a"]);
  assert.deepEqual(ids(filterPromoterSelection(rows, { query: "ana", availabilityFilter: "ARCHIVED" })), ["c"]);
  assert.deepEqual(ids(filterPromoterSelection(rows, { query: "ana", availabilityFilter: "UNAVAILABLE" })), []);
});

test("filas del lote contienen sólo identidad mínima y no convierten eliminar en archivar", () => {
  const c = clientBulkRow(client("a", { contactPhone: "privado", tradeName: "Nombre comercial" }));
  assert.equal(c.name, "Nombre comercial");
  assert.deepEqual(Object.keys(c).sort(), ["archivedAt", "id", "name"]);
  assert.match(bulkTrashEligibility(c, "trash")!, /primero/);
  assert.equal(bulkTrashEligibility(supplierBulkRow({ id: "s", name: "S", archivedAt: "2026-10-01" } as AdminSupplierRow), "trash"), null);
  assert.equal(bulkTrashEligibility(promoterBulkRow({ id: "p", name: "P", archivedAt: null } as AdminPromoterRow), "archive"), null);
});

test("los tres consumidores conectan mismo predicado a vista y paginación completa, controles en lista y tarjetas y permiso existente", () => {
  for (const [file, kind, filter, map, permission] of [
    ["ClientesModule", "Client", "filterClientSelection", "clientBulkRow", "canWriteClients"],
    ["ProveedoresModule", "Supplier", "filterSupplierSelection", "supplierBulkRow", "canWriteFinance"],
    ["PromotorasModule", "Promoter", "filterPromoterSelection", "promoterBulkRow", "canWriteOperations"],
  ]) {
    const source = readFileSync(`components/admin/modules/${file}.tsx`, "utf8");
    assert.match(source, new RegExp(`type: "${kind}"`));
    assert.match(source, new RegExp(`const writable = ${permission}\\(role\\)`));
    assert.match(source, /organizationId: organization\?\.id \?\? "", enabled: writable/);
    assert.match(source, new RegExp(`loadAllRows: async \\(\\) => ${filter}\\(await loadBulkTrashRows<`));
    assert.equal((source.match(new RegExp(`${filter}\\(`, "g")) ?? []).length, 2);
    assert.equal((source.match(new RegExp(`<BulkRowCheck bulk=\\{bulk\\} row=\\{${map}\\(`, "g")) ?? []).length, 2);
    assert.match(source, /writable \? <BulkTrashControls bulk=\{bulk\}/);
    assert.doesNotMatch(source.match(/scopeKey: JSON.stringify\(([^\n]*)/)?.[1] ?? "", /order|page|view/);
  }
});


test("callbacks reales de los consumidores materializan páginas completas, con endpoint correcto y reload propio", async () => {
  for (const [file, kind, fixtures, _filter, expectedUrl, key] of [
    ["ClientesModule", "Client", Array.from({ length: 603 }, (_, i) => client(String(i))), filterClientSelection, "/api/admin/clients", "clients"],
    ["ProveedoresModule", "Supplier", Array.from({ length: 603 }, (_, i) => ({ id: String(i), name: `Proveedor ${i}`, archivedAt: null })), filterSupplierSelection, "/api/admin/suppliers", "suppliers"],
    ["PromotorasModule", "Promoter", Array.from({ length: 603 }, (_, i) => ({ id: String(i), name: `Promotora ${i}`, archivedAt: "2026-10-01", availability: "AVAILABLE" })), filterPromoterSelection, "/api/admin/resources?only=promoters&archived=1", "promoters"],
  ] as const) {
    const source = readFileSync(`components/admin/modules/${file}.tsx`, "utf8");
    const callback = source.slice(source.indexOf("  const bulk = useBulkTrash({"), source.indexOf("\n  });", source.indexOf("  const bulk = useBulkTrash({")) + 6);
    // Ejecutar el objeto de opciones real, incluyendo la closure async, sin sustituir sus filtros.
    const ts = await import("typescript");
    const javascript = ts.transpileModule(callback.replace("const bulk =", "captured ="), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    let reloaded = 0;
    const calls: unknown[][] = [];
    const context: any = {
      captured: null, useBulkTrash: (options: any) => options,
      organization: { id: "empresa-local" }, writable: true,
      query: "", segment: "ALL", kpi: null, filter: "ALL", supplierScope: "ACTIVE", availabilityFilter: "ARCHIVED", archivedView: true,
      rows: fixtures.slice(0, 200), supplierRows: fixtures.slice(0, 200),
      filterClientSelection, filterSupplierSelection, filterPromoterSelection,
      clientBulkRow, supplierBulkRow, promoterBulkRow,
      clientsResource: { reload: () => reloaded++ }, suppliersResource: { reload: () => reloaded++ }, reloadAll: () => reloaded++,
      loadBulkTrashRows: async (...args: unknown[]) => { calls.push(args); return fixtures; },
    };
    runInNewContext(javascript, context);
    const options = context.captured;
    assert.equal(options.type, kind); assert.equal(options.organizationId, "empresa-local");
    assert.equal(options.visibleRows.length, 200);
    assert.equal((await options.loadAllRows()).length, 603);
    assert.deepEqual(calls, [[expectedUrl, key]]);
    options.onChanged(); assert.equal(reloaded, 1);
  }
});
