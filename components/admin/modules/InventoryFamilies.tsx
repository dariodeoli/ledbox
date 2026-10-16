"use client";

import { pendingStockCount } from "@/lib/stock-count";
import { useId, useMemo, useState } from "react";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { formatMoney, formatNumber } from "@/lib/admin-format";
import type { AdminInventoryListed } from "@/lib/admin-types";
import {
  FAMILY_MAX_AXES,
  commonNamePrefix,
  deriveFamilyCode,
  normalizeAxisKey,
  normalizeVariantText,
  readSwatch,
  variantDisplayName,
  variantKey,
  variantOptionsLabel,
  type FamilyAxis,
  type FamilyView,
} from "@/lib/inventory-variants";
import { NumberField, SelectField, TextField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminCell, AdminConfirmDialog, AdminDialog, AdminDialogSection, AdminNote, AdminRow, AdminTable } from "../AdminUI";

/**
 * Familias de variantes en el panel (docs/VARIANTES.md, etapa A): agrupar productos en una familia, la
 * pestaña «Variantes» de la ficha y «Agregar variante». El servidor es el único que escribe: acá solo se
 * arma el pedido y se muestra lo que responde (409 por combinación repetida, 404 por id ajeno).
 */

const FAMILIES_PATH = "/api/admin/inventory/families";

/** Muestra de color de un valor del eje «color»: un punto con el hex. Siempre va con el texto al lado. */
export function VariantSwatch({ color }: { color?: string | null }) {
  const hex = readSwatch(color);
  if (!hex) return null;
  return <span className="admin-fam-swatch" style={{ background: hex }} aria-hidden="true" />;
}

function swatchOf(axis: FamilyAxis | undefined, value: string | undefined): string | null {
  if (!axis || !value) return null;
  return axis.values.find((entry) => normalizeVariantText(entry.value) === normalizeVariantText(value))?.swatch ?? null;
}

/** Texto de las opciones de una variante con su muestra de color, para tablas y chips. */
export function VariantOptionsText({ axes, options }: { axes: readonly FamilyAxis[]; options: Record<string, string> }) {
  return (
    <span className="admin-fam-options">
      {axes.map((axis) => {
        const value = options[axis.key];
        if (!value) return null;
        return (
          <span key={axis.key} className="admin-fam-option">
            <VariantSwatch color={swatchOf(axis, value)} />
            {value}
          </span>
        );
      })}
    </span>
  );
}

// ── Agrupar en familia ──────────────────────────────────────────────────────

type GroupRow = { id: string; name: string; sku: string | null; values: [string, string]; swatches: [string, string] };

export type GroupableItem = { id: string; name: string; sku: string | null; familyId?: string | null; isCombo?: boolean };

