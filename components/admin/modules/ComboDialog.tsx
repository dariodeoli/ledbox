"use client";

import { useId, useMemo, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { formatNumber } from "@/lib/admin-format";
import { comboCapacity, comboCapacityLabel, MAX_COMBO_COMPONENTS } from "@/lib/inventory-combos";
import { FIELD_LIMITS, FIELD_MESSAGES, inventorySkuError, normalizeInventorySku, personNameValid } from "@/lib/field-rules";
import type { AdminInventoryItemRow } from "@/lib/admin-types";
import { AdminButton, AdminDialog, AdminNote } from "../AdminUI";
import { Combobox, NumberField, TextField } from "../AdminFields";

type ComponentDraft = { key: number; componentId: string; quantity: string };

/**
 * «Nuevo combo» / «Editar combo» (alquileres fase 2c). Elige los componentes con su
 * cantidad y muestra, con la disponibilidad real de hoy, cuántos combos se pueden
 * armar y qué componente limita. El servidor revalida todo (sin combos dentro de
 * combos, componentes de la empresa, reservas activas).
 */
export function ComboDialog({
  combo,
  inventory,
  onClose,
  onSaved,
}: {
  combo: AdminInventoryItemRow | null;
  inventory: AdminInventoryItemRow[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(combo?.name ?? "");
  const [sku, setSku] = useState(combo?.sku ?? "");
  const [category, setCategory] = useState(combo?.category ?? "Combos");
  const [rows, setRows] = useState<ComponentDraft[]>(
    combo?.combo?.components.length
      ? combo.combo.components.map((component, index) => ({ key: index, componentId: component.componentId, quantity: String(component.quantity) }))
      : [{ key: 0, componentId: "", quantity: "1" }],
  );
  const [nextKey, setNextKey] = useState(combo?.combo?.components.length ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Solo ítems con unidades propias: un combo no puede contener otro combo.
  const candidates = useMemo(
    () => inventory.filter((item) => !item.combo && !item.archivedAt && item.status !== "RETIRED" && item.id !== combo?.id),
    [inventory, combo?.id],
  );
  const options = useMemo(
    () =>
      candidates.map((item) => ({
        value: item.id,
        label: item.name,
        description: `${item.category} · ${formatNumber(item.availability.availableNow)} libres ahora`,
      })),
    [candidates],
  );
  const preview = useMemo(() => {
    const known = rows.flatMap((row) => {
      const item = candidates.find((candidate) => candidate.id === row.componentId);
      const quantity = Number(row.quantity);
      return item && Number.isInteger(quantity) && quantity > 0 ? [{ componentId: item.id, name: item.name, quantity }] : [];
    });
    if (known.length === 0 || known.length !== rows.length) return null;
    return comboCapacity(known, new Map(candidates.map((item) => [item.id, item.availability.availableNow])));
  }, [rows, candidates]);

  const dirty = Boolean(name || sku || rows.some((row) => row.componentId));

  function patchRow(key: number, patch: Partial<ComponentDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!personNameValid(name.trim())) return setError(FIELD_MESSAGES.name);
    const skuProblem = inventorySkuError(sku);
    if (skuProblem) return setError(skuProblem);
    if (rows.some((row) => !row.componentId)) return setError("Elegí el ítem de cada componente o quitá la fila vacía.");
    const ids = rows.map((row) => row.componentId);
    if (new Set(ids).size !== ids.length) return setError("Un componente no puede repetirse en el combo.");
    if (rows.some((row) => !/^\d+$/.test(row.quantity.trim()) || Number(row.quantity) < 1)) {
      return setError("La cantidad de cada componente debe ser un entero mayor a cero.");
    }
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/inventory/combos", {
      kind: "combo-save",
      ...(combo ? { id: combo.id } : {}),
      name: name.trim(),
      sku: normalizeInventorySku(sku),
      category: category.trim() || "Combos",
      components: rows.map((row) => ({ componentId: row.componentId, quantity: Number(row.quantity) })),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(combo ? `Combo «${name.trim()}» actualizado.` : `Combo «${name.trim()}» creado.`);
  }

  return (
    <AdminDialog
      title={combo ? `Editar combo · ${combo.name}` : "Nuevo combo"}
      icon="inventory"
      size="wide"
      description="Un combo no tiene unidades propias: al reservarlo se reservan sus componentes y comparten el stock con los productos sueltos."
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="submit" form={formId} busy={busy}>
            {combo ? "Guardar combo" : "Crear combo"}
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
        <TextField label="Nombre del combo" required maxLength={FIELD_LIMITS.name} value={name} onChange={setName} placeholder="Ej.: Kit pantalla LED 3×2" autoFocus disabled={busy} />
        <TextField label="Categoría" maxLength={80} value={category} onChange={setCategory} disabled={busy} hint="Los componentes se sustituyen por ítems de su propia categoría, no de esta." />
        <TextField label="SKU" optional maxLength={FIELD_LIMITS.sku} value={sku} onChange={(value) => setSku(normalizeInventorySku(value))} error={inventorySkuError(sku)} disabled={busy} />

        <fieldset className="admin-form-group admin-combo-group">
          <legend className="admin-form-group-title">Componentes</legend>
          {candidates.length === 0 ? <AdminNote>Todavía no hay productos sueltos para armar el combo: cargá primero los ítems.</AdminNote> : null}
          {rows.map((row, index) => (
            <div key={row.key} className="admin-combo-row">
              <Combobox
                label={`Componente ${index + 1}`}
                required
                value={row.componentId}
                onChange={(value) => patchRow(row.key, { componentId: value })}
                options={options}
                placeholder="Buscá un ítem…"
                emptyLabel="Sin ítems que coincidan."
                disabled={busy}
              />
              <NumberField label="Cantidad por combo" required maxLength={4} value={row.quantity} onChange={(value) => patchRow(row.key, { quantity: value })} disabled={busy} />
              <AdminButton
                icon="trash"
                type="button"
                title={`Quitar el componente ${index + 1}`}
                aria-label={`Quitar el componente ${index + 1}`}
                disabled={busy || rows.length === 1}
                onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
              />
            </div>
          ))}
          <AdminButton
            icon="plus"
            type="button"
            disabled={busy || rows.length >= MAX_COMBO_COMPONENTS}
            onClick={() => {
              setRows((current) => [...current, { key: nextKey, componentId: "", quantity: "1" }]);
              setNextKey((key) => key + 1);
            }}
          >
            Agregar componente
          </AdminButton>
        </fieldset>

        {preview ? (
          <AdminNote tone={preview.capacity === 0 ? "warn" : "ok"}>
            {comboCapacityLabel(preview.capacity)}
            {preview.limiting ? ` · lo limita «${preview.limiting.name}» (${formatNumber(preview.limiting.available)} libres, ${formatNumber(preview.limiting.quantity)} por combo)` : ""}
          </AdminNote>
        ) : (
          <AdminNote>Elegí los componentes y sus cantidades para ver cuántos combos se pueden armar con el stock libre de hoy.</AdminNote>
        )}
        {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      </form>
    </AdminDialog>
  );
}
