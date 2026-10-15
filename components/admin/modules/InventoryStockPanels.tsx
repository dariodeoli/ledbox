"use client";

import { useMemo, useState } from "react";
import { formatDateShort, formatNumber, inventoryKindLabel } from "@/lib/admin-format";
import { FIELD_MESSAGES, formatInventoryLocation, inventoryPriceValue } from "@/lib/field-rules";
import { categoryFormFromText, WarrantyBadge, supplierOptions, warehouseOptions, type InventoryTaxonomy } from "./InventoryTaxonomy";
import { adminSend } from "@/lib/admin-api";
import type { AdminInventoryItemRow, AdminInventoryUnitRow } from "@/lib/admin-types";
import { INVENTORY_FIELD_HELP } from "@/lib/inventory-bulk";
import { AdminButton, AdminCell, AdminDisclosure, AdminNote, AdminRow, AdminTable } from "../AdminUI";
import { DayField, MoneyField, NumberField, SelectField, TextField } from "../AdminFields";

/**
 * Bloques de la ficha del producto que salen del rediseño E1: «Datos» (categoría, subcategoría,
 * depósito por defecto, proveedor, compra, garantía y condición) y «Stock por depósito» (un
 * `groupBy` de las unidades: nunca un segundo número), con «Mover unidades» y «Registrar compra».
 */

const OUT_OF_SERVICE = new Set(["MAINTENANCE", "DAMAGED", "LOST"]);

/** Condición promedio y peor unidad, calculadas de las unidades con puntaje (una sola verdad). */
export function conditionSummary(units: readonly Pick<AdminInventoryUnitRow, "code" | "conditionScore" | "status">[]) {
  const scored = units.filter((unit) => typeof unit.conditionScore === "number" && unit.status !== "RETIRED");
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, unit) => sum + (unit.conditionScore as number), 0);
  const worst = scored.reduce((min, unit) => ((unit.conditionScore as number) < (min.conditionScore as number) ? unit : min), scored[0]);
  return { average: total / scored.length, worst: worst.conditionScore as number, worstCode: worst.code, evaluated: scored.length };
}

