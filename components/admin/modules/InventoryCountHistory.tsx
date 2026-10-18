"use client";

import { useMemo, useState } from "react";
import { formatNumber } from "@/lib/admin-format";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import type { AdminInventoryGridRow, AdminWarehouseRow } from "@/lib/admin-types";
import { buildInventoryCountLines, type InventoryCountDraftLine } from "@/lib/inventory-count-entry";
import { AdminButton, AdminCollection, AdminDialog, AdminNote, AdminTable, AdminRow, AdminCell } from "@/components/ui";
import { NumberField, SelectField, TextAreaField, TextField } from "../AdminFields";

type CountLine = { id: string; productName: string; warehouseName: string; warehouseCode: string; expectedQuantity: number; countedQuantity: number; discrepancy: number };
type CountSession = { id: string; countedAt: string; actorName: string; actorEmail: string; notes: string | null; lines: CountLine[] };
type CountCatalogPage = { inventory: AdminInventoryGridRow[]; nextCursor: string | null; total?: number };
type CountWarehouseList = { warehouses: AdminWarehouseRow[] };
type CountDraft = InventoryCountDraftLine & { productLabel: string; warehouseLabel: string };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("es-PY", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(new Date(value));
}

export function InventoryCountHistory({ writable }: { writable: boolean }) {
  const [open, setOpen] = useState(false);
  const [capture, setCapture] = useState(false);
  const resource = useAdminResource("/api/admin/inventory/counts?take=100", (payload) => ((payload as unknown as { sessions?: CountSession[] }).sessions ?? []), { enabled: open });

  return <>
    <AdminButton icon="clock" onClick={() => setOpen(true)} title="Consultar o registrar sesiones de conteo físico">Conteos físicos</AdminButton>
    {open ? <AdminDialog title={capture ? "Registrar conteo físico" : "Conteos físicos"} onClose={() => { setOpen(false); setCapture(false); }} size="wide">
      <div className="admin-stack">
        {capture ? <InventoryCountCapture onCancel={() => setCapture(false)} onSaved={() => { setCapture(false); void resource.reload(); }} /> : <>
          <AdminCollection
            label="Historial de conteos físicos"
            view="list"
            density="compact"
            loading={resource.loading}
            error={resource.error}
            onRetry={resource.reload}
            empty={Boolean(resource.data && resource.data.length === 0)}
            emptyTitle="Todavía no hay conteos físicos"
            emptyHint="Registrá una sesión para guardar la primera fotografía de stock."
            emptyIcon="clock"
            actions={<div className="admin-form-foot">
              <AdminNote>Las sesiones guardan una fotografía por producto y depósito con cantidades registradas y diferencias. Consultar o registrar el conteo no ajusta el stock.</AdminNote>
              {writable ? <AdminButton variant="primary" icon="plus" onClick={() => setCapture(true)}>Registrar conteo</AdminButton> : null}
            </div>}
          >
            <div className="admin-stack">
              {(resource.data ?? []).map((session) => <section className="admin-panel" key={session.id}>
                <header className="admin-panel-head">
                  <div><h3>{dateTime(session.countedAt)}</h3><p>{session.actorName} · {session.actorEmail} · {formatNumber(session.lines.length)} {session.lines.length === 1 ? "producto" : "productos"}</p></div>
                </header>
                {session.notes ? <p className="admin-panel-body">{session.notes}</p> : null}
                <AdminTable view="conteos-fisicos" label={`Detalle de conteo ${dateTime(session.countedAt)}`} columns={[{ label: "Producto" }, { label: "Depósito" }, { label: "Registrado", end: true }, { label: "Contado", end: true }, { label: "Diferencia", end: true }] }>
                  {session.lines.map((line) => <AdminRow key={line.id} tone={line.discrepancy === 0 ? undefined : "warn"}>
                    <AdminCell>{line.productName}</AdminCell><AdminCell>{line.warehouseName} · {line.warehouseCode}</AdminCell>
                    <AdminCell end>{formatNumber(line.expectedQuantity)}</AdminCell><AdminCell end>{formatNumber(line.countedQuantity)}</AdminCell>
                    <AdminCell end>{line.discrepancy > 0 ? "+" : ""}{formatNumber(line.discrepancy)}</AdminCell>
                  </AdminRow>)}
                </AdminTable>
              </section>)}
            </div>
          </AdminCollection>
        </>}
      </div>
    </AdminDialog> : null}
  </>;
}