/** Ventana «Agrupar en familia»: ejes, valor de cada producto y vista previa de los nombres que quedan. */
export function GroupFamilyDialog({ items, onClose, onDone }: { items: readonly GroupableItem[]; onClose: () => void; onDone: (message: string) => void }) {
  const formId = useId();
  const [name, setName] = useState(() => commonNamePrefix(items.map((item) => item.name)));
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [labels, setLabels] = useState<[string, string]>(["Color", ""]);
  const [rows, setRows] = useState<GroupRow[]>(() => items.map((item) => ({ id: item.id, name: item.name, sku: item.sku, values: ["", ""], swatches: ["", ""] })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeLabels = labels.map((label) => label.trim()).filter(Boolean);
  const axisKeys = labels.map((label) => normalizeAxisKey(label));
  const shownCode = codeTouched ? code : deriveFamilyCode(name);
  const blocked = items.filter((item) => item.familyId || item.isCombo);

  /** Ejes tal como se mandan: los valores únicos de cada columna, con la muestra del primer producto que la cargó. */
  const axes: FamilyAxis[] = useMemo(
    () =>
      labels.flatMap((label, axisIndex) => {
        if (!label.trim()) return [];
        const values: FamilyAxis["values"] = [];
        for (const row of rows) {
          const value = row.values[axisIndex].trim();
          if (!value) continue;
          const existing = values.find((entry) => normalizeVariantText(entry.value) === normalizeVariantText(value));
          const swatch = readSwatch(row.swatches[axisIndex]);
          if (existing) {
            if (!existing.swatch && swatch) existing.swatch = swatch;
          } else values.push(swatch && normalizeAxisKey(label) === "color" ? { value, swatch } : { value });
        }
        return [{ key: normalizeAxisKey(label), label: label.trim(), values }];
      }),
    [labels, rows],
  );

  function optionsOf(row: GroupRow) {
    return Object.fromEntries(labels.flatMap((label, index) => (label.trim() ? [[normalizeAxisKey(label), row.values[index].trim()]] : [])));
  }
  const previews = rows.map((row) => ({ row, after: name.trim() ? variantDisplayName(name, optionsOf(row), axes) : row.name }));
  const keys = rows.map((row) => variantKey(optionsOf(row), axes));
  const duplicate = keys.some((key, index) => keys.indexOf(key) !== index);
  const incomplete = rows.some((row) => labels.some((label, index) => label.trim() && !row.values[index].trim()));
  const sameAxis = activeLabels.length === 2 && axisKeys[0] === axisKeys[1];
  const problem = !name.trim() ? "Escribí el nombre de la familia." : activeLabels.length === 0 ? "Elegí al menos un eje, por ejemplo Color." : sameAxis ? "Los dos ejes tienen que ser distintos." : incomplete ? "Completá el valor de cada producto." : duplicate ? "Dos productos tienen la misma combinación: cambiá alguno." : blocked.length ? `«${blocked[0].name}» ${blocked[0].isCombo ? "es un combo y no puede ser variante" : "ya está en una familia"}.` : "";

  function setValue(rowId: string, axisIndex: 0 | 1, value: string) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, values: axisIndex === 0 ? [value, row.values[1]] : [row.values[0], value] } : row)));
  }
  function setSwatch(rowId: string, axisIndex: 0 | 1, value: string) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, swatches: axisIndex === 0 ? [value, row.swatches[1]] : [row.swatches[0], value] } : row)));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    const result = await adminSend<{ family?: FamilyView }>(FAMILIES_PATH, {
      name: name.trim(),
      code: shownCode,
      axes,
      members: rows.map((row) => ({ itemId: row.id, options: optionsOf(row) })),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(`Familia «${result.data.family?.name ?? name.trim()}» creada con ${rows.length} ${rows.length === 1 ? "variante" : "variantes"}.`);
  }

  const dirty = name.trim() !== commonNamePrefix(items.map((item) => item.name)) || rows.some((row) => row.values.some(Boolean));
  return (
    <AdminDialog
      title="Agrupar en familia"
      icon="inventory"
      size="lg"
      description="Productos que solo cambian en color, talle, etc. Cada uno conserva su stock, su foto y su precio."
      dirty={dirty && !busy}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Agrupando…" disabled={Boolean(problem)} title={problem || undefined}>
            Crear familia
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)}>
        <AdminDialogSection title="La familia" stack>
          <TextField label="Nombre de la familia" value={name} onChange={setName} maxLength={120} required placeholder="Ej.: Plato Arabesco" hint="Cada producto pasa a llamarse «Familia · opción»." disabled={busy} />
          <TextField
            label="Código de la familia"
            value={shownCode}
            onChange={(value) => {
              setCodeTouched(true);
              setCode(value);
            }}
            maxLength={60}
            hint="Es el link de la ficha en la tienda. No puede coincidir con el SKU de un producto."
            disabled={busy}
          />
        </AdminDialogSection>
        <AdminDialogSection title="Qué cambia entre productos" stack>
          <TextField label="Primer eje" value={labels[0]} onChange={(value) => setLabels([value, labels[1]])} maxLength={40} required placeholder="Color" disabled={busy} />
          <TextField label="Segundo eje (opcional)" value={labels[1]} onChange={(value) => setLabels([labels[0], value])} maxLength={40} optional placeholder="Talle" hint={`Hasta ${FAMILY_MAX_AXES} ejes.`} disabled={busy} />
        </AdminDialogSection>
        <AdminDialogSection title="Valor de cada producto" stack>
          <div className="admin-fam-rows">
            {previews.map(({ row, after }) => (
              <div key={row.id} className="admin-fam-row">
                <p className="admin-fam-row-title">
                  <strong>{row.name}</strong>
                  {row.sku ? <small className="admin-code"> · {row.sku}</small> : null}
                </p>
                <div className="admin-fam-row-fields">
                  {labels.map((label, index) =>
                    label.trim() ? (
                      <div key={index} className="admin-fam-row-pair">
                        <TextField label={label.trim()} value={row.values[index]} onChange={(value) => setValue(row.id, index as 0 | 1, value)} maxLength={40} required disabled={busy} />
                        {normalizeAxisKey(label) === "color" ? (
                          <TextField
                            label="Muestra (opcional)"
                            value={row.swatches[index]}
                            onChange={(value) => setSwatch(row.id, index as 0 | 1, value)}
                            maxLength={7}
                            placeholder="#4B6B3A"
                            error={row.swatches[index] && !readSwatch(row.swatches[index]) ? "Formato #RRGGBB" : null}
                            disabled={busy}
                          />
                        ) : null}
                      </div>
                    ) : null,
                  )}
                </div>
                <p className="admin-fam-preview" title={`Nombre actual: ${row.name}`}>
                  Quedará como <strong>{after}</strong>
                  {after !== row.name ? <small> (antes: {row.name})</small> : null}
                </p>
              </div>
            ))}
          </div>
        </AdminDialogSection>
        <AdminNote>Al agrupar se reescribe el nombre de cada producto; el nombre anterior queda en la auditoría. Las unidades, reservas y precios no cambian, y los presupuestos ya hechos conservan el nombre que tenían.</AdminNote>
      </form>
    </AdminDialog>
  );
}

