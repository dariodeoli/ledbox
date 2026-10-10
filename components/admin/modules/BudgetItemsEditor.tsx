"use client";
import { useState } from "react";
import { AdminActionsMenu, AdminButton, AdminDisclosure, AdminNote } from "../AdminUI";
import { MoneyField, NumberField, PercentField, SelectField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { formatPercent, parsePercent } from "@/lib/field-rules";
import { calculateBudgetCommercial } from "@/lib/budget-commercial-calculation";
import { AdminImageBox } from "../AdminImageBox";
import { InventoryLinkPicker } from "./BudgetInventoryPicker";
import { quoteProductPrice } from "@/lib/quote-sharing";
import { budgetDraftCommercialLine, budgetDraftSubtotal, budgetItemError, budgetUsesDays, emptyBudgetItem, type BudgetItemDraft } from "@/lib/budget-items";
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
      const terms = item.commercialTerms ?? { priceMode: null, tariffSnapshot: null, discountMode: null, discountValue: null, discountAmount: null };
      const setTerms = (patch: Partial<typeof terms>) => update(index, { commercialTerms: { ...terms, ...patch }, ...(Object.hasOwn(patch, "discountMode") ? { discountInput: undefined } : {}) });
      let effective: ReturnType<typeof calculateBudgetCommercial>["items"][number] | undefined;
      let commercialError = "";
      try { effective = calculateBudgetCommercial([budgetDraftCommercialLine(item, index)], { discountMode: null, discountValue: null, advancePercentBps: null }, 0, 0).items[0]; } catch (error) { commercialError = error instanceof Error ? error.message : "Términos inválidos"; }
      return <section className="budget-item" key={item.id ?? `draft-${index}`} aria-label={`Ítem ${index + 1}`}>
        <div className="budget-item-row" data-excluded={item.excluded || undefined}>
          <AdminImageBox imageUrl={item.inventory?.imageUrl} size={40} />
          <TextField label={`Ítem ${index + 1}`} required value={item.name} maxLength={160} disabled={disabled || item.excluded} onChange={(name) => update(index, { name })} />
          <MoneyField label="Precio unitario" required limit={BUDGET_INT_MAX} value={terms.priceMode === "TARIFF" ? String(effective?.unitPrice ?? item.unitPrice) : item.unitPrice} disabled={disabled || item.excluded || terms.priceMode === "TARIFF"} onChange={(unitPrice) => update(index, { unitPrice })} />
          <NumberField label="Cantidad" required maxLength={4} value={item.quantity} disabled={disabled || item.excluded} onChange={(quantity) => update(index, { quantity })} />
          {usesDays ? <NumberField label="Días" required maxLength={4} value={item.days} disabled={disabled || item.excluded} onChange={(days) => update(index, { days })} /> : <span className="admin-muted">Servicio / pago único</span>}
          <strong className="admin-nowrap" aria-label={`Total del ítem ${index + 1}`}>{formatMoney(effective?.subtotal ?? NaN)}</strong>
          <AdminActionsMenu label={`Acciones del ítem ${index + 1}`} items={[
            { label: "Buscar producto", icon: "search", disabled: disabled || item.excluded, onClick: () => setPicker(index) },
            { label: "Duplicar", icon: "copy", disabled: disabled || item.excluded, onClick: () => onChange([...items, { ...item, id: null }]) },
            { label: "Quitar", icon: "trash", disabled: disabled || item.excluded, onClick: () => onChange(items.filter((_, position) => position !== index)) },
          ]} />
        </div>
        {item.excluded ? <AdminNote>Retirado / no incluido. La línea original se conserva.</AdminNote> : null}
        {error && (item.name || item.quantity === "0" || item.days === "0") ? <AdminNote tone="error">{error}</AdminNote> : null}
        {commercialError && item.name ? <AdminNote tone="error">{commercialError}</AdminNote> : null}
        <AdminDisclosure title="Detalles" hint="descripción, duración y costo interno">
          <SelectField label="Modalidad de precio" value={terms.priceMode ?? "LEGACY"} disabled={disabled || item.excluded} options={[{ value: "LEGACY", label: "Precio histórico pactado" }, { value: "MANUAL", label: "Precio manual explícito" }, ...(item.inventory || terms.tariffSnapshot ? [{ value: "TARIFF", label: "Tarifa por días del frente elegido" }] : [])]} onChange={(value) => {
            if (value === "TARIFF" && !terms.tariffSnapshot && item.inventory) {
              const product = item.inventory;
              setTerms({ priceMode: "TARIFF", tariffSnapshot: { version: 1, front: "FINAL", normalPrice: product.listPrice ?? 0, fromDays: product.listFromDays ?? 0, fromPrice: product.listFromPrice ?? 0, minimumPrice: product.minimumPrice ?? 0 } });
            } else if (value !== "LEGACY" || !terms.tariffSnapshot) setTerms({ priceMode: value === "LEGACY" ? null : value as "MANUAL" | "TARIFF" });
          }} />
          {terms.priceMode === "TARIFF" && item.inventory ? <SelectField label="Frente de tarifa" value={terms.tariffSnapshot?.front ?? "FINAL"} disabled={disabled || item.excluded} options={[{ value: "FINAL", label: "Final" }, { value: "WHOLESALE", label: "Mayorista" }]} onChange={(front) => { const product = item.inventory!; const wholesale = front === "WHOLESALE"; setTerms({ tariffSnapshot: { version: 1, front: wholesale ? "WHOLESALE" : "FINAL", normalPrice: (wholesale ? product.wholesalePrice : product.listPrice) ?? 0, fromDays: (wholesale ? product.wholesaleFromDays : product.listFromDays) ?? 0, fromPrice: (wholesale ? product.wholesaleFromPrice : product.listFromPrice) ?? 0, minimumPrice: product.minimumPrice ?? 0 } }); }} /> : null}
          <SelectField label="Descuento de esta línea" value={terms.discountMode ?? "NONE"} disabled={disabled || item.excluded} options={[{ value: "NONE", label: "Sin descuento de línea" }, { value: "AMOUNT", label: "Monto de esta línea" }, { value: "PERCENT", label: "Porcentaje de esta línea" }]} onChange={(value) => setTerms({ discountMode: value === "NONE" ? null : value as "AMOUNT" | "PERCENT", discountValue: value === "NONE" ? null : 0, discountAmount: value === "NONE" ? null : 0 })} />
          {terms.discountMode === "AMOUNT" ? <MoneyField label="Rebaja de esta línea" value={String(terms.discountValue ?? 0)} limit={BUDGET_INT_MAX} disabled={disabled || item.excluded} onChange={(value) => setTerms({ discountValue: Number(value) })} /> : terms.discountMode === "PERCENT" ? <PercentField label="Rebaja de esta línea (%)" value={item.discountInput ?? formatPercent((terms.discountValue ?? 0) / 100)} disabled={disabled || item.excluded} onChange={(value) => update(index, { discountInput: value, commercialTerms: { ...terms, discountValue: Math.round((parsePercent(value) ?? NaN) * 100) } })} /> : null}
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
