"use client";
import { useState } from "react";
import { AdminActionsMenu, AdminButton, AdminDisclosure, AdminNote } from "../AdminUI";
import { MoneyField, NumberField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { AdminImageBox } from "../AdminImageBox";
import { InventoryLinkPicker } from "./BudgetInventoryPicker";
import { quoteProductPrice } from "@/lib/quote-sharing";
import { budgetDraftSubtotal, budgetItemError, budgetUsesDays, emptyBudgetItem, type BudgetItemDraft } from "@/lib/budget-items";
import { BUDGET_INT_MAX } from "@/lib/budget-payment-plan";
import { formatMoney } from "@/lib/admin-format";

/** One editor for creation and commercial editing. Search is mounted only when requested. */
export function BudgetItemsEditor({ items, onChange, disabled, range = null }: {
  items: BudgetItemDraft[]; onChange: (items: BudgetItemDraft[]) => void; disabled?: boolean;
  range?: { startsAt: string; endsAt: string } | null;
}) {
  const [picker, setPicker] = useState<number | "new" | null>(null);
  const update = (index: number, patch: Partial<BudgetItemDraft>) => onChange(items.map((item, position) => position === index ? { ...item, ...patch } : item));
  return <div className="admin-plan-list budget-items-editor">
    <div className="budget-item-head" aria-hidden="true"><span>Foto</span><span>Ítem</span><span>Precio unitario</span><span>Cantidad</span><span>Días</span><span>Total</span><span>Acciones</span></div>
    {items.map((item, index) => {
      const numeric = { name: item.name, quantity: Number(item.quantity), days: Number(item.days), unitPrice: Number(item.unitPrice), costPrice: Number(item.costPrice) };
      const error = budgetItemError(numeric);
      const usesDays = budgetUsesDays({ days: numeric.days, inventoryId: item.inventory?.id });
      return <section className="budget-item" key={item.id ?? `draft-${index}`} aria-label={`Ítem ${index + 1}`}>
        <div className="budget-item-row" data-excluded={item.excluded || undefined}>
          <AdminImageBox imageUrl={item.inventory?.imageUrl} size={40} />
          <TextField label={`Ítem ${index + 1}`} required value={item.name} maxLength={160} disabled={disabled || item.excluded} onChange={(name) => update(index, { name })} />
          <MoneyField label="Precio unitario" required limit={BUDGET_INT_MAX} value={item.unitPrice} disabled={disabled || item.excluded} onChange={(unitPrice) => update(index, { unitPrice })} />
          <NumberField label="Cantidad" required maxLength={4} value={item.quantity} disabled={disabled || item.excluded} onChange={(quantity) => update(index, { quantity })} />
          {usesDays ? <NumberField label="Días" required maxLength={4} value={item.days} disabled={disabled || item.excluded} onChange={(days) => update(index, { days })} /> : <span className="admin-muted">Servicio / pago único</span>}
          <strong className="admin-nowrap" aria-label={`Total del ítem ${index + 1}`}>{formatMoney(item.excluded ? 0 : numeric.quantity * numeric.days * numeric.unitPrice)}</strong>
          <AdminActionsMenu label={`Acciones del ítem ${index + 1}`} items={[
            { label: "Buscar producto", icon: "search", disabled: disabled || item.excluded, onClick: () => setPicker(index) },
            { label: "Duplicar", icon: "copy", disabled: disabled || item.excluded, onClick: () => onChange([...items, { ...item, id: null }]) },
            { label: "Quitar", icon: "trash", disabled: disabled || item.excluded, onClick: () => onChange(items.filter((_, position) => position !== index)) },
          ]} />
        </div>
        {item.excluded ? <AdminNote>Retirado / no incluido. La línea original se conserva.</AdminNote> : null}
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
        const next = { ...current, inventory: product, ...(product ? { name: product.name, unitPrice: String(quoteProductPrice(product, Number(current.days))) } : {}) };
        if (picker === "new") onChange([...items, next]); else update(picker, next);
        setPicker(null);
      }} />
      <AdminButton type="button" onClick={() => { if (picker === "new") onChange([...items, emptyBudgetItem()]); setPicker(null); }}>Agregar servicio libre</AdminButton>
      <AdminButton type="button" onClick={() => setPicker(null)}>Cerrar búsqueda</AdminButton>
    </div> : null}
    <div className="admin-dialog-actions">
      <AdminButton type="button" icon="plus" disabled={disabled} onClick={() => setPicker("new")}>Agregar ítem</AdminButton>
      <strong className="admin-nowrap" aria-live="polite">Subtotal {formatMoney(budgetDraftSubtotal(items))}</strong>
    </div>
  </div>;
}