// ── Agregar variante ────────────────────────────────────────────────────────

/** Ventana «Agregar variante»: copia cobro, precios, categoría y medidas de otra variante y pide código nuevo. */
export function AddVariantDialog({ family, referenceId, onClose, onDone }: { family: FamilyView; referenceId: string; onClose: () => void; onDone: (message: string) => void }) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sku, setSku] = useState("");
  const [units, setUnits] = useState("0");
  const [templateId, setTemplateId] = useState(referenceId || family.variants[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const template = family.variants.find((variant) => variant.id === templateId);
  const preview = variantDisplayName(family.name, Object.fromEntries(family.axes.map((axis) => [axis.key, (values[axis.key] ?? "").trim()])), family.axes);
  const missing = family.axes.find((axis) => !(values[axis.key] ?? "").trim());
  const taken = family.variants.some((variant) => variantKey(variant.options, family.axes) === variantKey(Object.fromEntries(family.axes.map((axis) => [axis.key, (values[axis.key] ?? "").trim()])), family.axes));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (missing) return setError(`Elegí un valor para «${missing.label}».`);
    if (taken) return setError("Esa combinación ya existe en la familia.");
    if (!sku.trim()) return setError("Escribí el código (SKU) de la variante nueva.");
    setBusy(true);
    setError("");
    const result = await adminSend<{ itemId?: string }>(`${FAMILIES_PATH}/${family.id}/variants`, {
      mode: "new",
      options: Object.fromEntries(family.axes.map((axis) => [axis.key, (values[axis.key] ?? "").trim()])),
      sku: sku.trim(),
      quantity: Number(units) || 0,
      templateItemId: templateId || undefined,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone(`Variante «${preview}» creada${Number(units) > 0 ? ` con ${formatNumber(Number(units))} unidades` : " sin unidades todavía"}.`);
  }

  return (
    <AdminDialog
      title="Agregar variante"
      icon="plus"
      size="md"
      description={`Un producto nuevo dentro de «${family.name}».`}
      dirty={!busy && (Object.values(values).some(Boolean) || Boolean(sku))}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Creando…" disabled={Boolean(missing) || taken || !sku.trim()}>
            Crear variante
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)}>
        <AdminDialogSection title="Opciones" stack>
          {family.axes.map((axis) => (
            <div key={axis.key}>
              <TextField
                label={axis.label}
                value={values[axis.key] ?? ""}
                onChange={(value) => setValues((current) => ({ ...current, [axis.key]: value }))}
                maxLength={40}
                required
                list={`${formId}-${axis.key}`}
                hint={axis.values.length ? `Ya están: ${axis.values.map((entry) => entry.value).join(", ")}. Podés escribir uno nuevo.` : undefined}
                disabled={busy}
              />
              <datalist id={`${formId}-${axis.key}`}>
                {axis.values.map((entry) => (
                  <option key={entry.value} value={entry.value} />
                ))}
              </datalist>
            </div>
          ))}
          <p className="admin-fam-preview">
            Se va a llamar <strong>{preview}</strong>
          </p>
          {taken ? <AdminNote tone="warn">Esa combinación ya existe en la familia.</AdminNote> : null}
        </AdminDialogSection>
        <AdminDialogSection title="Código y unidades" stack>
          <TextField label="Código (SKU)" value={sku} onChange={setSku} maxLength={60} required hint="Tiene que ser nuevo. Letras, números, espacios, puntos y guiones." disabled={busy} />
          <NumberField label="Unidades iniciales" value={units} onChange={setUnits} maxLength={3} disabled={busy} />
          <p className="admin-fam-preview">0 si todavía no las tenés: se cargan después desde «Unidades» en la ficha de la variante.</p>
        </AdminDialogSection>
        {family.variants.length > 1 ? (
          <SelectField
            label="Copiar cobro y precios de"
            value={templateId}
            onChange={setTemplateId}
            options={family.variants.map((variant) => ({ value: variant.id, label: variant.name }))}
            disabled={busy}
          />
        ) : null}
        <AdminNote>
          Copia el cobro, los precios (con sus escalones), la categoría y las medidas{template ? ` de «${template.name}»` : ""}. No copia la foto ni las unidades. Nace oculta en la tienda hasta que la publiques.
        </AdminNote>
      </form>
    </AdminDialog>
  );
}

