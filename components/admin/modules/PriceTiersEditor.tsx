"use client";

import { MoneyField, NumberField, SegmentedField } from "../AdminFields";
import { AdminButton, AdminNote } from "../AdminUI";
import { previewDays, readPriceTiers, tierPreview, tierWarnings, type PriceTier } from "@/lib/price-tiers";

/** Fila del formulario (texto, como los demás campos del panel). */
export type TierRow = { fromDays: string; mode: "PER_DAY" | "TOTAL"; price: string };

export const EMPTY_TIER_ROW: TierRow = { fromDays: "", mode: "PER_DAY", price: "" };

/** Escalones guardados → filas del formulario. */
export const tierRowsFrom = (tiers: ReadonlyArray<PriceTier>): TierRow[] => tiers.map((tier) => ({ fromDays: String(tier.fromDays), mode: tier.mode, price: String(tier.price) }));

/** Filas del formulario → escalones validados (las filas vacías se ignoran). */
export function readTierRows(rows: ReadonlyArray<TierRow>): { ok: true; tiers: PriceTier[] } | { ok: false; error: string } {
  return readPriceTiers(rows.filter((row) => row.fromDays.trim() !== "" || row.price.trim() !== "").map((row) => ({ fromDays: row.fromDays.trim() === "" ? Number.NaN : Number(row.fromDays), mode: row.mode, price: row.price.trim() === "" ? Number.NaN : Number(row.price) })));
}

const MODE_OPTIONS = [
  { value: "PER_DAY", label: "Por día" },
  { value: "TOTAL", label: "Total" },
];

/**
 * Tabla «Precio por días» de un frente (alquileres P2): cada fila es «desde N días, X por día» o
 * «desde N días, X en total». Para N días rige la fila con más días que no supere N; sin fila rige
 * el precio normal. Un producto «por evento» ignora la tabla. La vista previa usa la misma regla
 * que la tienda y el presupuesto (`lib/price-tiers.ts`).
 */
export function PriceTiersEditor({
  title,
  rows,
  onChange,
  normalPrice,
  perEvent,
  disabled,
}: {
  title: string;
  rows: TierRow[];
  onChange: (rows: TierRow[]) => void;
  /** Precio normal del frente (texto del formulario) para la vista previa. */
  normalPrice: string;
  perEvent: boolean;
  disabled?: boolean;
}) {
  const parsed = readTierRows(rows);
  const base = Number(normalPrice.replace(/[^\d]/g, "")) || 0;
  const update = (index: number, patch: Partial<TierRow>) => onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const warning = parsed.ok ? tierWarnings(base, parsed.tiers) : null;
  return (
    <div className="admin-form-group admin-form-group--tiers" role="group" aria-label={`Precio por días · ${title}`} data-testid="price-tiers">
      <span className="admin-form-group-title">Precio por días · {title}</span>
      {perEvent ? <AdminNote>Este producto se cobra por evento: el precio no cambia con los días y la tabla se ignora.</AdminNote> : null}
      {rows.length === 0 ? <p className="admin-field-hint">Sin escalones: se cobra el precio normal por cada día. Agregá una fila para un precio especial desde cierta cantidad de días (por ejemplo 5 días por 300.000 en total).</p> : null}
      {rows.map((row, index) => (
        <div className="admin-tier-row" key={index}>
          <NumberField label={`Desde (días) · fila ${index + 1}`} maxLength={3} value={row.fromDays} disabled={disabled} onChange={(fromDays) => update(index, { fromDays })} />
          <SegmentedField label={`Se cobra · fila ${index + 1}`} value={row.mode} disabled={disabled} onChange={(mode) => update(index, { mode: mode === "TOTAL" ? "TOTAL" : "PER_DAY" })} options={MODE_OPTIONS} />
          <MoneyField label={row.mode === "TOTAL" ? `Total del período · fila ${index + 1}` : `Precio por día · fila ${index + 1}`} value={row.price} disabled={disabled} onChange={(price) => update(index, { price })} />
          <AdminButton type="button" icon="trash" disabled={disabled} aria-label={`Quitar la fila ${index + 1} de ${title}`} onClick={() => onChange(rows.filter((_, position) => position !== index))}>Quitar</AdminButton>
        </div>
      ))}
      <AdminButton type="button" icon="plus" disabled={disabled || rows.length >= 20} onClick={() => onChange([...rows, { ...EMPTY_TIER_ROW }])}>Agregar fila</AdminButton>
      {!parsed.ok ? <AdminNote tone="error">{parsed.error}</AdminNote> : null}
      {parsed.ok && !perEvent && (parsed.tiers.length > 0 || base > 0) ? (
        <p className="admin-field-hint" data-testid="tier-preview">
          Vista previa: {tierPreview({ basePrice: base, tiers: parsed.tiers }, previewDays(parsed.tiers))}
        </p>
      ) : null}
      {warning ? <AdminNote tone="warn">{warning}</AdminNote> : null}
    </div>
  );
}
