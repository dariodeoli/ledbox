"use client";

import { tierLabel, tiersForAudience, type PriceTier } from "@/lib/price-tiers";
import { formatDateShort, formatMoney, formatNumber, formatTime } from "@/lib/admin-format";
import { CATALOG_AUDIENCE_LABEL, effectiveAudience } from "@/lib/catalog-audience";
import { AUDIENCE_TONE, type StockSummary } from "@/lib/inventory-view";
import { INCOMPLETE_STATE, type InventorySegment, type InventoryStateEntry, type InventoryVisualState } from "@/lib/inventory-visual-state";
import type { AdminInventoryRow } from "@/lib/admin-types";
import { AdminBadge } from "../AdminUI";
import { AdminIcon } from "../AdminIcons";
import { AdminImageBox } from "../AdminImageBox";

/** Piezas chicas que comparten la lista, las tarjetas, la ficha y los formularios del inventario. */

export const KIND_OPTIONS = [
  { value: "ALL", label: "Todos los tipos" },
  { value: "REUSABLE", label: "Reutilizable" },
  { value: "CONSUMABLE", label: "Consumible" },
  { value: "DISPOSABLE", label: "Descartable" },
];

export const KIND_PICK_OPTIONS = KIND_OPTIONS.filter((option) => option.value !== "ALL");

export const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "AVAILABLE", label: "Disponible" },
  { value: "RESERVED", label: "Reservado" },
  { value: "IN_USE", label: "En uso" },
  { value: "MAINTENANCE", label: "Mantenimiento" },
  { value: "RETIRED", label: "Retirado" },
];

export const STATUS_PICK_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== "ALL");

/** Estados de una unidad física: disponible, en mantenimiento, retirada, dañada o perdida. */
export const UNIT_STATUS_PICK_OPTIONS = [
  ...STATUS_PICK_OPTIONS.filter(
    (option) => option.value === "AVAILABLE" || option.value === "MAINTENANCE" || option.value === "RETIRED",
  ),
  { value: "DAMAGED", label: "Dañada" },
  { value: "LOST", label: "Perdida" },
];

/**
 * Miniatura del ítem (issue #86): la imagen del producto con fallback al ícono
 * del módulo. Nunca queda un cuadro roto: si la URL no carga, vuelve al ícono
 * (misma mecánica que el avatar único del panel).
 */
export function InventoryThumb({ item, size = 26 }: { item: Pick<AdminInventoryRow, "imageUrl">; size?: number }) {
  return <AdminImageBox imageUrl={item.imageUrl} size={size} />;
}

/**
 * Precio de venta listo para mostrar: Gs formateado o «—» cuando todavía no
 * está cargado (0 = sin precio, nunca un cero engañoso).
 */
export function priceText(value: number): string {
  return value > 0 ? formatMoney(value) : "—";
}

/** Regla «desde X días» en palabras: `desde 3 días` (0 = sin regla). */
export function daysText(days: number): string {
  return days === 1 ? "desde 1 día" : `desde ${formatNumber(days)} días`;
}

/**
 * Frente de precios en una línea: el normal y, si hay «Precio por días», cada escalón.
 * Ej.: `Final Gs 100.000 · desde 5 días: 300.000 total`.
 */
function priceFrontText(label: string, normal: number, tiers: ReadonlyArray<PriceTier>): string {
  return [`${label} ${priceText(normal)}`, ...tiers.map(tierLabel)].join(" · ");
}

type PriceFields = Pick<AdminInventoryRow, "listPrice" | "wholesalePrice" | "minimumPrice" | "priceTiers">;

/** Detalle completo de los precios para el `title` de una fila o tarjeta. */
export function pricesTitle(item: PriceFields): string {
  return (
    [
      priceFrontText("Final", item.listPrice, tiersForAudience(item.priceTiers, "RETAIL")),
      priceFrontText("Mayorista", item.wholesalePrice, tiersForAudience(item.priceTiers, "WHOLESALE")),
      `Mínimo ${priceText(item.minimumPrice)}`,
    ].join(" · ") + " (PYG)"
  );
}

/** Precio de un frente: el normal y, debajo, su «Precio por días» (el primer escalón y cuántos más hay). */
export function PriceValue({ normal, tiers }: { normal: number; tiers: ReadonlyArray<PriceTier> }) {
  if (normal <= 0 && tiers.length === 0) return <span className="admin-muted">—</span>;
  return (
    <span className="admin-cell-stack">
      <span className="admin-nowrap">{priceText(normal)}</span>
      {tiers.length > 0 ? (
        <small className="admin-cell-sub admin-nowrap">
          {tierLabel(tiers[0])}
          {tiers.length > 1 ? ` (+${tiers.length - 1})` : ""}
        </small>
      ) : null}
    </span>
  );
}

