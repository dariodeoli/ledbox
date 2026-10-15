"use client";

import { useId, useState } from "react";
import { BILLING_UNIT_OPTIONS, INVENTORY_FIELD_HELP, ITEM_BULK_FIELDS, UNIT_BULK_FIELDS } from "@/lib/inventory-bulk";
import { adminSend } from "@/lib/admin-api";
import { CATALOG_AUDIENCE_OPTIONS } from "@/lib/catalog-audience";
import { DayField, MoneyField, NumberField, SegmentedField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { supplierOptions, warehouseOptions, type InventoryTaxonomy } from "./InventoryTaxonomy";
import { AdminButton, AdminDialog, AdminDialogSection, AdminDisclosure, AdminNote } from "../AdminUI";

type Draft = { mode: string; value: string };

export function InventoryBulkEditor({ target, selection, taxonomy, onSaved, onClear, onClose }: {
  target: "items" | "units";
  /** Depósitos y proveedores para los campos de unidades. */
  taxonomy?: InventoryTaxonomy;
  selection: { id: string; label: string }[];
  onSaved: () => void;
  /** Vacía la selección (y cierra la ventana). */
  onClear: () => void;
  /** Cierra la ventana sin tocar la selección. */
  onClose: () => void;
}) {
  const formId = useId();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fields = target === "items" ? ITEM_BULK_FIELDS : UNIT_BULK_FIELDS;
  const change = (key: string, patch: Partial<Draft>) => setDrafts(current => ({ ...current, [key]: { ...(current[key] ?? { mode: "keep", value: "" }), ...patch } }));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    const changes: Record<string, unknown> = {};
    for (const field of fields) {
      const draft = drafts[field.key];
      if (!draft || draft.mode === "keep") continue;
      if (draft.mode === "clear") changes[field.key] = null;
      else {
        if (!draft.value.trim()) { setError(`Completá ${field.label} o elegí Vaciar.`); return; }
        changes[field.key] = field.type === "money" || field.type === "days" || field.type === "condition" ? Number(draft.value) : draft.value;
      }
    }
    if (!Object.keys(changes).length) { setError("Elegí al menos un campo para cambiar o vaciar."); return; }
    if (changes.subcategory !== undefined && changes.category === undefined) { setError("La subcategoría se elige junto con su categoría: cambiá también la Categoría."); return; }
    setBusy(true);
    const result = await adminSend<{ updated: number; warnings?: string[] }>("/api/admin/inventory", { kind: target === "items" ? "bulk-items" : "bulk-units", ids: selection.map(row => row.id), changes });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setNotice(`${result.data.updated} registros guardados. Solo se modificó la selección indicada. ${(result.data.warnings ?? []).join(" ")}`.trim());
    setDrafts({}); onSaved();
  }
  const dirty = Object.values(drafts).some(draft => draft.mode !== "keep");
  return <AdminDialog
    title={`Edición en lote · ${target === "items" ? "productos" : "unidades"}`}
    icon="edit"
    size="lg"
    description={`Se aplica solo a los ${selection.length} seleccionados; el resto no cambia.`}
    dirty={dirty}
    error={error || null}
    onClose={onClose}
    footer={({ requestClose }) => <>
      <AdminButton type="button" onClick={onClear} disabled={busy}>Quitar selección</AdminButton>
      <AdminButton type="button" onClick={requestClose} disabled={busy}>Cerrar</AdminButton>
      <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={!selection.length || selection.length > 100}>Aplicar a {selection.length} seleccionados</AdminButton>
    </>}
  >
    <p className="admin-note">Selección explícita ({selection.length}): {selection.map(row => row.label).join(" · ")}</p>
    <AdminNote>No cambiar conserva cada valor. Vaciar borra textos opcionales o deja un importe/umbral en 0. El lote se guarda completo: ante un error no se aplica ningún cambio. Los códigos, nombres y cantidades derivadas se editan individualmente.</AdminNote>
    <form id={formId} className="admin-form" onSubmit={event => void submit(event)}>
      <AdminDialogSection title="Campos a cambiar" stack>
      {fields.map(field => {
        const draft = drafts[field.key] ?? { mode: "keep", value: "" };
        const help = INVENTORY_FIELD_HELP[target === "units" && field.key === "status" ? "unitStatus" : field.key];
        const statuses = target === "units" ? ["AVAILABLE", "MAINTENANCE", "RETIRED", "DAMAGED", "LOST"] : ["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE", "RETIRED"];
        const options = field.type === "kind" ? [{ value: "REUSABLE", label: "Reutilizable" }, { value: "CONSUMABLE", label: "Consumible" }, { value: "DISPOSABLE", label: "Descartable" }] : statuses.map(value => ({ value, label: ({ AVAILABLE: "Disponible", RESERVED: "Reservado", IN_USE: "En uso", MAINTENANCE: "Mantenimiento", RETIRED: "Retirado", DAMAGED: "Dañada", LOST: "Perdida" } as Record<string, string>)[value] }));
        return <AdminDisclosure key={field.key} title={field.label} hint={draft.mode === "keep" ? "No cambiar" : draft.mode === "clear" ? "Vaciar" : "Cambiar"}>
          <SelectField label={`Acción · ${field.label}`} help={help} value={draft.mode} onChange={mode => change(field.key, { mode })} disabled={busy} options={[{ value: "keep", label: "No cambiar" }, { value: "set", label: "Cambiar" }, ...(field.clear ? [{ value: "clear", label: "Vaciar" }] : [])]} />
          {draft.mode === "set" ? field.type === "money" ? <MoneyField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} disabled={busy} />
            : field.type === "days" ? <NumberField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} maxLength={4} hint="0 = sin regla; hasta 3650 días." disabled={busy} />
            : field.type === "notes" ? <TextAreaField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} maxLength={target === "units" ? 400 : 2000} disabled={busy} />
            : field.type === "text" ? <TextField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} maxLength={field.key === "category" ? 80 : field.key === "subcategory" ? 60 : 2000} disabled={busy} />
            : field.type === "location" ? <TextField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} maxLength={40} placeholder="Ej.: E3-B2" hint="Estante y nivel; se muestra con el código del depósito." disabled={busy} />
            : field.type === "condition" ? <NumberField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} maxLength={2} hint="Entero del 1 al 10." disabled={busy} />
            : field.type === "date" ? <DayField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} disabled={busy} />
            : field.type === "warehouse" ? <SelectField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} options={[{ value: "", label: "Elegir depósito" }, ...warehouseOptions(taxonomy?.warehouses ?? [])]} disabled={busy} />
            : field.type === "supplier" ? <SelectField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} options={[{ value: "", label: "Elegir proveedor" }, ...supplierOptions(taxonomy?.suppliers ?? [], "Sin proveedor").slice(1)]} disabled={busy} />
            : field.type === "billing" ? <SegmentedField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} options={[...BILLING_UNIT_OPTIONS]} disabled={busy} />
            : field.type === "audience" ? <SegmentedField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} options={[...CATALOG_AUDIENCE_OPTIONS]} disabled={busy} />
            : <SelectField label={field.label} help={help} value={draft.value} onChange={value => change(field.key, { value })} options={[{ value: "", label: "Elegir valor" }, ...options]} disabled={busy} /> : null}
        </AdminDisclosure>;
      })}
      </AdminDialogSection>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
    </form>
  </AdminDialog>;
}