/** Unidades agrupadas por depósito (sin las retiradas). */
export function stockByWarehouse(units: readonly AdminInventoryUnitRow[], warehouses: InventoryTaxonomy["warehouses"]) {
  const groups = new Map<string, { id: string; label: string; total: number; available: number; out: number; locations: Set<string> }>();
  for (const unit of units) {
    if (unit.status === "RETIRED") continue;
    const warehouse = warehouses.find((entry) => entry.id === unit.warehouseId);
    const id = unit.warehouseId ?? "none";
    const group = groups.get(id) ?? { id, label: warehouse ? `${warehouse.code} · ${warehouse.name}` : "Sin depósito", total: 0, available: 0, out: 0, locations: new Set<string>() };
    group.total += 1;
    if (unit.status === "AVAILABLE") group.available += 1;
    if (OUT_OF_SERVICE.has(unit.status)) group.out += 1;
    const place = formatInventoryLocation(warehouse?.code, unit.location);
    if (unit.location && place) group.locations.add(place);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function ProductDataSection({ item, taxonomy }: { item: AdminInventoryItemRow; taxonomy: InventoryTaxonomy }) {
  const path = categoryFormFromText(item.category);
  const defaultWarehouse = taxonomy.warehouses.find((warehouse) => warehouse.id === item.defaultWarehouseId);
  const supplier = taxonomy.suppliers.find((entry) => entry.id === item.supplierId);
  const condition = conditionSummary(item.units);
  const place = defaultWarehouse ? formatInventoryLocation(defaultWarehouse.code, item.defaultLocation) : null;
  return (
    <dl className="admin-item-prices admin-item-data">
      <div>
        <dt>Tipo</dt>
        <dd>{inventoryKindLabel(item.kind)}</dd>
      </div>
      <div>
        <dt>Categoría</dt>
        <dd title={path.category}>{path.category}</dd>
      </div>
      <div>
        <dt>Subcategoría</dt>
        <dd title={path.subcategory || "Sin subcategoría"}>{path.subcategory || "—"}</dd>
      </div>
      {item.combo ? null : (
        <>
          <div>
            <dt>Depósito por defecto</dt>
            <dd title={defaultWarehouse ? defaultWarehouse.name : "Se usa el depósito principal"}>{place ?? defaultWarehouse?.code ?? "Principal"}</dd>
          </div>
          <div>
            <dt>Condición</dt>
            <dd title={condition ? `${condition.evaluated} unidades evaluadas` : "Todavía no se evaluó ninguna unidad"}>
              {condition ? `Promedio ${condition.average.toFixed(1).replace(".", ",")}/10` : "Sin evaluar"}
              {condition ? <small>{`Peor: ${condition.worst}/10 · ${condition.worstCode}`}</small> : null}
            </dd>
          </div>
        </>
      )}
      <div>
        <dt>Proveedor</dt>
        <dd title={supplier?.name ?? "Sin proveedor"}>{supplier?.name ?? "—"}</dd>
      </div>
      <div>
        <dt>Compra</dt>
        <dd>{item.purchasedAt ? formatDateShort(item.purchasedAt) : "—"}</dd>
      </div>
      <div>
        <dt>Garantía</dt>
        <dd>
          <WarrantyBadge until={item.warrantyUntil} />
        </dd>
      </div>
    </dl>
  );
}

export function WarehouseStockSection({
  item,
  taxonomy,
  writable,
  onChanged,
}: {
  item: AdminInventoryItemRow;
  taxonomy: InventoryTaxonomy;
  writable: boolean;
  onChanged: () => void;
}) {
  const groups = useMemo(() => stockByWarehouse(item.units, taxonomy.warehouses), [item.units, taxonomy.warehouses]);
  const active = taxonomy.warehouses.filter((warehouse) => !warehouse.archivedAt);
  const [move, setMove] = useState({ from: "", to: "", quantity: "1", location: "" });
  const [purchase, setPurchase] = useState({ quantity: "1", unitCost: "", supplierId: item.supplierId ?? "", purchasedAt: "", warrantyUntil: "", warehouseId: "", location: "", conditionScore: "" });
  const [busy, setBusy] = useState<"move" | "purchase" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submitMove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const quantity = Number(move.quantity);
    if (!move.from || !move.to) return setError("Elegí el depósito de origen y el de destino.");
    if (!Number.isInteger(quantity) || quantity < 1) return setError("La cantidad a mover debe ser un entero mayor a cero.");
    setBusy("move");
    const result = await adminSend<{ moved: number }>("/api/admin/inventory/warehouses", {
      kind: "move-units",
      inventoryId: item.id,
      fromWarehouseId: move.from,
      toWarehouseId: move.to,
      quantity,
      ...(move.location.trim() ? { location: move.location } : {}),
    });
    setBusy("");
    if (!result.ok) return setError(result.error);
    setNotice(`Se movieron ${formatNumber(result.data.moved)} unidad${result.data.moved === 1 ? "" : "es"}. La cantidad total del producto no cambia.`);
    setMove({ from: "", to: "", quantity: "1", location: "" });
    onChanged();
  }

  async function submitPurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const quantity = Number(purchase.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return setError("La cantidad comprada debe ser un entero de 1 a 500.");
    const cost = inventoryPriceValue(purchase.unitCost);
    if (cost === false) return setError(FIELD_MESSAGES.price);
    setBusy("purchase");
    const result = await adminSend<{ added: number }>("/api/admin/inventory", {
      kind: "purchase",
      inventoryId: item.id,
      quantity,
      unitCost: cost ?? 0,
      ...(purchase.supplierId ? { supplierId: purchase.supplierId } : {}),
      ...(purchase.purchasedAt ? { purchasedAt: purchase.purchasedAt } : {}),
      ...(purchase.warrantyUntil ? { warrantyUntil: purchase.warrantyUntil } : {}),
      ...(purchase.warehouseId ? { warehouseId: purchase.warehouseId } : {}),
      ...(purchase.location.trim() ? { location: purchase.location } : {}),
      ...(purchase.conditionScore ? { conditionScore: purchase.conditionScore } : {}),
    });
    setBusy("");
    if (!result.ok) return setError(result.error);
    setNotice(`Compra registrada: ${formatNumber(result.data.added)} unidad${result.data.added === 1 ? "" : "es"} nueva${result.data.added === 1 ? "" : "s"} con código automático.`);
    setPurchase({ ...purchase, quantity: "1", unitCost: "" });
    onChanged();
  }

  return (
    <>
      {groups.length === 0 ? (
        <AdminNote>Todavía no hay unidades: agregá la primera o registrá una compra.</AdminNote>
      ) : (
        <AdminTable
          view="inventario-depositos"
          label={`Stock de ${item.name} por depósito`}
          columns={[{ label: "Depósito" }, { label: "Ubicaciones" }, { label: "Uds.", end: true }, { label: "Libres", end: true }, { label: "Fuera", end: true }]}
        >
          {groups.map((group) => {
            const places = [...group.locations].sort();
            return (
              <AdminRow key={group.id}>
                <AdminCell title={group.label}>{group.label}</AdminCell>
                <AdminCell title={places.join(" · ") || "Sin ubicación cargada"}>
                  <span className="admin-code">{places.length === 0 ? "—" : places.length > 3 ? `${places.slice(0, 3).join(" · ")} +${places.length - 3}` : places.join(" · ")}</span>
                </AdminCell>
                <AdminCell end>{formatNumber(group.total)}</AdminCell>
                <AdminCell end>{formatNumber(group.available)}</AdminCell>
                <AdminCell end>{formatNumber(group.out)}</AdminCell>
              </AdminRow>
            );
          })}
        </AdminTable>
      )}
      <AdminNote>Las reservas no eligen depósito: la disponibilidad es del producto completo; el depósito dice dónde buscar.</AdminNote>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {writable ? (
        <>
          <AdminDisclosure title="Mover unidades" hint="de un depósito a otro">
            <form className="admin-form admin-form-grid" onSubmit={(event) => void submitMove(event)} aria-label="Mover unidades entre depósitos">
              <SelectField label="Desde" value={move.from} onChange={(value) => setMove({ ...move, from: value })} options={[{ value: "", label: "Elegir depósito" }, ...warehouseOptions(taxonomy.warehouses)]} disabled={busy !== ""} />
              <SelectField label="Hacia" value={move.to} onChange={(value) => setMove({ ...move, to: value })} options={[{ value: "", label: "Elegir depósito" }, ...warehouseOptions(active)]} disabled={busy !== ""} />
              <NumberField label="Cantidad" value={move.quantity} onChange={(value) => setMove({ ...move, quantity: value })} maxLength={4} hint="Se mueven unidades disponibles, por orden de código." disabled={busy !== ""} />
              <TextField label="Ubicación nueva" help={INVENTORY_FIELD_HELP.location} value={move.location} onChange={(value) => setMove({ ...move, location: value })} maxLength={40} placeholder="Ej.: E3-B2" hint="Opcional." disabled={busy !== ""} />
              <div className="admin-form-actions">
                <AdminButton variant="primary" icon="check" type="submit" busy={busy === "move"} busyLabel="Moviendo…">
                  Mover unidades
                </AdminButton>
              </div>
            </form>
          </AdminDisclosure>
          <AdminDisclosure title="Registrar compra" hint="suma unidades nuevas con proveedor y garantía">
            <form className="admin-form admin-form-grid" onSubmit={(event) => void submitPurchase(event)} aria-label="Registrar compra de unidades">
              <NumberField label="Cantidad comprada" required value={purchase.quantity} onChange={(value) => setPurchase({ ...purchase, quantity: value })} maxLength={3} hint="Se crean con código automático." disabled={busy !== ""} />
              <MoneyField label="Costo por unidad" help={INVENTORY_FIELD_HELP.purchaseCost} value={purchase.unitCost} onChange={(value) => setPurchase({ ...purchase, unitCost: value })} disabled={busy !== ""} />
              <SelectField label="Proveedor" help={INVENTORY_FIELD_HELP.supplierId} value={purchase.supplierId} onChange={(value) => setPurchase({ ...purchase, supplierId: value })} options={supplierOptions(taxonomy.suppliers, "Sin proveedor")} disabled={busy !== ""} />
              <DayField label="Fecha de compra" help={INVENTORY_FIELD_HELP.purchasedAt} value={purchase.purchasedAt} onChange={(value) => setPurchase({ ...purchase, purchasedAt: value })} disabled={busy !== ""} />
              <DayField label="Garantía hasta" help={INVENTORY_FIELD_HELP.warrantyUntil} value={purchase.warrantyUntil} onChange={(value) => setPurchase({ ...purchase, warrantyUntil: value })} disabled={busy !== ""} />
              <SelectField label="Depósito" help={INVENTORY_FIELD_HELP.warehouseId} value={purchase.warehouseId} onChange={(value) => setPurchase({ ...purchase, warehouseId: value })} options={warehouseOptions(active, { includeEmpty: "El del producto o el principal" })} disabled={busy !== ""} />
              <TextField label="Ubicación" help={INVENTORY_FIELD_HELP.location} value={purchase.location} onChange={(value) => setPurchase({ ...purchase, location: value })} maxLength={40} placeholder="Ej.: E3-B2" disabled={busy !== ""} />
              <NumberField label="Condición (1 a 10)" help={INVENTORY_FIELD_HELP.conditionScore} value={purchase.conditionScore} onChange={(value) => setPurchase({ ...purchase, conditionScore: value })} maxLength={2} disabled={busy !== ""} />
              <div className="admin-form-actions">
                <AdminButton variant="primary" icon="plus" type="submit" busy={busy === "purchase"} busyLabel="Registrando…">
                  Registrar compra
                </AdminButton>
              </div>
            </form>
          </AdminDisclosure>
        </>
      ) : null}
    </>
  );
}