// ── Editar la familia ───────────────────────────────────────────────────────

/** Nombre, código y muestras de color de la familia. Renombrar reescribe el nombre de todas las variantes. */
function EditFamilyDialog({ family, onClose, onDone }: { family: FamilyView; onClose: () => void; onDone: (message: string) => void }) {
  const formId = useId();
  const [name, setName] = useState(family.name);
  const [code, setCode] = useState(family.code);
  const [swatches, setSwatches] = useState<Record<string, string>>(() => Object.fromEntries(family.axes.flatMap((axis) => (axis.key === "color" ? axis.values.map((entry) => [entry.value, entry.swatch ?? ""]) : []))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const colorAxis = family.axes.find((axis) => axis.key === "color");
  const badSwatch = Object.values(swatches).some((value) => value && !readSwatch(value));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const axes = family.axes.map((axis) => (axis.key === "color" ? { ...axis, values: axis.values.map((entry) => ({ value: entry.value, swatch: swatches[entry.value] || undefined })) } : axis));
    const result = await adminSend<{ renamed?: unknown[] }>(`${FAMILIES_PATH}/${family.id}`, { name: name.trim(), code: code.trim(), axes }, "PATCH");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const renamed = result.data.renamed?.length ?? 0;
    onDone(renamed > 0 ? `Familia guardada: ${renamed} ${renamed === 1 ? "variante cambió" : "variantes cambiaron"} de nombre.` : "Familia guardada.");
  }

  return (
    <AdminDialog
      title="Editar familia"
      icon="edit"
      size="md"
      dirty={!busy && (name !== family.name || code !== family.code || JSON.stringify(swatches) !== JSON.stringify(Object.fromEntries((colorAxis?.values ?? []).map((entry) => [entry.value, entry.swatch ?? ""]))))}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Guardando…" disabled={!name.trim() || badSwatch}>
            Guardar
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)}>
        <AdminDialogSection title="Datos" stack>
          <TextField label="Nombre de la familia" value={name} onChange={setName} maxLength={120} required hint="Al guardar, todas las variantes pasan a llamarse «Nombre · opción»." disabled={busy} />
          <TextField label="Código de la familia" value={code} onChange={setCode} maxLength={60} required disabled={busy} />
        </AdminDialogSection>
        {colorAxis ? (
          <AdminDialogSection title="Muestras de color (opcional)" stack>
            {colorAxis.values.map((entry) => (
              <TextField
                key={entry.value}
                label={entry.value}
                value={swatches[entry.value] ?? ""}
                onChange={(value) => setSwatches((current) => ({ ...current, [entry.value]: value }))}
                maxLength={7}
                placeholder="#4B6B3A"
                optional
                prefix={swatches[entry.value] && readSwatch(swatches[entry.value]) ? "●" : undefined}
                error={swatches[entry.value] && !readSwatch(swatches[entry.value]) ? "Formato #RRGGBB" : null}
                disabled={busy}
              />
            ))}
          </AdminDialogSection>
        ) : null}
      </form>
    </AdminDialog>
  );
}

