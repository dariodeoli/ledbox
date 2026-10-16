"use client";
import { STOCK_ORIGINS, STOCK_ORIGIN_LABELS } from "@/lib/inventory-stock-origin";
import { SelectField } from "../AdminFields";

/** Same controls in product defaults and physical-unit forms; purchase supplier
 * remains in ProductTraceFields and is never repurposed as the owner. */
export function InventoryOriginFields({ origin, supplierId, suppliers, onChange, physicalUnit = false, disabled = false }: {
  origin: string; supplierId: string; suppliers: Array<{ id: string; name: string }>;
  onChange: (next: { origin: string; supplierId: string }) => void;
  physicalUnit?: boolean; disabled?: boolean;
}) {
  const thirdParty = origin === "CONSIGNED" || origin === "EXTERNAL_RENTAL";
  const options = [{ value: "", label: "Sin revisar" }, ...STOCK_ORIGINS.filter(value => !physicalUnit || value !== "EXTERNAL_RENTAL").map(value => ({ value, label: STOCK_ORIGIN_LABELS[value] }))];
  const supplierOptions = [{ value: "", label: "Elegí el tercero" }, ...suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))];
  if (supplierId && !suppliers.some(supplier => supplier.id === supplierId)) supplierOptions.push({ value: supplierId, label: "Tercero guardado (no disponible en la lista)" });
  return <>
    <SelectField label={physicalUnit ? "Propiedad de esta unidad" : "Origen predeterminado"} size="md" value={origin} options={options} disabled={disabled} onChange={value => onChange({ origin: value, supplierId: "" })} hint={physicalUnit ? "No registra compras ni pagos; conserva el historial de la unidad." : origin === "EXTERNAL_RENTAL" ? "Alquiler por evento, sujeto a confirmar con el proveedor. No crea stock físico." : "Sólo propone el origen de las altas futuras. Las unidades existentes no cambian."} />
    {thirdParty ? <SelectField label={origin === "CONSIGNED" ? "Dueño de las unidades" : "Proveedor del alquiler externo"} required size="md" value={supplierId} options={supplierOptions} disabled={disabled} onChange={value => onChange({ origin, supplierId: value })} hint="Distinto del proveedor de compra. Debe pertenecer a esta empresa." /> : null}
  </>;
}
