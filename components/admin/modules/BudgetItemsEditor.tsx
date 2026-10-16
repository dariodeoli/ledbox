"use client";
import { useState } from "react";
import { AdminActionsMenu, AdminButton, AdminDisclosure, AdminNote } from "../AdminUI";
import { MoneyField, NumberField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { AdminImageBox } from "../AdminImageBox";
import { InventoryLinkPicker } from "./BudgetInventoryPicker";
import { isEventBilled, quoteProductLine } from "@/lib/quote-sharing";
import { deliveryFee, deliveryLineName, orderPieces, type DeliveryZoneView } from "@/lib/delivery-zones";
import { useAdminResource } from "@/lib/admin-api";
import type { AdminInventoryLink } from "@/lib/admin-types";
import { SelectField } from "../AdminFields";
import { ComboPackagePanel } from "./ComboPackagePanel";
import { budgetDraftSubtotal, budgetItemError, canSetFreeOnPurpose, budgetUsesDays, emptyBudgetItem, type BudgetItemDraft } from "@/lib/budget-items";
import { BUDGET_INT_MAX } from "@/lib/budget-payment-plan";
import { formatMoney } from "@/lib/admin-format";
import { useAdminSession } from "../AdminShell";

/** Nombre del servicio libre del atajo «+ Transporte» (un ítem más del presupuesto). */
export const TRANSPORT_ITEM_NAME = "Transporte";

const TOTAL_NOTE = /^Precio total por \d+ días?$/;

/**
 * Línea (precio y días a guardar) de un producto para `rentalDays` días, con la regla única de
 * `lib/price-tiers.ts` (la misma de la tienda y la conversión). `null` si el producto no trae precios.
 */
function productLine(product: AdminInventoryLink | null | undefined, rentalDays: number) {
  if (!product || product.listPrice === undefined) return null;
  return quoteProductLine(product, rentalDays);
}

/** One editor for creation and commercial editing. Search is mounted only when requested. */
export function BudgetItemsEditor({ items, onChange, disabled, range = null }: {
  items: BudgetItemDraft[]; onChange: (items: BudgetItemDraft[]) => void; disabled?: boolean;
  range?: { startsAt: string; endsAt: string } | null;
}) {
  const { role } = useAdminSession();
  const canFree = canSetFreeOnPurpose(role);
  const [picker, setPicker] = useState<number | "new" | null>(null);
  const [zonePicker, setZonePicker] = useState(false);
  const zones = useAdminResource("/api/admin/delivery-zones", (payload) => (payload.zones ?? []) as DeliveryZoneView[], { enabled: zonePicker });
  const update = (index: number, patch: Partial<BudgetItemDraft>) => onChange(items.map((item, position) => position === index ? { ...item, ...patch } : item));
  /**
   * Cambia los días del alquiler. Si el precio de la línea es el automático del producto (no lo
   * tocaron a mano) se recalcula con los escalones; un escalón «total» guarda días = 1.
   */
  const changeDays = (index: number, text: string) => {
    const item = items[index];
    const next = Number(text);
    const previous = Number(item.rentalDays ?? item.days);
    const before = productLine(item.inventory, previous);
    const after = Number.isInteger(next) && next >= 1 ? productLine(item.inventory, next) : null;
    const automatic = Boolean(before && before.unitPrice > 0 && Number(item.unitPrice) === before.unitPrice && Number(item.days) === before.days);
    if (!after || after.unitPrice <= 0 || !automatic) {
      update(index, { days: text, ...(item.rentalDays !== undefined ? { rentalDays: text } : {}) });
      return;
    }
    const note = after.mode === "TOTAL" ? `Precio total por ${next} ${next === 1 ? "día" : "días"}` : TOTAL_NOTE.test(item.notes) ? "" : item.notes;
    update(index, { days: String(after.days), rentalDays: String(next), unitPrice: String(after.unitPrice), notes: note });
  };
  return <div className="admin-plan-list budget-items-editor">
    <div className="budget-item-head" aria-hidden="true"><span>Foto</span><span>Ítem</span><span>Precio unitario</span><span>Cantidad</span><span>Días</span><span>Total</span><span>Acciones</span></div>
    {items.map((item, index) => {
      const numeric = { name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice) };
      const error = budgetItemError(numeric);
      const perEvent = isEventBilled(item.inventory?.billingUnit);
      const usesDays = !perEvent && budgetUsesDays({ days: numeric.days, inventoryId: item.inventory?.id });
      return <section className="budget-item" key={item.id ?? `draft-${index}`} aria-label={`Ítem ${index + 1}`}>
        <div className="budget-item-row" data-excluded={item.excluded || undefined}>
          <AdminImageBox imageUrl={item.inventory?.imageUrl} size={40} />
          <TextField label={`Ítem ${index + 1}`} required value={item.name} maxLength={160} disabled={disabled || item.excluded} onChange={(name) => update(index, { name })} />
          <MoneyField label="Precio unitario" required limit={BUDGET_INT_MAX} value={item.unitPrice} disabled={disabled || item.excluded} onChange={(unitPrice) => update(index, { unitPrice })} />
          <NumberField strictInteger label="Cantidad" required maxLength={4} value={item.quantity} disabled={disabled || item.excluded} onChange={(quantity) => update(index, { quantity })} />
          {usesDays ? <NumberField strictInteger label="Días" required maxLength={4} value={item.rentalDays ?? item.days} disabled={disabled || item.excluded} onChange={(days) => changeDays(index, days)} /> : <span className="admin-muted">{perEvent ? "Por evento" : "Servicio / pago único"}</span>}
          <strong className="admin-nowrap" aria-label={`Total del ítem ${index + 1}`}>{formatMoney(item.excluded ? 0 : numeric.quantity * numeric.days * numeric.unitPrice)}</strong>
          <AdminActionsMenu label={`Acciones del ítem ${index + 1}`} items={[
            { label: "Buscar producto", icon: "search", disabled: disabled || item.excluded, onClick: () => setPicker(index) },
            { label: "Duplicar", icon: "copy", disabled: disabled || item.excluded, onClick: () => onChange([...items, { ...item, id: null }]) },
            { label: "Quitar", icon: "trash", disabled: disabled || item.excluded, onClick: () => onChange(items.filter((_, position) => position !== index)) },
          ]} />
        </div>
        {item.excluded ? <AdminNote>Retirado / no incluido. La línea original se conserva.</AdminNote> : null}
        {!item.excluded && item.unitPrice.trim() !== "" && numeric.unitPrice === 0 ? (
          <>
            {item.freeOnPurpose ? <AdminNote>Gratis a propósito: se incluye sin cobrar.</AdminNote> : <AdminNote tone="error"><strong>Falta precio.</strong> Cargalo para poder enviar, aprobar y cobrar; {canFree ? "si es gratis, activalo abajo." : "si es gratis, pedile a un propietario o administrador que lo confirme."}</AdminNote>}
            {canFree ? <SwitchField label="Gratis a propósito (precio 0 confirmado)" checked={Boolean(item.freeOnPurpose)} disabled={disabled} onChange={(checked) => update(index, { freeOnPurpose: checked })} /> : null}
          </>
        ) : null}
        {!item.excluded && item.rentalDays !== undefined && numeric.days === 1 && Number(item.rentalDays) > 1 ? <AdminNote>Precio total por {item.rentalDays} días (no se multiplica por los días).</AdminNote> : null}
        {!item.excluded && item.inventory && (item.inventory._count?.components ?? 0) > 0 && !disabled ? (
          <ComboPackagePanel
            comboId={item.inventory.id}
            quantity={Math.max(1, numeric.quantity || 1)}
            days={Math.max(1, Number(item.rentalDays ?? item.days) || 1)}
            range={range}
            onAdjust={(alternative, partName, total) => update(index, {
              days: "1", rentalDays: String(Math.max(1, Number(item.rentalDays ?? item.days) || 1)), unitPrice: String(total),
              notes: `Precio total por ${Math.max(1, Number(item.rentalDays ?? item.days) || 1)} días, con «${alternative.name}» en lugar de «${partName}»`,
            })}
          />
        ) : null}
        {error && (item.name || item.quantity === "0" || item.days === "0") ? <AdminNote tone="error">{error}</AdminNote> : null}
        <AdminDisclosure title="Detalles" hint="descripción, duración y costo interno">
          <TextAreaField label="Descripción del ítem" value={item.notes} maxLength={400} disabled={disabled} onChange={(notes) => update(index, { notes })} />
          <MoneyField label="Costo unitario (interno)" value={item.costPrice} limit={BUDGET_INT_MAX} disabled={disabled} onChange={(costPrice) => update(index, { costPrice })} />
          {!item.inventory ? <SwitchField label="Aplicar duración por día" checked={numeric.days > 1} disabled={disabled} onChange={(checked) => update(index, { days: checked ? "2" : "1" })} /> : null}
        </AdminDisclosure>
      </section>;
    })}
    {picker !== null && !disabled ? <div className="admin-plan-list">
      <InventoryLinkPicker label="Buscar producto para agregar" range={range} selected={typeof picker === "number" ? items[picker]?.inventory ?? null : null} onSelect={(product) => {
        const current = typeof picker === "number" ? items[picker] : emptyBudgetItem();
        const rental = Math.max(1, Number(current.rentalDays ?? current.days) || 1);
        const line = productLine(product, rental);
        const next: BudgetItemDraft = { ...current, inventory: product, ...(product && line ? { name: product.name, unitPrice: String(line.unitPrice), days: String(line.days), rentalDays: String(rental), notes: line.mode === "TOTAL" ? `Precio total por ${rental} ${rental === 1 ? "día" : "días"}` : TOTAL_NOTE.test(current.notes) ? "" : current.notes } : {}) };
        if (picker === "new") onChange([...items, next]); else update(picker, next);
        setPicker(null);
      }} />
      <AdminButton type="button" onClick={() => { if (picker === "new") onChange([...items, emptyBudgetItem()]); setPicker(null); }}>Agregar servicio libre</AdminButton>
      <AdminButton type="button" onClick={() => setPicker(null)}>Cerrar búsqueda</AdminButton>
    </div> : null}
    {zonePicker && !disabled ? <div className="admin-plan-list" data-testid="flete-picker">
      {zones.loading ? <AdminNote>Cargando zonas…</AdminNote> : zones.error ? <AdminNote tone="error">{zones.error}</AdminNote> : (zones.data ?? []).length === 0 ? <AdminNote>No hay zonas de flete cargadas. Se crean en Ajustes → Alquileres → Zonas de flete.</AdminNote> : <SelectField
        label="Zona de flete"
        value=""
        onChange={(id) => {
          const zone = (zones.data ?? []).find((entry) => entry.id === id);
          if (!zone) return;
          const pieces = orderPieces(items.map((item) => ({ quantity: Number(item.quantity), inventoryId: item.inventory?.id, excluded: item.excluded })));
          const fee = deliveryFee(zone, pieces);
          const name = deliveryLineName(zone.name);
          const line = { ...emptyBudgetItem(), name, unitPrice: String(fee), notes: `${pieces} ${pieces === 1 ? "pieza" : "piezas"} · calculado con la zona; editá el monto si hace falta` };
          // Una sola línea de flete: elegir otra zona reemplaza la anterior.
          onChange([...items.filter((item) => !item.name.startsWith("Flete — ")), line]);
          setZonePicker(false);
        }}
        options={[{ value: "", label: "Elegí una zona…" }, ...(zones.data ?? []).map((zone) => ({ value: zone.id, label: zone.name }))]}
        hint="El monto se calcula con las piezas del presupuesto y queda editable a mano."
      />}
    </div> : null}
    <div className="admin-dialog-actions">
      <AdminButton type="button" icon="plus" disabled={disabled} onClick={() => setPicker("new")}>Agregar ítem</AdminButton>
      <AdminButton type="button" icon="plus" disabled={disabled} onClick={() => setZonePicker((open) => !open)} title="Calcula el flete según la zona y la cantidad de piezas del presupuesto; después podés editar el monto">Flete por zona</AdminButton>
      <AdminButton type="button" icon="plus" disabled={disabled} title="Agrega un servicio libre «Transporte» con su precio: se suma al total y lo ve el cliente" onClick={() => onChange([...items, { ...emptyBudgetItem(), name: TRANSPORT_ITEM_NAME }])}>Transporte</AdminButton>
      <strong className="admin-nowrap" aria-live="polite">Subtotal {formatMoney(budgetDraftSubtotal(items))}</strong>
    </div>
  </div>;
}