// ── Pestaña «Variantes» de la ficha ─────────────────────────────────────────

type TabProps = {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  familyId: string | null | undefined;
  isCombo: boolean;
  inventory: readonly AdminInventoryListed[];
  writable: boolean;
  onChanged: () => void;
  onOpenProduct: (id: string) => void;
  onGroup: (item: GroupableItem) => void;
};

export function InventoryVariantsTab({ itemId, itemName, itemSku, familyId, isCombo, inventory, writable, onChanged, onOpenProduct, onGroup }: TabProps) {
  const resource = useAdminResource(`${FAMILIES_PATH}/${familyId ?? "-"}`, (payload) => ((payload as { family?: FamilyView }).family ?? null), { enabled: Boolean(familyId) });
  const family = familyId ? resource.data : null;
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<"price" | "delete" | { unlink: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const free = useMemo(() => new Map(inventory.map((row) => [row.id, row.availability.availableNow])), [inventory]);

  function done(message: string) {
    setAddOpen(false);
    setEditOpen(false);
    setConfirm(null);
    setError("");
    setNotice(message);
    resource.reload();
    onChanged();
  }

  async function run(request: () => ReturnType<typeof adminSend<unknown>>, message: string) {
    setBusy(true);
    setError("");
    const result = await request();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    done(message);
  }

  if (!familyId) {
    return (
      <AdminDialogSection title="Variantes" stack>
        <AdminNote>
          {isCombo
            ? "Un combo no puede ser variante de una familia."
            : "Este producto no pertenece a una familia. Una familia agrupa productos que solo cambian en color, talle, etc., cada uno con su propio stock, foto y precio."}
        </AdminNote>
        {writable && !isCombo ? (
          <AdminButton icon="plus" variant="primary" onClick={() => onGroup({ id: itemId, name: itemName, sku: itemSku })}>
            Crear familia con este producto
          </AdminButton>
        ) : null}
      </AdminDialogSection>
    );
  }
  if (resource.loading && !family) return <AdminNote>Cargando las variantes…</AdminNote>;
  if (!family) return <AdminNote tone="error">{resource.error || "No encontramos la familia de este producto."}</AdminNote>;

  const pendingCounts = family.variants.filter(pendingStockCount).length;
  const totalUnits = family.variants.reduce((sum, variant) => sum + variant.quantity, 0);
  const totalFree = family.variants.reduce((sum, variant) => sum + (free.get(variant.id) ?? 0), 0);
  const knownFree = pendingCounts === 0 && family.variants.every((variant) => free.has(variant.id));
  const colorAxis = family.axes.find((axis) => axis.key === "color");

  return (
    <>
      <AdminDialogSection title={`Familia «${family.name}»`} stack>
        <p className="admin-fam-preview">
          Código <span className="admin-code">{family.code}</span> · {formatNumber(family.variants.length)} {family.variants.length === 1 ? "variante" : "variantes"} · {formatNumber(totalUnits)} {pendingCounts > 0 ? "unidades registradas" : "unidades"}
          {pendingCounts > 0 ? ` · ${formatNumber(pendingCounts)} ${pendingCounts === 1 ? "variante pendiente" : "variantes pendientes"} de conteo` : ""}
          {knownFree ? ` (${formatNumber(totalFree)} libres hoy)` : ""}
        </p>
        {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
        {error && !addOpen && !editOpen ? <AdminNote tone="error">{error}</AdminNote> : null}
        {writable ? (
          <span className="admin-actions admin-fam-actions">
            <AdminButton icon="plus" variant="primary" onClick={() => setAddOpen(true)} aria-haspopup="dialog">
              Agregar variante
            </AdminButton>
            <AdminButton icon="edit" onClick={() => setEditOpen(true)} aria-haspopup="dialog">
              Editar familia
            </AdminButton>
            <AdminButton icon="check" onClick={() => setConfirm("price")} title="Copia los precios de esta variante a las demás que no tienen precio propio">
              Mismo precio para todas
            </AdminButton>
            <AdminButton icon="trash" onClick={() => setConfirm("delete")} title="Deshace la familia: las variantes quedan como productos sueltos">
              Eliminar familia
            </AdminButton>
          </span>
        ) : null}
        <AdminTable
          view="inventario-variantes"
          label={`Variantes de ${family.name}`}
          columns={[{ label: "Variante" }, { label: "Código" }, { label: "Stock", end: true }, { label: "Precio", end: true }, { label: "Acciones", end: true }]}
        >
          {family.variants.map((variant) => {
            const here = variant.id === itemId;
            const libres = free.get(variant.id);
            return (
              <AdminRow key={variant.id}>
                <AdminCell title={variant.name}>
                  <AdminButton variant="link" className="admin-fam-open" onClick={() => onOpenProduct(variant.id)} title={`Abrir la ficha de ${variant.name}`} aria-current={here ? "true" : undefined}>
                    <span className="admin-inv-product-text">
                      <strong>
                        <VariantOptionsText axes={family.axes} options={variant.options} />
                      </strong>
                      <small>{here ? "Estás viendo esta" : variant.name}</small>
                    </span>
                  </AdminButton>
                </AdminCell>
                <AdminCell title={variant.sku ?? "Sin SKU"}>
                  <span className="admin-code">{variant.sku ?? "—"}</span>
                </AdminCell>
                <AdminCell end title={pendingStockCount(variant) ? `Total pendiente de conteo · ${variant.quantity} unidades registradas` : libres === undefined ? `${variant.quantity} unidades` : `${libres} libres hoy de ${variant.quantity}`}>
                  {pendingStockCount(variant) ? <><span>Pendiente de conteo</span><small className="admin-cell-sub">{formatNumber(variant.quantity)} {variant.quantity === 1 ? "registrada" : "registradas"}</small></> : libres === undefined ? formatNumber(variant.quantity) : `${formatNumber(libres)} / ${formatNumber(variant.quantity)}`}
                </AdminCell>
                <AdminCell end title={variant.ownPrice ? "Precio propio: «Mismo precio para todas» no lo pisa" : "Sigue el precio de la familia"}>
                  {variant.listPrice > 0 ? formatMoney(variant.listPrice) : "A consultar"}
                  {variant.ownPrice ? (
                    <>
                      {" "}
                      <AdminBadge size="sm" tone="info">
                        Propio
                      </AdminBadge>
                    </>
                  ) : null}
                </AdminCell>
                <AdminCell end className="admin-cell--actions">
                  <span className="admin-actions">
                    <AdminButton icon="arrow-right" title={`Abrir la ficha de ${variant.name}`} aria-label={`Abrir la ficha de ${variant.name}`} onClick={() => onOpenProduct(variant.id)} />
                    {writable ? (
                      <AdminButton icon="close" title={`Desvincular ${variant.name} de la familia`} aria-label={`Desvincular ${variant.name} de la familia`} onClick={() => setConfirm({ unlink: variant.id })} />
                    ) : null}
                  </span>
                </AdminCell>
              </AdminRow>
            );
          })}
        </AdminTable>
        {colorAxis && colorAxis.values.some((entry) => entry.swatch) ? <p className="admin-fam-legend">Las muestras de color acompañan siempre al nombre del color.</p> : null}
        <AdminNote>
          Cada variante es un producto completo: se reserva, se cuenta y se presupuesta por separado. La familia solo las agrupa. Las unidades se cargan en la ficha de cada variante.
        </AdminNote>
      </AdminDialogSection>

      {addOpen ? <AddVariantDialog family={family} referenceId={itemId} onClose={() => setAddOpen(false)} onDone={done} /> : null}
      {editOpen ? <EditFamilyDialog family={family} onClose={() => setEditOpen(false)} onDone={done} /> : null}
      {confirm === "price" ? (
        <AdminConfirmDialog
          title="Mismo precio para todas"
          icon="check"
          message={`Se copian los precios (lista, mayorista, mínimo, cobro y escalones) de la variante que estás viendo a las demás de la familia que no tienen precio propio. Las que tienen precio propio no se tocan.`}
          confirmLabel="Aplicar"
          busyLabel="Aplicando…"
          busy={busy}
          error={error || null}
          onConfirm={() =>
            void run(
              () => adminSend(`${FAMILIES_PATH}/${family.id}`, { kind: "same-price", sourceItemId: itemId }),
              "Listo: las variantes sin precio propio ahora tienen el mismo precio.",
            )
          }
          onClose={() => (busy ? undefined : setConfirm(null))}
        />
      ) : null}
      {confirm === "delete" ? (
        <AdminConfirmDialog
          title="Eliminar la familia"
          danger
          message={`«${family.name}» se manda a la papelera y sus ${family.variants.length} variantes quedan como productos sueltos, con su nombre, stock y precio. No se borra ningún producto ni se toca el stock.`}
          confirmLabel="Eliminar familia"
          busyLabel="Eliminando…"
          busy={busy}
          error={error || null}
          onConfirm={() => void run(() => adminSend(`${FAMILIES_PATH}/${family.id}`, {}, "DELETE"), "Familia eliminada: las variantes quedaron como productos sueltos.")}
          onClose={() => (busy ? undefined : setConfirm(null))}
        />
      ) : null}
      {confirm && typeof confirm === "object" ? (
        <AdminConfirmDialog
          title="Desvincular de la familia"
          message={`«${family.variants.find((variant) => variant.id === confirm.unlink)?.name ?? "La variante"}» vuelve a ser un producto suelto, con su nombre completo, stock y precio.`}
          confirmLabel="Desvincular"
          busyLabel="Desvinculando…"
          busy={busy}
          error={error || null}
          onConfirm={() => void run(() => adminSend(`${FAMILIES_PATH}/${family.id}/variants/${confirm.unlink}`, {}, "DELETE"), "Variante desvinculada: quedó como producto suelto.")}
          onClose={() => (busy ? undefined : setConfirm(null))}
        />
      ) : null}
    </>
  );
}

/** Texto corto de las opciones («Negro · 35») para chips y listas. */
export function optionsText(axes: readonly FamilyAxis[], options: Record<string, string> | null | undefined): string {
  return options ? variantOptionsLabel(options, axes) : "";
}
