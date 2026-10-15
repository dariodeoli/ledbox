"use client";

import { useId, useMemo, useState } from "react";
import { formatNumber } from "@/lib/admin-format";
import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
  inventoryImageError,
  inventoryImageValid,
  inventoryPriceValue,
  inventoryPriceWarning,
  inventorySkuError,
  personNameValid,
  readInventoryPriceValues,
  type InventoryPriceValues,
} from "@/lib/field-rules";
import type { AdminApiResponse, AdminInventoryItemRow } from "@/lib/admin-types";
import type { PreparedInventoryPhoto } from "@/lib/inventory-image";
import { adminApiUpload, adminSend } from "@/lib/admin-api";
import { CATALOG_AUDIENCE_OPTIONS, effectiveAudience, type CatalogAudience } from "@/lib/catalog-audience";
import { BILLING_UNIT_OPTIONS, INVENTORY_FIELD_HELP } from "@/lib/inventory-bulk";
import { AdminButton, AdminDialog, AdminDialogSection, AdminDisclosure, AdminNote } from "../AdminUI";
import { AttachmentInput, Combobox, MoneyField, NumberField, SegmentedField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { InventoryThumb, KIND_PICK_OPTIONS, STATUS_PICK_OPTIONS } from "./InventoryParts";
import {
  CategoryPicker,
  EMPTY_PRODUCT_TRACE,
  ProductTraceFields,
  categoryFormFromText,
  dayKeyOf,
  type InventoryTaxonomy,
} from "./InventoryTaxonomy";

/** Aviso del alta o la edición: el tono lo decide si hubo algo que advertir. */
export type InventoryNotice = { message: string; tone: "ok" | "warn" };

const EMPTY_FORM = {
  name: "",
  category: "",
  /** Segundo nivel (opcional): «Vajilla › Copas». */
  subcategory: "",
  ...EMPTY_PRODUCT_TRACE,
  /** SKU opcional del alta (issue #131), detrás de «Más datos». */
  sku: "",
  inventoryKind: "REUSABLE",
  quantity: "1",
  /** Alcance en la tienda web: arranca oculto, nada se publica solo. */
  catalogAudience: "HIDDEN" as CatalogAudience,
  imageUrl: "",
  /** «Se cobra»: por día (default) o por evento. */
  billingUnit: "DAILY",
  listPrice: "",
  listFromDays: "0",
  listFromPrice: "",
  wholesalePrice: "",
  wholesaleFromDays: "0",
  wholesaleFromPrice: "",
  minimumPrice: "",
};

/** Precios de los formularios (issues #90 y #110), en el contrato de `MoneyField`. */
const EMPTY_PRICES = {
  listPrice: "",
  listFromDays: "0",
  listFromPrice: "",
  wholesalePrice: "",
  wholesaleFromDays: "0",
  wholesaleFromPrice: "",
  minimumPrice: "",
};

/** Ítem completo en edición (issue #111): datos, costos, notas, foto y precios. */
const EMPTY_EDIT = {
  name: "",
  category: "",
  subcategory: "",
  ...EMPTY_PRODUCT_TRACE,
  inventoryKind: "REUSABLE",
  status: "AVAILABLE",
  replacementCost: "",
  dailyCost: "",
  notes: "",
  publicDescription: "",
  catalogAudience: "HIDDEN" as CatalogAudience,
  imageUrl: "",
  /** Tiempo antes/después del evento en horas; vacío hereda el de la empresa. */
  bufferBeforeHours: "",
  bufferAfterHours: "",
  billingUnit: "DAILY",
  ...EMPTY_PRICES,
};

/** Minutos guardados → horas del campo (vacío = hereda; no entero se redondea hacia arriba solo para mostrar). */
const bufferHoursText = (minutes: number | null | undefined) =>
  typeof minutes === "number" ? String(Math.ceil(minutes / 60)) : "";

type InventoryEditForm = typeof EMPTY_EDIT;

/** El formulario de edición con los valores actuales del ítem. */
function editFormFromItem(item: AdminInventoryItemRow): InventoryEditForm {
  return {
    name: item.name,
    // El espejo de texto trae «Categoría › Subcategoría»: se parte para los dos campos.
    ...categoryFormFromText(item.category),
    defaultWarehouseId: item.defaultWarehouseId ?? "",
    defaultLocation: item.defaultLocation ?? "",
    supplierId: item.supplierId ?? "",
    purchasedAt: dayKeyOf(item.purchasedAt),
    warrantyUntil: dayKeyOf(item.warrantyUntil),
    inventoryKind: item.kind,
    status: item.status,
    replacementCost: item.replacementCost > 0 ? String(item.replacementCost) : "",
    dailyCost: item.dailyCost > 0 ? String(item.dailyCost) : "",
    notes: item.notes ?? "",
    publicDescription: item.publicDescription ?? "",
    catalogAudience: effectiveAudience(item),
    bufferBeforeHours: bufferHoursText(item.bufferBeforeMin),
    bufferAfterHours: bufferHoursText(item.bufferAfterMin),
    billingUnit: item.billingUnit === "EVENT" ? "EVENT" : "DAILY",
    // La caja de la URL manual no precarga la ruta de la foto subida: son cosas
    // distintas (la subida se cambia o se quita con sus botones).
    imageUrl: item.imageUploaded ? "" : item.imageUrl ?? "",
    listPrice: item.listPrice > 0 ? String(item.listPrice) : "",
    listFromDays: String(item.listFromDays),
    listFromPrice: item.listFromPrice > 0 ? String(item.listFromPrice) : "",
    wholesalePrice: item.wholesalePrice > 0 ? String(item.wholesalePrice) : "",
    wholesaleFromDays: String(item.wholesaleFromDays),
    wholesaleFromPrice: item.wholesaleFromPrice > 0 ? String(item.wholesaleFromPrice) : "",
    minimumPrice: item.minimumPrice > 0 ? String(item.minimumPrice) : "",
  };
}

/** Aviso suave de coherencia de los precios de un formulario (issues #90 y #110). */
function priceWarningFor(values: InventoryPriceValues): string | null {
  return inventoryPriceWarning({
    listPrice: values.listPrice ?? 0,
    listFromPrice: values.listFromPrice ?? 0,
    wholesalePrice: values.wholesalePrice ?? 0,
    wholesaleFromPrice: values.wholesaleFromPrice ?? 0,
    minimumPrice: values.minimumPrice ?? 0,
  });
}

/**
 * Bloque de precios de un frente (issue #110): precio normal, umbral «desde X
 * días» (input chiquito: son días) y precio desde esos días. Lo comparten el
 * alta y la edición, así la regla se carga igual en los dos lados.
 */
function PriceFrontFields({
  title,
  normalValue,
  daysValue,
  fromValue,
  onNormal,
  onDays,
  onFrom,
}: {
  title: string;
  normalValue: string;
  daysValue: string;
  fromValue: string;
  onNormal: (value: string) => void;
  onDays: (value: string) => void;
  onFrom: (value: string) => void;
}) {
  return (
    <div className="admin-form-group admin-form-group--prices">
      <span className="admin-form-group-title">{title}</span>
      <MoneyField
        label="Precio normal"
        help={`${title}: tarifa normal de este segmento; la duración no cambia el segmento del cliente.`}
        value={normalValue}
        onChange={onNormal}
        hint="En guaraníes; vacío o 0 = sin cargar."
      />
      <NumberField
        label="Desde (días)"
        help="Umbral de duración para este frente de precios; 0 desactiva su regla."
        maxLength={4}
        value={daysValue}
        onChange={onDays}
        hint="0 = sin regla."
      />
      <MoneyField
        label="Precio desde esos días"
        help={`${title}: tarifa desde su propio umbral de días, independiente del otro segmento.`}
        value={fromValue}
        onChange={onFrom}
        hint="Vacío o 0 = sin precio por duración."
      />
    </div>
  );
}

/**
 * Bloque de foto del ítem (issue #109, editable desde #111): URL manual o
 * archivo subido (uno de los dos), con vista previa en la caja uniforme y
 * «Quitar foto». Lo comparten el alta y la edición; cada una maneja su estado
 * con los callbacks.
 */
function PhotoFields({
  urlValue,
  onUrlChange,
  previewUrl,
  hasPhoto,
  onSelectFile,
  onClearPhoto,
  error,
  disabled,
}: {
  urlValue: string;
  onUrlChange: (value: string) => void;
  previewUrl: string | null;
  hasPhoto: boolean;
  onSelectFile: (file: File | null) => void;
  onClearPhoto: () => void;
  error: string;
  disabled?: boolean;
}) {
  return (
    <div className="admin-form-group admin-form-group--photo">
      <span className="admin-form-group-title">Foto</span>
      <TextField
        label="Imagen (URL)"
        help={INVENTORY_FIELD_HELP.imageUrl}
        maxLength={FIELD_LIMITS.image}
        value={urlValue}
        onChange={onUrlChange}
        placeholder="Ej.: /assets/products/pantalla-led.png"
        hint="Ruta interna (/assets/…) o URL http(s). Opcional."
        inputMode="url"
        autoCapitalize="none"
      />
      <AttachmentInput
        label="Subir foto"
        help="Foto del producto: se valida el contenido y se comprime antes de guardar."
        accept="image/jpeg,image/png,image/webp"
        maxBytes={10 * 1024 * 1024}
        hint="JPG, PNG o WebP; se comprime en el navegador (hasta 2 MB)."
        disabled={disabled}
        error={error}
        onSelect={onSelectFile}
      />
      <div className="admin-field">
        <span className="admin-field-label">Vista previa</span>
        <span className="admin-photo-preview">
          <span className="admin-image-preview">
            <InventoryThumb item={{ imageUrl: previewUrl }} size={64} />
          </span>
          {hasPhoto ? (
            <AdminButton
              icon="trash"
              type="button"
              title="Quitar la foto del ítem"
              aria-label="Quitar la foto del ítem"
              onClick={onClearPhoto}
            >
              Quitar foto
            </AdminButton>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** Alta de un producto (issues #109, #110 y #131). Las unidades se crean con código automático. */
export function InventoryCreateDialog({
  taxonomy,
  onClose,
  onCreated,
}: {
  taxonomy: InventoryTaxonomy;
  onClose: () => void;
  onCreated: (notice: InventoryNotice) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // Foto del alta (issue #109): archivo ya comprimido en el navegador, listo
  // para subir después de crear el ítem (necesita su id).
  const [pendingPhoto, setPendingPhoto] = useState<PreparedInventoryPhoto | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const createFormId = useId();
  const createDirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM) || Boolean(pendingPhoto);

  // Aviso de coherencia de precios (issues #90 y #110): se ve mientras se cargan
  // (el guardado no se bloquea; el API devuelve el mismo aviso).
  const formPriceWarning = useMemo(() => {
    const prices = readInventoryPriceValues(form);
    return prices.ok ? priceWarningFor(prices.values) : null;
  }, [form]);

  // Foto del alta: el archivo elegido manda; si no, la URL manual válida.
  const manualImage = inventoryImageValid(form.imageUrl.trim()) ? form.imageUrl.trim() : null;
  const photoPreview = pendingPhoto?.dataUrl ?? manualImage;
  const hasPhoto = Boolean(pendingPhoto) || Boolean(form.imageUrl.trim());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setPhotoError("");
    // Nombre y SKU con las reglas del kit (issue #131): mismo mensaje que el API.
    if (!personNameValid(form.name)) {
      setFormError(FIELD_MESSAGES.name);
      return;
    }
    const sku = form.sku.trim();
    if (sku && inventorySkuError(sku)) {
      setFormError(FIELD_MESSAGES.sku);
      return;
    }
    const image = form.imageUrl.trim();
    const imageError = inventoryImageError(image);
    if (imageError) {
      setFormError(imageError);
      return;
    }
    const prices = readInventoryPriceValues(form);
    if (!prices.ok) {
      setFormError(prices.error);
      return;
    }
    setBusy(true);
    // El alta de ítems vive en `/api/admin/resources` (contrato existente del panel).
    const result = await adminSend<{ inventory?: { id?: string }; warning?: string }>("/api/admin/resources", {
      kind: "inventory",
      name: form.name,
      category: form.category || "General",
      subcategory: form.subcategory || undefined,
      defaultWarehouseId: form.defaultWarehouseId || undefined,
      defaultLocation: form.defaultLocation || undefined,
      supplierId: form.supplierId || undefined,
      purchasedAt: form.purchasedAt || undefined,
      warrantyUntil: form.warrantyUntil || undefined,
      sku: sku || undefined,
      inventoryKind: form.inventoryKind,
      quantity: Number(form.quantity) || 1,
      catalogAudience: form.catalogAudience,
      imageUrl: image,
      billingUnit: form.billingUnit,
      listPrice: prices.values.listPrice ?? 0,
      listFromDays: prices.values.listFromDays ?? 0,
      listFromPrice: prices.values.listFromPrice ?? 0,
      wholesalePrice: prices.values.wholesalePrice ?? 0,
      wholesaleFromDays: prices.values.wholesaleFromDays ?? 0,
      wholesaleFromPrice: prices.values.wholesaleFromPrice ?? 0,
      minimumPrice: prices.values.minimumPrice ?? 0,
    });
    if (!result.ok) {
      setBusy(false);
      setFormError(result.error);
      return;
    }

    // La foto necesita el id del ítem: recién creado se sube (issue #109). Si
    // falla, el ítem ya quedó y se avisa tal cual; la foto se reintenta después.
    let photoWarning = "";
    const createdId = result.data.inventory?.id ?? "";
    if (createdId && pendingPhoto) {
      const photoForm = new FormData();
      photoForm.append("file", pendingPhoto.blob, pendingPhoto.fileName);
      const upload = await adminApiUpload(`/api/admin/inventory/${createdId}/image`, photoForm);
      if (!upload.ok) photoWarning = ` La foto no se pudo subir: ${upload.error}`;
    }
    setBusy(false);

    // El aviso de precios incoherentes no bloquea el alta: se muestra tal cual.
    const warning = typeof result.data.warning === "string" ? result.data.warning : "";
    onCreated({
      message: `Producto «${form.name}» cargado.${warning ? ` ${warning}` : ""}${photoWarning}`,
      tone: warning || photoWarning ? "warn" : "ok",
    });
  }

  /** Elige y comprime la foto del alta en el navegador (issue #109). */
  async function selectPhotoFile(file: File | null) {
    if (!file) return;
    setPhotoError("");
    setPhotoBusy(true);
    try {
      // El pipeline de imagen (canvas + magic bytes) se carga recién acá.
      const { prepareInventoryPhoto } = await import("@/lib/inventory-image");
      const result = await prepareInventoryPhoto(file);
      if (!result.ok) {
        setPhotoError(result.error);
        return;
      }
      // Un solo origen: la foto elegida reemplaza la URL escrita.
      setPendingPhoto(result.photo);
      setForm((current) => ({ ...current, imageUrl: "" }));
    } finally {
      setPhotoBusy(false);
    }
  }

  /** Saca la foto del alta: la elegida o la URL manual. */
  function clearPhoto() {
    setPendingPhoto(null);
    setPhotoError("");
    setForm((current) => ({ ...current, imageUrl: "" }));
  }

  return (
    <AdminDialog
      title="Nuevo producto"
      icon="inventory"
      size="wide"
      description="Se crean las unidades con código automático. Precios y foto se pueden completar después."
      dirty={createDirty}
      error={formError}
      warning={formPriceWarning}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="submit" form={createFormId} busy={busy || photoBusy} busyLabel="Guardando…">
            Cargar producto
          </AdminButton>
        </>
      )}
    >
      <form id={createFormId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || photoBusy || undefined}>
        {/* Datos del ítem (issues #109 y #131): campos finos; la cantidad va
            corta, el SKU vive en «Más datos» y precios y foto van plegados. */}
        <AdminDialogSection title="Datos">
          <TextField
            label="Artículo"
            help={INVENTORY_FIELD_HELP.name}
            required
            wide
            autoFocus
            maxLength={120}
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
            placeholder="Ej.: Pantalla LED P3.9 500×500"
          />
          <CategoryPicker
            tree={taxonomy.tree}
            category={form.category}
            subcategory={form.subcategory}
            onChange={(next) => setForm((current) => ({ ...current, ...next }))}
          />
          <SelectField
            label="Tipo"
            help={INVENTORY_FIELD_HELP.inventoryKind}
            value={form.inventoryKind}
            onChange={(value) => setForm({ ...form, inventoryKind: value })}
            options={KIND_PICK_OPTIONS}
          />
          <NumberField
            label="Cantidad"
            help="Crea esta cantidad de unidades físicas con códigos automáticos; después se gestiona por unidad."
            required
            maxLength={6}
            value={form.quantity}
            onChange={(value) => setForm({ ...form, quantity: value })}
            hint="Se crean las unidades con código automático."
          />
        </AdminDialogSection>

        <AdminDialogSection title="Depósito y compra" collapsible hint="dónde se guarda, proveedor y garantía">
          <ProductTraceFields taxonomy={taxonomy} value={form} onChange={(next) => setForm((current) => ({ ...current, ...next }))} disabled={busy} />
        </AdminDialogSection>

        {/* Precios por frente (issue #110): normal, umbral «desde X días» y
            precio desde esos días; el mínimo es el piso de venta. */}
        <AdminDialogSection title="Precios" collapsible hint="final, mayorista y mínimo">
          <SegmentedField
            label="Se cobra"
            help={INVENTORY_FIELD_HELP.billingUnit}
            value={form.billingUnit}
            onChange={(value) => setForm({ ...form, billingUnit: value })}
            options={[...BILLING_UNIT_OPTIONS]}
            hint="Por evento: el precio no se multiplica por los días."
          />
          <PriceFrontFields
            title="Precio cliente final"
            normalValue={form.listPrice}
            daysValue={form.listFromDays}
            fromValue={form.listFromPrice}
            onNormal={(value) => setForm({ ...form, listPrice: value })}
            onDays={(value) => setForm({ ...form, listFromDays: value })}
            onFrom={(value) => setForm({ ...form, listFromPrice: value })}
          />
          <PriceFrontFields
            title="Precio mayorista"
            normalValue={form.wholesalePrice}
            daysValue={form.wholesaleFromDays}
            fromValue={form.wholesaleFromPrice}
            onNormal={(value) => setForm({ ...form, wholesalePrice: value })}
            onDays={(value) => setForm({ ...form, wholesaleFromDays: value })}
            onFrom={(value) => setForm({ ...form, wholesaleFromPrice: value })}
          />
          <div className="admin-form-group admin-form-group--min">
            <span className="admin-form-group-title">Precio mínimo</span>
            <MoneyField
              label="Piso de venta"
              help={INVENTORY_FIELD_HELP.minimumPrice}
              value={form.minimumPrice}
              onChange={(value) => setForm({ ...form, minimumPrice: value })}
              hint="Piso de venta del ítem."
            />
          </div>
        </AdminDialogSection>
        {/* Foto (issue #109): URL manual o archivo subido (uno de los dos). */}
        <AdminDialogSection title="Fotos" collapsible hint="foto y visibilidad en la tienda">
          <PhotoFields
            urlValue={form.imageUrl}
            onUrlChange={(value) => {
              setPendingPhoto(null);
              setPhotoError("");
              setForm({ ...form, imageUrl: value });
            }}
            previewUrl={photoPreview}
            hasPhoto={hasPhoto}
            onSelectFile={(file) => void selectPhotoFile(file)}
            onClearPhoto={clearPhoto}
            error={photoError}
            disabled={busy || photoBusy}
          />
          <SegmentedField
            label="Visibilidad en la tienda"
            help={INVENTORY_FIELD_HELP.catalogAudience}
            value={form.catalogAudience}
            onChange={(value) => setForm({ ...form, catalogAudience: value as CatalogAudience })}
            options={[...CATALOG_AUDIENCE_OPTIONS]}
            hint="Oculto no se publica. Mayorista solo se ve con el link privado de cada cliente."
          />
        </AdminDialogSection>

        {/* SKU opcional (issue #131): lo avanzado va plegado en «Más opciones». */}
        <AdminDialogSection title="Más opciones" collapsible hint="SKU">
          <TextField
            label="SKU"
            help="Código opcional del producto, distinto del código único de cada unidad física."
            maxLength={FIELD_LIMITS.sku}
            value={form.sku}
            onChange={(value) => setForm({ ...form, sku: value })}
            placeholder="Ej.: LED-P3-500"
            hint="Opcional; ayuda a cruzar el catálogo."
            error={inventorySkuError(form.sku)}
          />
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}

/** Edición completa del producto (issues #90, #110 y #111): datos, costos, notas, foto y precios. */
export function InventoryEditDialog({
  item,
  taxonomy,
  onClose,
  onSaved,
  onOpenUnits,
}: {
  item: AdminInventoryItemRow;
  taxonomy: InventoryTaxonomy;
  onClose: () => void;
  onSaved: (notice: InventoryNotice) => void;
  /** Abre la ficha del producto, donde se gestionan las unidades. */
  onOpenUnits: (itemId: string) => void;
}) {
  const [editForm, setEditForm] = useState<InventoryEditForm>(() => editFormFromItem(item));
  // Línea base congelada al abrir: una recarga del padre no cambia el diff de los buffers.
  const [baseForm] = useState<InventoryEditForm>(() => editFormFromItem(item));
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editPendingPhoto, setEditPendingPhoto] = useState<PreparedInventoryPhoto | null>(null);
  /** La foto subida del ítem se quita al guardar (issue #111). */
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const [editPhotoError, setEditPhotoError] = useState("");
  const editFormId = useId();
  // «Más opciones» abre de entrada solo si el producto ya tiene algo cargado ahí.
  const advancedOpen = [baseForm.replacementCost, baseForm.dailyCost, baseForm.notes, baseForm.bufferBeforeHours, baseForm.bufferAfterHours].some(
    (value) => Boolean(value) && value !== "0",
  );
  const editDirty = JSON.stringify(editForm) !== JSON.stringify(baseForm) || Boolean(editPendingPhoto) || editPhotoRemoved;

  const editPriceWarning = useMemo(() => {
    const prices = readInventoryPriceValues(editForm);
    return prices.ok ? priceWarningFor(prices.values) : null;
  }, [editForm]);

  // Foto en edición (issue #111): la nueva elegida manda; si no, la manual; si
  // no, la subida del ítem (salvo que se haya pedido quitarla).
  const editManualImage = inventoryImageValid(editForm.imageUrl.trim()) ? editForm.imageUrl.trim() : null;
  const editPhotoPreview =
    editPendingPhoto?.dataUrl ?? editManualImage ?? (!editPhotoRemoved && item.imageUploaded ? item.imageUrl : null);
  const editHasPhoto = Boolean(editPendingPhoto) || Boolean(editForm.imageUrl.trim()) || Boolean(editPhotoPreview);

  /** Elige y comprime la foto de la edición en el navegador (issue #111). */
  async function selectEditPhoto(file: File | null) {
    if (!file) return;
    setEditPhotoError("");
    setEditBusy(true);
    try {
      const { prepareInventoryPhoto } = await import("@/lib/inventory-image");
      const result = await prepareInventoryPhoto(file);
      if (!result.ok) {
        setEditPhotoError(result.error);
        return;
      }
      setEditPendingPhoto(result.photo);
      setEditPhotoRemoved(false);
      setEditForm((current) => ({ ...current, imageUrl: "" }));
    } finally {
      setEditBusy(false);
    }
  }

  /** Saca la foto en la edición: la nueva, la URL manual o la subida. */
  function clearEditPhoto() {
    setEditPendingPhoto(null);
    setEditPhotoError("");
    setEditForm((current) => ({ ...current, imageUrl: "" }));
    // La subida se borra recién al guardar, avisando que estaba puesta.
    setEditPhotoRemoved(Boolean(item.imageUploaded));
  }

  /** Guarda el ítem completo: datos, precios y foto (issues #90, #110 y #111). */
  async function submitEditItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError("");
    if (!editForm.name.trim()) {
      setEditError("Ingresá el nombre del artículo.");
      return;
    }
    const image = editForm.imageUrl.trim();
    const imageError = inventoryImageError(image);
    if (imageError) {
      setEditError(imageError);
      return;
    }
    const prices = readInventoryPriceValues(editForm);
    if (!prices.ok) {
      setEditError(prices.error);
      return;
    }
    const replacementCost = inventoryPriceValue(editForm.replacementCost);
    const dailyCost = inventoryPriceValue(editForm.dailyCost);
    if (replacementCost === false || dailyCost === false) {
      setEditError(FIELD_MESSAGES.price);
      return;
    }

    setEditBusy(true);
    const original = baseForm;
    // Datos del ítem (issue #111) y después precios (issues #90 y #110).
    const itemResult = await adminSend<{ inventory?: { id?: string } }>("/api/admin/inventory", {
      kind: "item",
      id: item.id,
      name: editForm.name,
      category: editForm.category || "General",
      subcategory: editForm.subcategory,
      defaultWarehouseId: editForm.defaultWarehouseId,
      defaultLocation: editForm.defaultLocation,
      supplierId: editForm.supplierId,
      purchasedAt: editForm.purchasedAt,
      warrantyUntil: editForm.warrantyUntil,
      inventoryKind: editForm.inventoryKind,
      status: editForm.status,
      replacementCost: replacementCost ?? 0,
      dailyCost: dailyCost ?? 0,
      notes: editForm.notes,
      publicDescription: editForm.publicDescription,
      catalogAudience: editForm.catalogAudience,
      imageUrl: image,
      billingUnit: editForm.billingUnit,
      // Solo se mandan los tiempos que la persona cambió (no se pisa un valor en minutos no enteros).
      ...(editForm.bufferBeforeHours !== original.bufferBeforeHours
        ? { bufferBeforeMin: editForm.bufferBeforeHours === "" ? null : Number(editForm.bufferBeforeHours) * 60 }
        : {}),
      ...(editForm.bufferAfterHours !== original.bufferAfterHours
        ? { bufferAfterMin: editForm.bufferAfterHours === "" ? null : Number(editForm.bufferAfterHours) * 60 }
        : {}),
    });
    if (!itemResult.ok) {
      setEditBusy(false);
      setEditError(itemResult.error);
      return;
    }

    const priceResult = await adminSend<AdminApiResponse>("/api/admin/inventory", {
      kind: "prices",
      id: item.id,
      listPrice: prices.values.listPrice ?? 0,
      listFromDays: prices.values.listFromDays ?? 0,
      listFromPrice: prices.values.listFromPrice ?? 0,
      wholesalePrice: prices.values.wholesalePrice ?? 0,
      wholesaleFromDays: prices.values.wholesaleFromDays ?? 0,
      wholesaleFromPrice: prices.values.wholesaleFromPrice ?? 0,
      minimumPrice: prices.values.minimumPrice ?? 0,
    });
    const warnings: string[] = [];
    if (!priceResult.ok) warnings.push(`Los precios no se guardaron: ${priceResult.error}`);
    else if (typeof priceResult.data.warning === "string" && priceResult.data.warning) warnings.push(priceResult.data.warning);

    // Foto (issue #109): se cambia subiendo la nueva o se quita la subida.
    if (editPendingPhoto) {
      const photoForm = new FormData();
      photoForm.append("file", editPendingPhoto.blob, editPendingPhoto.fileName);
      const upload = await adminApiUpload(`/api/admin/inventory/${item.id}/image`, photoForm);
      if (!upload.ok) warnings.push(`La foto no se pudo subir: ${upload.error}`);
    } else if (editPhotoRemoved && item.imageUploaded) {
      const removed = await adminSend(`/api/admin/inventory/${item.id}/image`, {}, "DELETE");
      if (!removed.ok) warnings.push(`La foto no se pudo quitar: ${removed.error}`);
    }
    setEditBusy(false);

    onSaved({
      message: `Producto «${editForm.name}» guardado.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      tone: warnings.length ? "warn" : "ok",
    });
  }

  return (
    <AdminDialog
      title={`Editar producto · ${editForm.name || item.name}`}
      icon="inventory"
      size="wide"
      description="Datos, foto, costos y precios del producto. La cantidad se gestiona por unidad."
      dirty={editDirty}
      error={editError}
      warning={editPriceWarning}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={editBusy}>
            Cancelar
          </AdminButton>
          <AdminButton variant="primary" icon="check" type="submit" form={editFormId} busy={editBusy} busyLabel="Guardando…">
            Guardar cambios
          </AdminButton>
        </>
      )}
    >
      <form id={editFormId} className="admin-form" onSubmit={(event) => void submitEditItem(event)} aria-busy={editBusy || undefined}>
        {/* Datos del ítem (issue #111): todo editable menos la cantidad (#112). */}
        <AdminDialogSection title="Datos">
          <TextField
            label="Artículo"
            required
            wide
            maxLength={120}
            value={editForm.name}
            help={INVENTORY_FIELD_HELP.name}
            onChange={(value) => setEditForm({ ...editForm, name: value })}
            placeholder="Ej.: Pantalla LED P3.9 500×500"
          />
          <CategoryPicker
            tree={taxonomy.tree}
            category={editForm.category}
            subcategory={editForm.subcategory}
            onChange={(next) => setEditForm((current) => ({ ...current, ...next }))}
          />
          <SelectField
            label="Tipo"
            value={editForm.inventoryKind}
            help={INVENTORY_FIELD_HELP.inventoryKind}
            onChange={(value) => setEditForm({ ...editForm, inventoryKind: value })}
            options={KIND_PICK_OPTIONS}
          />
          <SelectField
            label="Estado"
            value={editForm.status}
            help={INVENTORY_FIELD_HELP.status}
            onChange={(value) => setEditForm({ ...editForm, status: value })}
            options={STATUS_PICK_OPTIONS}
          />
          <SegmentedField
            label="Visibilidad en la tienda"
            help={INVENTORY_FIELD_HELP.catalogAudience}
            value={editForm.catalogAudience}
            onChange={(value) => setEditForm({ ...editForm, catalogAudience: value as CatalogAudience })}
            options={[...CATALOG_AUDIENCE_OPTIONS]}
            hint="Oculto no se publica. Mayorista solo se ve con el link privado de cada cliente."
          />
        </AdminDialogSection>

        <AdminDialogSection title="Depósito y compra" collapsible hint="dónde se guarda, proveedor y garantía">
          <ProductTraceFields taxonomy={taxonomy} value={editForm} onChange={(next) => setEditForm((current) => ({ ...current, ...next }))} disabled={editBusy} />
        </AdminDialogSection>

        {/* Precios: lo que más se edita de un producto existente, justo después de los datos. */}
        <AdminDialogSection title="Precios">
          <SegmentedField
            label="Se cobra"
            help={INVENTORY_FIELD_HELP.billingUnit}
            value={editForm.billingUnit}
            onChange={(value) => setEditForm({ ...editForm, billingUnit: value })}
            options={[...BILLING_UNIT_OPTIONS]}
            hint="Por evento: el precio no se multiplica por los días."
          />
          <PriceFrontFields
            title="Precio cliente final"
            normalValue={editForm.listPrice}
            daysValue={editForm.listFromDays}
            fromValue={editForm.listFromPrice}
            onNormal={(value) => setEditForm({ ...editForm, listPrice: value })}
            onDays={(value) => setEditForm({ ...editForm, listFromDays: value })}
            onFrom={(value) => setEditForm({ ...editForm, listFromPrice: value })}
          />
          <PriceFrontFields
            title="Precio mayorista"
            normalValue={editForm.wholesalePrice}
            daysValue={editForm.wholesaleFromDays}
            fromValue={editForm.wholesaleFromPrice}
            onNormal={(value) => setEditForm({ ...editForm, wholesalePrice: value })}
            onDays={(value) => setEditForm({ ...editForm, wholesaleFromDays: value })}
            onFrom={(value) => setEditForm({ ...editForm, wholesaleFromPrice: value })}
          />
          <div className="admin-form-group admin-form-group--min">
            <span className="admin-form-group-title">Precio mínimo</span>
            <MoneyField
              label="Piso de venta"
              value={editForm.minimumPrice}
              help={INVENTORY_FIELD_HELP.minimumPrice}
              onChange={(value) => setEditForm({ ...editForm, minimumPrice: value })}
              hint="Piso de venta del ítem."
            />
          </div>
        </AdminDialogSection>

        {/* Las unidades físicas (issue #112) se gestionan en la ficha: acá
            solo se resume cuántas hay, para no duplicar la lista. */}
        <AdminDialogSection title="Stock y tiempos">
          <p className="admin-note admin-field--wide">
            <span>
              {formatNumber(item.units.length)} unidad{item.units.length === 1 ? "" : "es"} · código, estado y costo se
              gestionan en la ficha del producto.
            </span>
            <AdminButton
              icon="info"
              type="button"
              title="Ver la ficha con las unidades"
              onClick={() => {
                if (editDirty) {
                  setEditError("Guardá o cancelá los cambios antes de abrir la ficha. Tus datos siguen aquí.");
                  return;
                }
                onOpenUnits(item.id);
              }}
            >
              Ver unidades
            </AdminButton>
          </p>
          <NumberField
            label="Tiempo antes (horas)"
            value={editForm.bufferBeforeHours}
            onChange={(value) => setEditForm({ ...editForm, bufferBeforeHours: value })}
            maxLength={3}
            hint="Preparación, transporte y entrega antes del evento. Vacío = el tiempo de la empresa."
            disabled={editBusy}
          />
          <NumberField
            label="Tiempo después (horas)"
            value={editForm.bufferAfterHours}
            onChange={(value) => setEditForm({ ...editForm, bufferAfterHours: value })}
            maxLength={3}
            hint="Devolución, transporte y limpieza después del evento. Vacío = el tiempo de la empresa."
            disabled={editBusy}
          />
        </AdminDialogSection>


        {/* Foto (issues #109 y #111): se cambia subiendo otra o se quita. */}
        <AdminDialogSection title="Fotos" collapsible defaultOpen={Boolean(item.imageUrl)} hint="foto y descripción del catálogo">
          <PhotoFields
            urlValue={editForm.imageUrl}
            onUrlChange={(value) => {
              setEditPendingPhoto(null);
              setEditPhotoError("");
              setEditPhotoRemoved(false);
              setEditForm({ ...editForm, imageUrl: value });
            }}
            previewUrl={editPhotoPreview}
            hasPhoto={editHasPhoto}
            onSelectFile={(file) => void selectEditPhoto(file)}
            onClearPhoto={clearEditPhoto}
            error={editPhotoError}
            disabled={editBusy}
          />
          <TextAreaField
            label="Descripción para el catálogo"
            optional
            help={INVENTORY_FIELD_HELP.publicDescription}
            maxLength={FIELD_LIMITS.publicDescription}
            rows={3}
            wide
            value={editForm.publicDescription}
            onChange={(value) => setEditForm({ ...editForm, publicDescription: value })}
            hint="Se muestra en el catálogo público. Las notas internas no se publican."
            disabled={editBusy}
          />
        </AdminDialogSection>

        {/* Costos internos, notas internas: no son precios de venta ni se publican. */}
        <AdminDialogSection title="Más opciones" collapsible defaultOpen={advancedOpen} hint="costos internos y notas">
          <MoneyField
            label="Reposición"
            help={INVENTORY_FIELD_HELP.replacementCost}
            value={editForm.replacementCost}
            onChange={(value) => setEditForm({ ...editForm, replacementCost: value })}
            hint="Lo que cuesta reponer la unidad; no es un precio de venta."
          />
          <MoneyField
            label="Costo diario"
            help={INVENTORY_FIELD_HELP.dailyCost}
            value={editForm.dailyCost}
            onChange={(value) => setEditForm({ ...editForm, dailyCost: value })}
            hint="Costo interno por día de uso."
          />
          <TextAreaField
            label="Notas internas"
            help={INVENTORY_FIELD_HELP.notes}
            maxLength={FIELD_LIMITS.notes}
            rows={3}
            wide
            value={editForm.notes}
            onChange={(value) => setEditForm({ ...editForm, notes: value })}
            placeholder="Estado del equipo, accesorios, ubicación en depósito…"
          />
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}
