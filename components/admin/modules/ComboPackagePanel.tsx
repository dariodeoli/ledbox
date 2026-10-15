"use client";

import { useMemo } from "react";
import { useAdminResource } from "@/lib/admin-api";
import { formatMoney, formatNumber } from "@/lib/admin-format";
import { AdminButton, AdminNote } from "../AdminUI";

type Alternative = { id: string; name: string; available: number; enough: boolean; priceDelta: number | null; newPackageTotal: number | null };
type Quote = {
  packageTotal: number;
  unitSum: number;
  savings: number;
  incomplete: boolean;
  components: Array<{ componentId: string; name: string; quantity: number; needed: number; available: number | null; short: boolean; alternatives: Alternative[] }>;
};

const signedMoney = (value: number) => (value === 0 ? "mismo precio" : `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`);

/**
 * Paquete (combo) dentro de una línea del presupuesto: precio del paquete, suma de sus piezas por
 * separado (con la misma regla de días) y ahorro; y, con las fechas del evento, las piezas que no
 * alcanzan con alternativas reales y la diferencia de precio de cada reemplazo. Todo sale del motor
 * (`/api/admin/inventory/combos?pricing=1`); si falta el precio de una pieza no se inventa un ahorro.
 *
 * `onAdjust` fija el precio del paquete al total con el reemplazo (precio del paquete + diferencia).
 */
export function ComboPackagePanel({
  comboId,
  quantity,
  days,
  range,
  disabled,
  onAdjust,
}: {
  comboId: string;
  quantity: number;
  days: number;
  range: { startsAt: string; endsAt: string } | null;
  disabled?: boolean;
  onAdjust?: (alternative: Alternative, partName: string, newPackageTotal: number) => void;
}) {
  const path = useMemo(() => {
    const params = new URLSearchParams({ pricing: "1", id: comboId, days: String(days), quantity: String(quantity) });
    if (range) {
      params.set("startsAt", range.startsAt);
      params.set("endsAt", range.endsAt);
    }
    return `/api/admin/inventory/combos?${params.toString()}`;
  }, [comboId, days, quantity, range]);
  const resource = useAdminResource(path, (payload) => (payload.quote ?? null) as Quote | null);
  const quote = resource.data;
  if (resource.loading || resource.error || !quote) return null;
  const short = quote.components.filter((part) => part.short);
  return (
    <div className="budget-package" data-testid="combo-package">
      {quote.packageTotal > 0 ? (
        <AdminNote>
          <strong>Paquete: {formatMoney(quote.packageTotal)}</strong> por unidad
          {quote.incomplete ? " · falta el precio de alguna pieza, no se calcula el ahorro" : <> · piezas por separado: {formatMoney(quote.unitSum)}{quote.savings > 0 ? <> · <strong>ahorro: {formatMoney(quote.savings)}</strong></> : " · sin ahorro"}</>}
        </AdminNote>
      ) : (
        <AdminNote>Este paquete no tiene precio cargado: sumá el precio en Inventario → Combos.</AdminNote>
      )}
      {short.map((part) => (
        <AdminNote key={part.componentId} tone="error">
          Falta «{part.name}»: piden {formatNumber(part.needed)} y hay {formatNumber(part.available ?? 0)} libres en esas fechas.
          {part.alternatives.length === 0 ? " No hay alternativas con stock en su categoría." : " Alternativas:"}
          <ul>
            {part.alternatives.map((alternative) => (
              <li key={alternative.id}>
                {alternative.name} · {formatNumber(alternative.available)} libres{alternative.enough ? "" : " (no alcanza solo)"} ·{" "}
                {alternative.priceDelta === null ? "sin precio para comparar" : <>{signedMoney(alternative.priceDelta)} → paquete {formatMoney(alternative.newPackageTotal ?? 0)}</>}
                {onAdjust && alternative.newPackageTotal !== null && alternative.enough ? (
                  <> <AdminButton type="button" disabled={disabled} onClick={() => onAdjust(alternative, part.name, alternative.newPackageTotal!)}>Usar este precio</AdminButton></>
                ) : null}
              </li>
            ))}
          </ul>
        </AdminNote>
      ))}
    </div>
  );
}