function InventoryCountCapture({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors[cursors.length - 1];
  const inventoryPath = useMemo(() => {
    const params = new URLSearchParams({ fields: "grid", limit: "100" });
    if (query) params.set("q", query);
    if (cursor) params.set("cursor", cursor);
    return `/api/admin/inventory?${params.toString()}`;
  }, [query, cursor]);
  const inventory = useAdminResource(inventoryPath, (payload) => payload as unknown as CountCatalogPage);
  const warehouses = useAdminResource("/api/admin/inventory/warehouses", (payload) => payload as unknown as CountWarehouseList);
  const [inventoryId, setInventoryId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<CountDraft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertainSave, setUncertainSave] = useState(false);

  const products = (inventory.data?.inventory ?? []).filter((row) => !row.archivedAt && row.kind !== "COMBO");
  const activeWarehouses = (warehouses.data?.warehouses ?? []).filter((row) => !row.archivedAt);
  const selectedProduct = products.find((row) => row.id === inventoryId);
  const selectedWarehouse = activeWarehouses.find((row) => row.id === warehouseId);

  function addRow() {
    setError("");
    if (!selectedProduct || !selectedWarehouse || !/^\d+$/.test(quantity)) {
      setError("Elegí un producto, un depósito y una cantidad. Usá 0 para confirmar que no hay unidades.");
      return;
    }
    const key = `${inventoryId}\0${warehouseId}`;
    if (rows.some((row) => `${row.inventoryId}\0${row.warehouseId}` === key)) {
      setError("Ese producto ya está en este depósito. Editá su cantidad en la fila existente.");
      return;
    }
    setRows((current) => [...current, {
      inventoryId, warehouseId, countedQuantity: quantity,
      productLabel: `${selectedProduct.name}${selectedProduct.sku ? ` · ${selectedProduct.sku}` : ""}`,
      warehouseLabel: `${selectedWarehouse.name} · ${selectedWarehouse.code}`,
    }]);
    setInventoryId("");
    setQuantity("");
  }

  async function save() {
    setError("");
    const parsed = buildInventoryCountLines(rows);
    if (!parsed.ok) { setError(parsed.error); return; }
    if (notes.trim().length > 1000) { setError("Las notas no pueden superar 1000 caracteres."); return; }
    setBusy(true);
    const result = await adminSend<{ session: CountSession }>("/api/admin/inventory/counts", { lines: parsed.lines, notes: notes.trim() || undefined });
    setBusy(false);
    if (!result.ok) {
      if (result.uncertain) setUncertainSave(true);
      setError(result.uncertain ? "No se pudo confirmar si se guardó. Volvé al historial y revisá antes de intentar otra vez." : result.error);
      return;
    }
    onSaved();
  }

  return <div className="admin-stack">
    <AdminNote tone="warn">El conteo guarda una fotografía y calcula la diferencia. No agrega, retira ni mueve unidades; resolvé cualquier ajuste desde su operación correspondiente.</AdminNote>
    <div className="admin-form-grid">
      <TextField label="Buscar productos" value={queryDraft} onChange={setQueryDraft} placeholder="Nombre o código" hint="La búsqueda incluye todas las páginas del inventario." />
      <div className="admin-form-actions"><AdminButton onClick={() => { setQuery(queryDraft.trim()); setCursors([null]); }}>Buscar</AdminButton></div>
    </div>
    <div className="admin-form-grid">
      <SelectField label="Producto" value={inventoryId} onChange={setInventoryId} options={[{ value: "", label: inventory.loading ? "Cargando productos…" : "Elegí un producto" }, ...products.map((row) => ({ value: row.id, label: `${row.name}${row.sku ? ` · ${row.sku}` : ""}` }))]} disabled={inventory.loading || products.length === 0} />
      <SelectField label="Depósito" value={warehouseId} onChange={setWarehouseId} options={[{ value: "", label: warehouses.loading ? "Cargando depósitos…" : "Elegí un depósito" }, ...activeWarehouses.map((row) => ({ value: row.id, label: `${row.name} · ${row.code}` }))]} disabled={warehouses.loading || activeWarehouses.length === 0} />
      <NumberField label="Cantidad contada" value={quantity} onChange={setQuantity} strictInteger maxLength={10} size="sm" placeholder="Ej.: 12" hint="0 es un conteo confirmado sin unidades." />
    </div>
    <div className="admin-actions">
      {inventory.data?.total !== undefined ? <span className="admin-muted">{formatNumber(inventory.data.total)} productos · Página de hasta 100</span> : null}
      <div className="admin-actions">
        <AdminButton disabled={cursors.length <= 1 || inventory.loading} onClick={() => setCursors((current) => current.length > 1 ? current.slice(0, -1) : current)}>Anterior</AdminButton>
        <AdminButton disabled={!inventory.data?.nextCursor || inventory.loading} onClick={() => inventory.data?.nextCursor && setCursors((current) => [...current, inventory.data!.nextCursor])}>Siguiente</AdminButton>
        <AdminButton onClick={addRow} disabled={!inventoryId || !warehouseId || !quantity}>Agregar fila</AdminButton>
      </div>
    </div>
    {inventory.error ? <AdminNote tone="error">{inventory.error}</AdminNote> : null}
    {warehouses.error ? <AdminNote tone="error">{warehouses.error}</AdminNote> : null}
    {rows.length ? <AdminTable view="conteo-captura" label="Productos incluidos en el conteo" columns={[{ label: "Producto" }, { label: "Depósito" }, { label: "Cantidad contada", end: true }, { label: "Acción" }]}>
      {rows.map((row, index) => <AdminRow key={`${row.inventoryId}:${row.warehouseId}`}>
        <AdminCell>{row.productLabel}</AdminCell><AdminCell>{row.warehouseLabel}</AdminCell>
        <AdminCell end><NumberField ariaLabel={`Cantidad contada para ${row.productLabel} en ${row.warehouseLabel}`} value={row.countedQuantity} onChange={(value) => setRows((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, countedQuantity: value } : line))} strictInteger maxLength={10} size="xs" /></AdminCell>
        <AdminCell><AdminButton size="sm" variant="ghost" onClick={() => setRows((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Quitar</AdminButton></AdminCell>
      </AdminRow>)}
    </AdminTable> : <AdminNote>Agregá los productos que contaste. La misma ficha puede aparecer en depósitos distintos.</AdminNote>}
    <TextAreaField label="Notas de la sesión" value={notes} onChange={setNotes} maxLength={1000} rows={2} optional hint="Opcional; se guardan junto con el actor y la fecha." />
    {error ? <AdminNote tone="error" variant="alert">{error}</AdminNote> : null}
    <div className="admin-actions admin-actions-end">
      <AdminButton onClick={onCancel} disabled={busy}>{uncertainSave ? "Volver al historial" : "Cancelar"}</AdminButton>
      <AdminButton variant="primary" onClick={() => void save()} disabled={busy || uncertainSave || rows.length === 0}>{busy ? "Guardando…" : `Guardar conteo${rows.length ? ` · ${rows.length}` : ""}`}</AdminButton>
    </div>
  </div>;
}