/** Chip de alcance en la tienda web de la empresa (Oculto, Cliente final, Mayorista o Ambos). */
export function AudienceChip({ item }: { item: Pick<AdminInventoryRow, "catalogAudience" | "visibleOnWeb"> }) {
  const audience = effectiveAudience(item);
  return (
    <AdminBadge
      tone={AUDIENCE_TONE[audience]}
      title={audience === "HIDDEN" ? "No se publica en la tienda web." : `Visible en la tienda web: ${CATALOG_AUDIENCE_LABEL[audience].toLowerCase()}.`}
    >
      {CATALOG_AUDIENCE_LABEL[audience]}
    </AdminBadge>
  );
}

/** Stock libre sobre el total con una barra mini; el combo muestra lo que se puede armar. */
export function StockMeter({ summary, combo, large }: { summary: StockSummary; combo?: boolean; large?: boolean }) {
  const { free, total, percent, tone } = summary;
  return (
    <span className={large ? "admin-meter admin-meter--large" : "admin-meter"} data-tone={tone}>
      <span className="admin-meter-figures admin-nowrap">
        <strong>{free == null ? "—" : formatNumber(free)}</strong>
        {combo ? <small> combos</small> : total != null ? <small> / {formatNumber(total)}</small> : null}
      </span>
      {percent != null ? (
        <span className="admin-meter-track" role="presentation">
          <span className="admin-meter-fill" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/** Casilla de selección de fila: botón de 44 px con rol checkbox (sin campos sueltos). */
export function RowCheck({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className="admin-rowcheck"
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="admin-rowcheck-box" aria-hidden="true">
        <AdminIcon name="check" size={11} />
      </span>
    </button>
  );
}

/** Horas de salida/devolución en formato de tabla (es-PY, 24 h). */
export function stamp(value: string | null): string {
  return value ? `${formatDateShort(value)} · ${formatTime(value)}` : "—";
}

/** Rango asignado en una línea: `09-oct. 08:00 → 12-oct. 20:00` (fin abierto si falta). */
export function rangeStamp(start: string | null, end: string | null): string {
  if (!start && !end) return "Sin fechas";
  if (start && !end) return `${formatDateShort(start)} ${formatTime(start)} → sin fin`;
  if (!start && end) return `sin inicio → ${formatDateShort(end)} ${formatTime(end)}`;
  return `${formatDateShort(start)} ${formatTime(start)} → ${formatDateShort(end)} ${formatTime(end)}`;
}

/** Rango pedido en la vista por rango: `21-sept. 00:00 → 23-sept. 23:59`. */
export function dayRangeLabel(from: string, to: string): string {
  return `${formatDateShort(`${from}T00:00`)} 00:00 → ${formatDateShort(`${to}T23:59`)} 23:59`;
}

/**
 * Chip de estado del inventario: ícono + texto, con el tono del mapa único
 * (`lib/inventory-visual-state.ts`). Nunca decide un estado: solo dibuja el que le dan.
 */
export function StateChip({ state, label, title, className }: { state: InventoryStateEntry; label?: string; title?: string; className?: string }) {
  return (
    <AdminBadge tone={state.tone} icon={state.icon} emphasis={state.emphasis} dataState={state.key} title={title ?? state.hint} className={className}>
      {label ?? state.label}
    </AdminBadge>
  );
}

/** Estado principal y, si hay, la marca «Reservado desde dd/mm» (acento · calendario). */
export function StateChips({ visual, compact, incomplete }: { visual: InventoryVisualState; compact?: boolean; incomplete?: boolean }) {
  return (
    <span className={compact ? "admin-inv-chips admin-inv-chips--compact" : "admin-inv-chips"}>
      {incomplete ? <StateChip state={INCOMPLETE_STATE} /> : <StateChip state={visual.state} />}
      {visual.reserved ? <StateChip state={visual.reserved} title="Tiene una reserva a futuro." /> : null}
    </span>
  );
}

const SEGMENT_NAMES: Record<InventorySegment["key"], string> = { free: "libres", rented: "comprometidas", damaged: "dañadas", maintenance: "en mantenimiento" };

/** Barra segmentada de un producto repartido (verde libres · rojo · naranja · azul) con su texto accesible. */
export function SegmentedMeter({ visual }: { visual: InventoryVisualState }) {
  if (visual.segments.length === 0) return null;
  const summary = visual.segments.map((segment) => `${formatNumber(segment.count)} ${SEGMENT_NAMES[segment.key]}`).join(", ");
  return (
    <span className="admin-inv-seg" role="img" aria-label={`${summary} de ${formatNumber(visual.total)}`} title={`${summary} de ${formatNumber(visual.total)}`}>
      {visual.segments.map((segment) => (
        <span key={segment.key} data-tone={segment.tone} style={{ width: `${(segment.count / visual.total) * 100}%` }} />
      ))}
    </span>
  );
}
