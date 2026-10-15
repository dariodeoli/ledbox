"use client";

import { useId, useMemo, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { formatNumber } from "@/lib/admin-format";
import { comboCapacity, comboCapacityLabel, MAX_COMBO_COMPONENTS } from "@/lib/inventory-combos";
import { FIELD_LIMITS, FIELD_MESSAGES, inventorySkuError, normalizeInventorySku, personNameValid, readInventoryPriceValues } from "@/lib/field-rules";
import { packageSummary, tiersForAudience, type PriceTier } from "@/lib/price-tiers";
import { formatMoney } from "@/lib/admin-format";
import { PriceTiersEditor, readTierRows, tierRowsFrom, type TierRow } from "./PriceTiersEditor";
import type { AdminInventoryListed, AdminInventoryRow } from "@/lib/admin-types";
import { AdminButton, AdminDialog, AdminDialogSection, AdminNote } from "../AdminUI";
import { Combobox, MoneyField, NumberField, TextField } from "../AdminFields";

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
  combo: AdminInventoryRow | null;
  inventory: AdminInventoryListed[];
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
  // Precio del paquete: lo que paga el cliente por el combo entero (no la suma de sus piezas).
  const [listPrice, setListPrice] = useState(combo && combo.listPrice > 0 ? String(combo.listPrice) : "");
  const [wholesalePrice, setWholesalePrice] = useState(combo && combo.wholesalePrice > 0 ? String(combo.wholesalePrice) : "");
  const [listTiers, setListTiers] = useState<TierRow[]>(tierRowsFrom(tiersForAudience(combo?.priceTiers, "RETAIL")));
  const [wholesaleTiers, setWholesaleTiers] = useState<TierRow[]>(tierRowsFrom(tiersForAudience(combo?.priceTiers, "WHOLESALE")));
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

  // Suma de las piezas por separado vs. precio del paquete (misma regla de días que la tienda y el presupuesto).
  const savings = useMemo(() => {
    const parts = rows.flatMap((row) => {
      const item = candidates.find((candidate) => candidate.id === row.componentId);
      const quantity = Number(row.quantity);
      return item && Number.isInteger(quantity) && quantity > 0
        ? [{ name: item.name, quantity, base: item.listPrice, minimum: 0, billingUnit: item.billingUnit === "EVENT" ? ("EVENT" as const) : ("DAILY" as const), tiers: tiersForAudience(item.priceTiers, "RETAIL") as PriceTier[] }]
        : [];
    });
    const base = Number(listPrice.replace(/[^\d]/g, "")) || 0;
    const tiers = readTierRows(listTiers);
    if (parts.length === 0 || parts.length !== rows.length || base <= 0 || !tiers.ok) return null;
    return [1, 3, 5].map((days) => ({ days, ...packageSummary({ basePrice: base, tiers: tiers.tiers }, parts, days) }));
  }, [rows, candidates, listPrice, listTiers]);

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
    const prices = readInventoryPriceValues({ listPrice, wholesalePrice });
    if (!prices.ok) return setError(prices.error);
    const retail = readTierRows(listTiers);
    if (!retail.ok) return setError(`Cliente final: ${retail.error}`);
    const wholesale = readTierRows(wholesaleTiers);
    if (!wholesale.ok) return setError(`Mayorista: ${wholesale.error}`);
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/inventory/combos", {
      kind: "combo-save",
      listPrice: prices.values.listPrice ?? 0,
      wholesalePrice: prices.values.wholesalePrice ?? 0,
      priceTiers: [...retail.tiers.map((tier) => ({ ...tier, audience: "RETAIL" })), ...wholesale.tiers.map((tier) => ({ ...tier, audience: "WHOLESALE" }))],
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
      size="lg"
      description="Un combo no tiene unidades propias: al reservarlo se reservan sus componentes y comparten el stock con los productos sueltos."
      dirty={dirty}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="submit" form={formId} busy={busy} busyLabel="Guardando…">
            {combo ? "Guardar combo" : "Crear combo"}
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
        <AdminDialogSection title="Datos">
        <TextField label="Nombre del combo" required maxLength={FIELD_LIMITS.name} value={name} onChange={setName} placeholder="Ej.: Kit pantalla LED 3×2" autoFocus disabled={busy} />
        </AdminDialogSection>
        <AdminDialogSection title="Componentes">
                  {candidates.length === 0 ? <div className="admin-field--wide"><AdminNote>Todavía no hay productos sueltos para armar el combo: cargá primero los ítems.</AdminNote></div> : null}
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
          <div className="admin-field--wide">
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
          </div>

        <div className="admin-field--wide">
        {preview ? (
          <AdminNote tone={preview.capacity === 0 ? "warn" : "ok"}>
            {comboCapacityLabel(preview.capacity)}
            {preview.limiting ? ` · lo limita «${preview.limiting.name}» (${formatNumber(preview.limiting.available)} libres, ${formatNumber(preview.limiting.quantity)} por combo)` : ""}
          </AdminNote>
        ) : (
          <AdminNote>Elegí los componentes y sus cantidades para ver cuántos combos se pueden armar con el stock libre de hoy.</AdminNote>
        )}
        </div>
        </AdminDialogSection>
        <AdminDialogSection title="Precio del paquete" hint="lo que paga el cliente por el combo entero">
          <MoneyField label="Precio del paquete" value={listPrice} onChange={setListPrice} disabled={busy} hint="Cliente final, por día (o por evento). Vacío = sin precio cargado." />
          <PriceTiersEditor title="cliente final" rows={listTiers} onChange={setListTiers} normalPrice={listPrice} perEvent={false} disabled={busy} />
          <MoneyField label="Precio del paquete mayorista" value={wholesalePrice} onChange={setWholesalePrice} disabled={busy} hint="Solo para el catálogo mayorista. Vacío = sin precio cargado." />
          <PriceTiersEditor title="mayorista" rows={wholesaleTiers} onChange={setWholesaleTiers} normalPrice={wholesalePrice} perEvent={false} disabled={busy} />
          <div className="admin-field--wide">
            {savings ? (
              <AdminNote tone="ok">
                {savings.map((row) => (row.incomplete ? `${row.days} ${row.days === 1 ? "día" : "días"}: falta el precio de alguna pieza` : `${row.days} ${row.days === 1 ? "día" : "días"}: paquete ${formatMoney(row.packageTotal)} · piezas por separado ${formatMoney(row.unitSum)} · ${row.savings > 0 ? `ahorro ${formatMoney(row.savings)}` : "sin ahorro"}`)).join(" — ")}
              </AdminNote>
            ) : (
              <AdminNote>Cargá el precio del paquete y elegí los componentes para ver cuánto se ahorra frente a las piezas por separado.</AdminNote>
            )}
          </div>
        </AdminDialogSection>
        <AdminDialogSection title="Más opciones" collapsible defaultOpen={Boolean(combo?.sku) || Boolean(combo && combo.category !== "Combos")} hint="categoría y SKU">
        <TextField label="Categoría" maxLength={80} value={category} onChange={setCategory} disabled={busy} hint="Los componentes se sustituyen por ítems de su propia categoría, no de esta." />
        <TextField label="SKU" optional maxLength={FIELD_LIMITS.sku} value={sku} onChange={(value) => setSku(normalizeInventorySku(value))} error={inventorySkuError(sku)} disabled={busy} />

        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}
