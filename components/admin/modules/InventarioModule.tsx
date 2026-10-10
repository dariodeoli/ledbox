"use client";

import { useEffect, useMemo, useState } from "react";
import {
  damageSummary,
  formatDateShort,
  formatMoney,
  formatNumber,
  formatTime,
  inventoryAssignmentCountdown,
  inventoryAssignmentState,
  inventoryKindLabel,
  inventoryStatusLabel,
  statusTone,
} from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import { csvBool, csvFilename, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
  inventoryImageError,
  inventoryImageValid,
  inventoryPriceValue,
  inventoryPriceWarning,
  inventorySkuError,
  inventoryUnitCodeError,
  inventoryUnitCodeValid,
  normalizeInventoryUnitCode,
  personNameValid,
  readInventoryPriceValues,
  type InventoryPriceValues,
} from "@/lib/field-rules";
import type {
  AdminApiResponse,
  AdminInventoryAvailability,
  AdminInventoryItemRow,
  AdminInventoryRow,
  AdminInventorySubstitute,
  AdminInventoryUnitRow,
} from "@/lib/admin-types";
import type { PreparedInventoryPhoto } from "@/lib/inventory-image";
import { useAdminSession } from "../AdminShell";
import {
  AdminActionsMenu,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminDisclosure,
  AdminEmpty,
  AdminFormPanel,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  type AdminMenuItem,
} from "../AdminUI";
import { AttachmentInput, Combobox, DateField, MoneyField, NumberField, SearchField, SelectField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { adminApiGet, adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import { AdminViewSwitch, useAdminModuleView, useAdminNarrowViewport } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import { AdminIcon } from "../AdminIcons";
import { AdminImageBox } from "../AdminImageBox";
import { InventoryBulkEditor } from "./InventoryBulkEditor";
import { INVENTORY_FIELD_HELP } from "@/lib/inventory-bulk";

const KIND_OPTIONS = [
  { value: "ALL", label: "Todos los tipos" },
  { value: "REUSABLE", label: "Reutilizable" },
  { value: "CONSUMABLE", label: "Consumible" },
  { value: "DISPOSABLE", label: "Descartable" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "AVAILABLE", label: "Disponible" },
  { value: "RESERVED", label: "Reservado" },
  { value: "IN_USE", label: "En uso" },
  { value: "MAINTENANCE", label: "Mantenimiento" },
  { value: "RETIRED", label: "Retirado" },
];

const STATUS_PICK_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== "ALL");

/** Estados de una unidad física (issue #112): disponible, en mantenimiento o retirada. */
const UNIT_STATUS_PICK_OPTIONS = STATUS_PICK_OPTIONS.filter(
  (option) => option.value === "AVAILABLE" || option.value === "MAINTENANCE" || option.value === "RETIRED",
);

/** Vistas del inventario (issue #57): lista densa y cuadrícula de tarjetas. */
const INVENTARIO_VIEWS = ["list", "grid"] as const;

const EMPTY_FORM = {
  name: "",
  category: "",
  /** SKU opcional del alta (issue #131), detrás de «Más datos». */
  sku: "",
  inventoryKind: "REUSABLE",
  quantity: "1",
  /** «Visible en la web» (issue #111): arranca apagado, nada se publica solo. */
  visibleOnWeb: false,
  imageUrl: "",
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
  inventoryKind: "REUSABLE",
  status: "AVAILABLE",
  replacementCost: "",
  dailyCost: "",
  notes: "",
  visibleOnWeb: false,
  imageUrl: "",
  ...EMPTY_PRICES,
};

type InventoryEditForm = typeof EMPTY_EDIT;

/** El formulario de edición con los valores actuales del ítem. */
function editFormFromItem(item: AdminInventoryItemRow): InventoryEditForm {
  return {
    name: item.name,
    category: item.category,
    inventoryKind: item.kind,
    status: item.status,
    replacementCost: item.replacementCost > 0 ? String(item.replacementCost) : "",
    dailyCost: item.dailyCost > 0 ? String(item.dailyCost) : "",
    notes: item.notes ?? "",
    visibleOnWeb: item.visibleOnWeb,
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

/**
 * Precio de venta listo para mostrar: Gs formateado o «—» cuando todavía no
 * está cargado (0 = sin precio, nunca un cero engañoso).
 */
function priceText(value: number): string {
  return value > 0 ? formatMoney(value) : "—";
}

/** Regla «desde X días» en palabras: `desde 3 días` (0 = sin regla). */
function daysText(days: number): string {
  return days === 1 ? "desde 1 día" : `desde ${formatNumber(days)} días`;
}

/**
 * Frente de precios (issue #110) en una línea: el normal y, si hay regla, el
 * precio desde X días. Ej.: `Final Gs 750.000 · desde 3 días Gs 500.000`.
 */
function priceFrontText(label: string, normal: number, fromDays: number, fromPrice: number): string {
  const parts = [`${label} ${priceText(normal)}`];
  if (fromPrice > 0 && fromDays > 0) parts.push(`${daysText(fromDays)} ${priceText(fromPrice)}`);
  return parts.join(" · ");
}

/** Detalle completo de los precios para el `title` de una fila o tarjeta. */
function pricesTitle(
  item: Pick<
    AdminInventoryRow,
    | "listPrice"
    | "listFromDays"
    | "listFromPrice"
    | "wholesalePrice"
    | "wholesaleFromDays"
    | "wholesaleFromPrice"
    | "minimumPrice"
  >,
): string {
  return [
    priceFrontText("Final", item.listPrice, item.listFromDays, item.listFromPrice),
    priceFrontText("Mayorista", item.wholesalePrice, item.wholesaleFromDays, item.wholesaleFromPrice),
    `Mínimo ${priceText(item.minimumPrice)}`,
  ].join(" · ") + " (PYG)";
}

/**
 * Regla del frente en corto para la celda de la lista: `desde 3 d: 500.000`
 * (sin «Gs»: la línea principal ya trae el símbolo). Vacío si no hay regla.
 */
function priceRuleChip(days: number, price: number): string {
  if (price <= 0 || days <= 0) return "";
  return `desde ${days} d: ${formatNumber(price)}`;
}

/** Líneas de la celda de precios de la lista: principal + reglas, sin cortar números. */
function priceCellLines(
  item: Pick<
    AdminInventoryRow,
    | "listPrice"
    | "listFromDays"
    | "listFromPrice"
    | "wholesalePrice"
    | "wholesaleFromDays"
    | "wholesaleFromPrice"
    | "minimumPrice"
  >,
): string[] {
  const lines = [priceText(item.listPrice)];
  const second = [priceRuleChip(item.listFromDays, item.listFromPrice), item.wholesalePrice > 0 ? `May. ${formatNumber(item.wholesalePrice)}` : ""]
    .filter(Boolean)
    .join(" · ");
  const third = [priceRuleChip(item.wholesaleFromDays, item.wholesaleFromPrice), item.minimumPrice > 0 ? `Mín. ${formatNumber(item.minimumPrice)}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (second) lines.push(second);
  if (third) lines.push(third);
  return lines;
}

/** Precio de un frente para las tarjetas: el normal y su regla, sin recortes. */
function PriceValue({ normal, days, from }: { normal: number; days: number; from: number }) {
  if (normal <= 0 && from <= 0) return <>—</>;
  return (
    <span className="admin-cell-stack">
      <span>{priceText(normal)}</span>
      {from > 0 && days > 0 ? (
        <small className="admin-cell-sub">
          desde {days} d: {formatNumber(from)}
        </small>
      ) : null}
    </span>
  );
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

/**
 * Miniatura del ítem (issue #86): la imagen del producto con fallback al ícono
 * del módulo. Nunca queda un cuadro roto: si la URL no carga, vuelve al ícono
 * (misma mecánica que el avatar único del panel).
 */
function InventoryThumb({ item, size = 26 }: { item: Pick<AdminInventoryRow, "imageUrl">; size?: number }) {
  return <AdminImageBox imageUrl={item.imageUrl} size={size} />;
}

/** Horas de salida/devolución en formato de tabla (es-PY, 24 h). */
function stamp(value: string | null): string {
  return value ? `${formatDateShort(value)} · ${formatTime(value)}` : "—";
}

/** Rango asignado en una línea: `09-oct. 08:00 → 12-oct. 20:00` (fin abierto si falta). */
function rangeStamp(start: string | null, end: string | null): string {
  if (!start && !end) return "Sin fechas";
  if (start && !end) return `${formatDateShort(start)} ${formatTime(start)} → sin fin`;
  if (!start && end) return `sin inicio → ${formatDateShort(end)} ${formatTime(end)}`;
  return `${formatDateShort(start)} ${formatTime(start)} → ${formatDateShort(end)} ${formatTime(end)}`;
}

/** Rango pedido en la vista por rango: `21-sept. 00:00 → 23-sept. 23:59`. */
function dayRangeLabel(from: string, to: string): string {
  return `${formatDateShort(`${from}T00:00`)} 00:00 → ${formatDateShort(`${to}T23:59`)} 23:59`;
}

/**
 * Vista de disponibilidad del equipo (issue #18): día de hoy o rango pedido.
 * Cuando hay rango, cada ítem muestra sus unidades libres en el rango, los
 * rangos comprometidos que se solapan y —al abrir el ítem— los sustitutos de la
 * misma categoría con stock libre. El cálculo vive en el API.
 */
export function InventarioModule() {
  const { role } = useAdminSession();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const [statusError, setStatusError] = useState("");
  const [archiveBusyId, setArchiveBusyId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [bulkItemIds, setBulkItemIds] = useState<string[]>([]);
  const [bulkUnitIds, setBulkUnitIds] = useState<string[]>([]);
  const toggleBulk = (id: string, target: "items" | "units") => {
    const update = target === "items" ? setBulkItemIds : setBulkUnitIds;
    update(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 100 ? [...current, id] : current);
  };
  const [view, setView] = useAdminModuleView("inventario", INVENTARIO_VIEWS);
  /** Ancho compacto (issue #151): las tarjetas de la cuadrícula, siempre. */
  const narrow = useAdminNarrowViewport();

  // Foto del alta (issue #109): archivo ya comprimido en el navegador, listo
  // para subir después de crear el ítem (necesita su id).
  const [pendingPhoto, setPendingPhoto] = useState<PreparedInventoryPhoto | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  /** Categorías creadas en esta sesión del formulario (se suman a las existentes). */
  const [categoryExtras, setCategoryExtras] = useState<string[]>([]);

  // Edición del ítem abierto (issues #90, #110 y #111): datos, costos, notas,
  // foto y precios, todo en un solo formulario.
  const [editItem, setEditItem] = useState<AdminInventoryItemRow | null>(null);
  const [editForm, setEditForm] = useState<InventoryEditForm>(EMPTY_EDIT);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editPendingPhoto, setEditPendingPhoto] = useState<PreparedInventoryPhoto | null>(null);
  /** La foto subida del ítem se quita al guardar (issue #111). */
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const [editPhotoError, setEditPhotoError] = useState("");

  // Unidades físicas del ítem abierto (issue #112): alta, estado y edición.
  const [unitBusyId, setUnitBusyId] = useState("");
  const [unitError, setUnitError] = useState("");
  const [unitNotice, setUnitNotice] = useState("");
  const [unitDialog, setUnitDialog] = useState<AdminInventoryUnitRow | null>(null);
  const [unitEditorOpen, setUnitEditorOpen] = useState(false);
  const [unitForm, setUnitForm] = useState({ code: "", status: "AVAILABLE", purchaseCost: "", notes: "" });
  const [unitDialogBusy, setUnitDialogBusy] = useState(false);
  const [unitDialogError, setUnitDialogError] = useState("");
  function selectInventory(id: string) {
    if (unitEditorOpen) { setUnitDialogError("Guardá o cancelá la unidad antes de cambiar de ficha. Tus datos siguen aquí."); return; }
    setSelectedId(id);
  }
  /** El aviso del alta (por ejemplo, precios incoherentes) se muestra en tono warn. */
  const [noticeTone, setNoticeTone] = useState<"ok" | "warn">("ok");

  // Disponibilidad del ítem abierto en el rango pedido (issue #18).
  const [rangeAvailability, setRangeAvailability] = useState<AdminInventoryAvailability | null>(null);
  const [substitutes, setSubstitutes] = useState<AdminInventorySubstitute[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");

  const writable = canWriteOperations(role);
  const rangeActive = Boolean(from && to);

  // La lista viaja con el rango cuando está completo: el API devuelve la
  // disponibilidad de cada ítem en ese rango además de la de hoy.
  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("startsAt", `${from}T00:00`);
    if (to) params.set("endsAt", `${to}T23:59`);
    const search = params.toString();
    return search ? `/api/admin/inventory?${search}` : "/api/admin/inventory";
  }, [from, to]);

  const resources = useAdminResource(
    listPath,
    (payload) => (payload.inventory ?? []) as AdminInventoryItemRow[],
  );

  const inventory = useMemo(() => resources.data ?? [], [resources.data]);
  const selected = useMemo(() => inventory.find((item) => item.id === selectedId) ?? null, [inventory, selectedId]);

  const filteredRows = useMemo(
    () =>
      inventory
        .filter((item) => (kind === "ALL" ? true : item.kind === kind))
        .filter((item) => (status === "ALL" ? true : item.status === status))
        .filter((item) => matchesQuery(query, [item.name, item.category, item.sku, item.status])),
    [inventory, kind, status, query],
  );
  const rows = filteredRows.filter(item => !item.archivedAt);
  const archivedRows = filteredRows.filter(item => Boolean(item.archivedAt));

  async function archiveItem(item: AdminInventoryItemRow, restore = false) {
    if (archiveBusyId) return;
    if (editItem?.id === item.id || (unitEditorOpen && selectedId === item.id)) {
      setNoticeTone("warn"); setNotice("Guardá o cancelá los cambios pendientes de esta ficha antes de archivarla o restaurarla."); return;
    }
    setArchiveBusyId(item.id); setStatusError("");
    const result = await adminSend("/api/admin/inventory", { kind: restore ? "item-restore" : "item-archive", id: item.id });
    setArchiveBusyId("");
    if (!result.ok) { setStatusError(result.error); return; }
    setNoticeTone("ok"); setNotice(`Producto «${item.name}» ${restore ? "restaurado" : "archivado"}. Conserva estado operativo, unidades, precios y asignaciones.`);
    setBulkItemIds(current => current.filter(id => id !== item.id));
    if (!restore && selectedId === item.id) setSelectedId("");
    resources.reload();
  }

  const totals = useMemo(
    () =>
      inventory.reduce(
        (accumulator, item) => {
          const range = item.availability.range ?? null;
          accumulator.units += item.quantity;
          accumulator.committed += rangeActive ? (range?.committed ?? 0) : item.availability.committedNow;
          accumulator.available += rangeActive ? (range?.available ?? 0) : item.availability.availableNow;
          if (rangeActive ? (range?.overcommitted ?? false) : item.availability.overcommittedNow) accumulator.conflicts += 1;
          return accumulator;
        },
        { units: 0, committed: 0, available: 0, conflicts: 0 },
      ),
    [inventory, rangeActive],
  );

  // Aviso de coherencia de precios (issues #90 y #110): se ve mientras se
  // cargan o editan (el guardado no se bloquea; el API devuelve el mismo aviso).
  const formPriceWarning = useMemo(() => {
    const prices = readInventoryPriceValues(form);
    return prices.ok ? priceWarningFor(prices.values) : null;
  }, [form]);

  const editPriceWarning = useMemo(() => {
    const prices = readInventoryPriceValues(editForm);
    return prices.ok ? priceWarningFor(prices.values) : null;
  }, [editForm]);

  const selectedPriceWarning = selected ? inventoryPriceWarning(selected) : null;

  // Categorías de la empresa (issue #109): el alta las busca y permite crear
  // una nueva en línea; las creadas en la sesión se suman a las opciones.
  const categoryChoices = useMemo(() => {
    const seen = new Set<string>();
    for (const item of inventory) {
      const category = item.category?.trim();
      if (category) seen.add(category);
    }
    for (const extra of categoryExtras) seen.add(extra);
    return [...seen].sort((a, b) => a.localeCompare(b, "es")).map((category) => ({ value: category, label: category }));
  }, [inventory, categoryExtras]);

  // Foto del alta: el archivo elegido manda; si no, la URL manual válida.
  const manualImage = inventoryImageValid(form.imageUrl.trim()) ? form.imageUrl.trim() : null;
  const photoPreview = pendingPhoto?.dataUrl ?? manualImage;
  const hasPhoto = Boolean(pendingPhoto) || Boolean(form.imageUrl.trim());

  // Foto en edición (issue #111): la nueva elegida manda; si no, la manual; si
  // no, la subida del ítem (salvo que se haya pedido quitarla).
  const editManualImage = inventoryImageValid(editForm.imageUrl.trim()) ? editForm.imageUrl.trim() : null;
  const editPhotoPreview =
    editPendingPhoto?.dataUrl ??
    editManualImage ??
    (!editPhotoRemoved && editItem?.imageUploaded ? editItem.imageUrl : null);
  const editHasPhoto = Boolean(editPendingPhoto) || Boolean(editForm.imageUrl.trim()) || Boolean(editPhotoPreview);

  // Disponibilidad del ítem abierto en el rango pedido + sustitutos sugeridos.
  useEffect(() => {
    if (!selectedId || !rangeActive) {
      setRangeAvailability(null);
      setSubstitutes([]);
      setRangeError("");
      setRangeLoading(false);
      return;
    }
    const params = new URLSearchParams({ inventoryId: selectedId, startsAt: `${from}T00:00`, endsAt: `${to}T23:59` });
    const controller = new AbortController();
    setRangeLoading(true);
    setRangeError("");
    void adminApiGet<AdminApiResponse>(`/api/admin/inventory?${params.toString()}`, {
      fresh: true,
      signal: controller.signal,
      fallbackError: "No pudimos calcular la disponibilidad del rango.",
    })
      .then((result) => {
        if (!result.ok) {
          if (result.aborted) return;
          setRangeAvailability(null);
          setSubstitutes([]);
          setRangeError(result.error);
          return;
        }
        setRangeAvailability(result.data.availability ?? null);
        setSubstitutes(result.data.substitutes ?? []);
      })
      .finally(() => setRangeLoading(false));
    return () => controller.abort();
  }, [selectedId, rangeActive, from, to]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setPhotoError("");
    setNotice("");
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
      sku: sku || undefined,
      inventoryKind: form.inventoryKind,
      quantity: Number(form.quantity) || 1,
      visibleOnWeb: form.visibleOnWeb,
      imageUrl: image,
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
    setNotice(`Ítem «${form.name}» cargado.${warning ? ` ${warning}` : ""}${photoWarning}`);
    setNoticeTone(warning || photoWarning ? "warn" : "ok");
    setForm(EMPTY_FORM);
    setPendingPhoto(null);
    setPhotoError("");
    setCategoryExtras([]);
    resources.reload();
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

  /** Abre la edición completa del ítem con los valores actuales (issue #111). */
  function openEditItem(item: AdminInventoryItemRow) {
    setShowForm(false);
    setFormError("");
    setEditError("");
    setEditPhotoError("");
    setNotice("");
    setNoticeTone("ok");
    setEditItem(item);
    setEditForm(editFormFromItem(item));
    setEditPendingPhoto(null);
    setEditPhotoRemoved(false);
  }

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
    setEditPhotoRemoved(Boolean(editItem?.imageUploaded));
  }

  /** Guarda el ítem completo: datos, precios y foto (issues #90, #110 y #111). */
  async function submitEditItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editItem) return;
    setEditError("");
    setNotice("");
    setNoticeTone("ok");
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
    // Datos del ítem (issue #111) y después precios (issues #90 y #110).
    const itemResult = await adminSend<{ inventory?: { id?: string } }>("/api/admin/inventory", {
      kind: "item",
      id: editItem.id,
      name: editForm.name,
      category: editForm.category || "General",
      inventoryKind: editForm.inventoryKind,
      status: editForm.status,
      replacementCost: replacementCost ?? 0,
      dailyCost: dailyCost ?? 0,
      notes: editForm.notes,
      visibleOnWeb: editForm.visibleOnWeb,
      imageUrl: image,
    });
    if (!itemResult.ok) {
      setEditBusy(false);
      setEditError(itemResult.error);
      return;
    }

    const priceResult = await adminSend<AdminApiResponse>("/api/admin/inventory", {
      kind: "prices",
      id: editItem.id,
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
      const upload = await adminApiUpload(`/api/admin/inventory/${editItem.id}/image`, photoForm);
      if (!upload.ok) warnings.push(`La foto no se pudo subir: ${upload.error}`);
    } else if (editPhotoRemoved && editItem.imageUploaded) {
      const removed = await adminSend(`/api/admin/inventory/${editItem.id}/image`, {}, "DELETE");
      if (!removed.ok) warnings.push(`La foto no se pudo quitar: ${removed.error}`);
    }
    setEditBusy(false);

    setNotice(`Ítem «${editForm.name}» guardado.${warnings.length ? ` ${warnings.join(" ")}` : ""}`);
    setNoticeTone(warnings.length ? "warn" : "ok");
    setEditItem(null);
    setEditForm(EMPTY_EDIT);
    setEditPendingPhoto(null);
    setEditPhotoRemoved(false);
    setEditPhotoError("");
    resources.reload();
  }

  /** Alta inline sin abandonar la ficha ni los cambios pendientes del producto. */
  function addInventoryUnit() {
    setUnitDialog(null);
    setUnitForm({ code: "", status: "AVAILABLE", purchaseCost: "", notes: "" });
    setUnitDialogError("");
    setUnitEditorOpen(true);
  }

  /** Cambia el estado de una unidad: mantenimiento y retiro ajustan el stock libre. */
  async function changeUnitStatus(unit: AdminInventoryUnitRow, next: string) {
    setUnitBusyId(unit.id);
    setUnitError("");
    setUnitNotice("");
    const result = await adminSend("/api/admin/inventory", { kind: "unit-update", id: unit.id, status: next });
    setUnitBusyId("");
    if (!result.ok) {
      setUnitError(result.error);
      return;
    }
    setUnitNotice(`Unidad «${unit.code}» pasó a ${inventoryStatusLabel(next)}.`);
    resources.reload();
  }

  function openUnitDialog(unit: AdminInventoryUnitRow) {
    setUnitError("");
    setUnitNotice("");
    setUnitDialogError("");
    setUnitDialog(unit);
    setUnitEditorOpen(true);
    setUnitForm({
      code: unit.code,
      status: unit.status,
      purchaseCost: unit.purchaseCost > 0 ? String(unit.purchaseCost) : "",
      notes: unit.notes ?? "",
    });
  }

  /** Guarda el código, el estado, el costo y las notas de una unidad. */
  async function submitUnitDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !unitEditorOpen || unitDialogBusy) return;
    setUnitDialogError("");
    const code = normalizeInventoryUnitCode(unitForm.code);
    if ((unitDialog || code) && !inventoryUnitCodeValid(code)) {
      setUnitDialogError(FIELD_MESSAGES.unitCode);
      return;
    }
    const cost = inventoryPriceValue(unitForm.purchaseCost);
    if (cost === false) {
      setUnitDialogError(FIELD_MESSAGES.price);
      return;
    }
    setUnitDialogBusy(true);
    const result = await adminSend<{ unit?: AdminInventoryUnitRow }>("/api/admin/inventory", {
      kind: unitDialog ? "unit-update" : "unit",
      ...(unitDialog ? { id: unitDialog.id } : { inventoryId: selected.id }),
      ...(code ? { code } : {}),
      status: unitForm.status,
      purchaseCost: cost ?? 0,
      notes: unitForm.notes,
    });
    setUnitDialogBusy(false);
    if (!result.ok) {
      setUnitDialogError(result.error);
      return;
    }
    setUnitNotice(`Unidad «${result.data.unit?.code ?? code}» guardada.`);
    setUnitDialog(null);
    setUnitEditorOpen(false);
    resources.reload();
  }

  /** CSV del inventario filtrado: cantidades y costos reales de cada ítem. */
  function exportInventory() {    const units = rows.reduce((sum, item) => sum + item.quantity, 0);
    const available = rows.reduce(
      (sum, item) => sum + (rangeActive ? (item.availability.range?.available ?? 0) : item.availability.availableNow),
      0,
    );
    const committed = rows.reduce(
      (sum, item) => sum + (rangeActive ? (item.availability.range?.committed ?? 0) : item.availability.committedNow),
      0,
    );
    const availabilityLabel = rangeActive ? "Libres en el rango" : "Libres ahora";
    const committedLabel = rangeActive ? "Comprometidas en el rango" : "Comprometidas ahora";
    const blocks: CsvBlock[] = [
      {
        title: rangeActive ? `Inventario · ${from} a ${to}` : "Inventario",
        header: [
          "Artículo",
          "Categoría",
          "SKU",
          "Tipo",
          "Estado",
          "Cantidad",
          availabilityLabel,
          committedLabel,
          "Reposición (PYG)",
          "Costo diario (PYG)",
          "Conflicto",
        ],
        rows: [
          ...rows.map((item) => [
            item.name,
            item.category,
            item.sku ?? "",
            inventoryKindLabel(item.kind),
            inventoryStatusLabel(item.status),
            item.quantity,
            rangeActive ? (item.availability.range?.available ?? 0) : item.availability.availableNow,
            rangeActive ? (item.availability.range?.committed ?? 0) : item.availability.committedNow,
            item.replacementCost,
            item.dailyCost,
            csvBool(rangeActive ? (item.availability.range?.overcommitted ?? false) : item.availability.overcommittedNow),
          ]),
          ["Total", "", "", "", "", units, available, committed, "", "", ""],
        ],
      },
    ];
    downloadCsv(csvFilename("inventario"), blocks);
  }

  async function changeStatus(item: AdminInventoryItemRow, next: string) {
    setStatusBusyId(item.id);
    setStatusError("");
    setNotice("");
    const result = await adminSend("/api/admin/inventory", { kind: "status", id: item.id, status: next });
    setStatusBusyId("");
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    setNotice(`«${item.name}» pasó a ${inventoryStatusLabel(next)}.`);
    resources.reload();
  }

  function clearRange() {
    setFrom("");
    setTo("");
  }

  const selectedRange = selected?.availability.range ?? null;

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de inventario">
        <AdminKpi label="Ítems" icon="inventory" value={formatNumber(inventory.length)} note="controlados" />
        <AdminKpi label="Unidades" icon="inventory" value={formatNumber(totals.units)} note="en total" />
        <AdminKpi
          label={rangeActive ? "Comprometidas en el rango" : "En eventos ahora"} icon="events"
          value={formatNumber(totals.committed)}
          note={rangeActive ? dayRangeLabel(from, to) : "unidades comprometidas"}
          tone={totals.committed > 0 ? "accent" : undefined}
        />
        <AdminKpi
          label={rangeActive ? "Disponibles en el rango" : "Disponibles ahora"} icon="check"
          value={formatNumber(totals.available)}
          note={totals.conflicts > 0 ? `${formatNumber(totals.conflicts)} ítems en conflicto` : "libres para asignar"}
          tone={totals.available === 0 || totals.conflicts > 0 ? "warn" : "ok"}
        />
      </section>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar inventario" placeholder="Buscar por artículo, categoría o SKU…" />
        <AdminSelect value={kind} onChange={setKind} label="Filtrar por tipo" options={KIND_OPTIONS} />
        <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado" options={STATUS_OPTIONS} />
        <div className="admin-field--filter">
          <DateField
            label="Disponible desde"
            help="Inicio del rango para consultar unidades libres; no crea reservas."
            max={to || undefined}
            value={from}
            onChange={setFrom}
            title="Primer día del rango de disponibilidad"
          />
        </div>
        <div className="admin-field--filter">
          <DateField
            label="Hasta"
            help="Fin del rango de disponibilidad; no cambia las fechas de las asignaciones existentes."
            min={from || undefined}
            value={to}
            onChange={setTo}
            title="Último día del rango de disponibilidad"
          />
        </div>
        {rangeActive ? (
          <AdminButton icon="close" title="Quitar el rango y volver a la disponibilidad de hoy" aria-label="Quitar el rango de disponibilidad" onClick={clearRange}>
            Hoy
          </AdminButton>
        ) : null}
        {narrow ? null : <AdminViewSwitch view={view} onChange={setView} label="Vista de inventario" views={INVENTARIO_VIEWS} />}
        <span className="admin-export">
          <AdminButton
            icon="download"
            onClick={exportInventory}
            title="Exportar el inventario filtrado a CSV"
            aria-label="Exportar el inventario filtrado a CSV"
          >
            Exportar CSV
          </AdminButton>
        </span>
        {writable ? (
          <AdminButton
            variant="primary"
            icon="plus"
            onClick={() => {
              setFormError("");
              setEditItem(null);
              setShowForm((open) => !open);
            }}
            aria-expanded={showForm}
          >
            Nuevo ítem
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone={noticeTone}>{notice}</AdminNote> : null}
      {statusError ? <AdminNote tone="error">{statusError}</AdminNote> : null}
      {from && !to ? <AdminNote>Elegí «Hasta» para ver la disponibilidad en el rango (mientras tanto se muestra la de hoy).</AdminNote> : null}
      {!from && to ? <AdminNote>Elegí «Disponible desde» para ver la disponibilidad en el rango (mientras tanto se muestra la de hoy).</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo ítem de inventario"
          submitLabel="Cargar ítem"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          onEscape={() => setShowForm(false)}
          busy={busy || photoBusy}
          status={formError}
          statusNote={!formError && formPriceWarning ? <AdminNote tone="warn">{formPriceWarning}</AdminNote> : undefined}
        >
          {/* Datos del ítem (issues #109 y #131): campos finos; la cantidad va
              corta, el SKU vive en «Más datos» y precios y foto van plegados. */}
          <div className="admin-form-group admin-form-group--item">
            <span className="admin-form-group-title">Ítem</span>
            <TextField
              label="Artículo"
              help={INVENTORY_FIELD_HELP.name}
              required
              maxLength={120}
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
              placeholder="Ej.: Pantalla LED P3.9 500×500"
            />
            <Combobox
              label="Categoría"
              help={INVENTORY_FIELD_HELP.category}
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value })}
              options={categoryChoices}
              placeholder="Ej.: Pantallas"
              emptyLabel="Sin categorías cargadas."
              hint="Buscá o creá una nueva."
              onCreate={(query) => {
                if (!query) return;
                setCategoryExtras((current) => (current.includes(query) ? current : [...current, query]));
                setForm((current) => ({ ...current, category: query }));
              }}
              createLabel={(query) => (query ? `Crear categoría «${query}»` : "Crear categoría")}
            />
            <SelectField
              label="Tipo"
              help={INVENTORY_FIELD_HELP.inventoryKind}
              value={form.inventoryKind}
              onChange={(value) => setForm({ ...form, inventoryKind: value })}
              options={[
                { value: "REUSABLE", label: "Reutilizable" },
                { value: "CONSUMABLE", label: "Consumible" },
                { value: "DISPOSABLE", label: "Descartable" },
              ]}
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
          </div>

          {/* SKU opcional (issue #131): vive en «Más datos» y el POST lo acepta. */}
          <AdminDisclosure title="Más datos" hint="SKU">
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
          </AdminDisclosure>

          {/* Foto (issue #109): URL manual o archivo subido (uno de los dos). */}
          <AdminDisclosure title="Foto y web" hint="foto y visibilidad">
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
            <SwitchField
              label="Visible en la web"
              help={INVENTORY_FIELD_HELP.visibleOnWeb}
              checked={form.visibleOnWeb}
              onChange={(checked) => setForm({ ...form, visibleOnWeb: checked })}
              hint="Para el catálogo público."
            />
          </AdminDisclosure>

          {/* Precios por frente (issue #110): normal, umbral «desde X días» y
              precio desde esos días; el mínimo es el piso de venta. */}
          <AdminDisclosure title="Precios" hint="final, mayorista y mínimo">
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
          </AdminDisclosure>
        </AdminFormPanel>
      ) : null}

      {writable && editItem ? (
        <AdminFormPanel
          title={`Editar ítem · ${editForm.name || editItem.name}`}
          submitLabel="Guardar cambios"
          onSubmit={submitEditItem}
          onCancel={() => setEditItem(null)}
          onEscape={() => setEditItem(null)}
          busy={editBusy}
          status={editError}
          statusNote={!editError && editPriceWarning ? <AdminNote tone="warn">{editPriceWarning}</AdminNote> : undefined}
        >
          {/* Datos del ítem (issue #111): todo editable menos la cantidad (#112). */}
          <div className="admin-form-group admin-form-group--item-edit">
            <span className="admin-form-group-title">Ítem</span>
            <TextField
              label="Artículo"
              required
              maxLength={120}
              value={editForm.name}
              help={INVENTORY_FIELD_HELP.name}
              onChange={(value) => setEditForm({ ...editForm, name: value })}
              placeholder="Ej.: Pantalla LED P3.9 500×500"
            />
            <Combobox
              label="Categoría"
              value={editForm.category}
              help={INVENTORY_FIELD_HELP.category}
              onChange={(value) => setEditForm({ ...editForm, category: value })}
              options={categoryChoices}
              placeholder="Ej.: Pantallas"
              emptyLabel="Sin categorías cargadas."
              hint="Buscá o creá una nueva."
              onCreate={(query) => {
                if (!query) return;
                setCategoryExtras((current) => (current.includes(query) ? current : [...current, query]));
                setEditForm((current) => ({ ...current, category: query }));
              }}
              createLabel={(query) => (query ? `Crear categoría «${query}»` : "Crear categoría")}
            />
            <SelectField
              label="Tipo"
              value={editForm.inventoryKind}
              help={INVENTORY_FIELD_HELP.inventoryKind}
              onChange={(value) => setEditForm({ ...editForm, inventoryKind: value })}
              options={[
                { value: "REUSABLE", label: "Reutilizable" },
                { value: "CONSUMABLE", label: "Consumible" },
                { value: "DISPOSABLE", label: "Descartable" },
              ]}
            />
            <SelectField
              label="Estado"
              value={editForm.status}
              help={INVENTORY_FIELD_HELP.status}
              onChange={(value) => setEditForm({ ...editForm, status: value })}
              options={STATUS_PICK_OPTIONS}
            />
            <SwitchField
              label="Visible en la web"
              checked={editForm.visibleOnWeb}
              help={INVENTORY_FIELD_HELP.visibleOnWeb}
              onChange={(checked) => setEditForm({ ...editForm, visibleOnWeb: checked })}
              hint="Para el catálogo público."
            />
          </div>

          {/* Las unidades físicas (issue #112) se gestionan en el detalle: acá
              solo se resume cuántas hay, para no duplicar la lista. */}
          <div className="admin-form-group admin-form-group--wide">
            <span className="admin-form-group-title">Unidades</span>
            <p className="admin-note">
              <span>
                {formatNumber(editItem.units.length)} unidad{editItem.units.length === 1 ? "" : "es"} · código, estado y
                costo se gestionan en el detalle del ítem.
              </span>
              <AdminButton
                icon="info"
                type="button"
                title="Ver el detalle con las unidades"
                  onClick={() => {
                    selectInventory(editItem.id);
                  }}
              >
                Ver unidades
              </AdminButton>
            </p>
          </div>

          {/* Foto (issues #109 y #111): se cambia subiendo otra o se quita. */}
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

          {/* Costos internos (issue #111): no son precios de venta. */}
          <div className="admin-form-group admin-form-group--costs">
            <span className="admin-form-group-title">Costos internos</span>
            <AdminDisclosure title="Reposición" hint="Dato interno secundario">
              <MoneyField label="Reposición" help={INVENTORY_FIELD_HELP.replacementCost} value={editForm.replacementCost} onChange={(value) => setEditForm({ ...editForm, replacementCost: value })} hint="Lo que cuesta reponer la unidad; no es un precio de venta." />
            </AdminDisclosure>
            <MoneyField
              label="Costo diario"
              help={INVENTORY_FIELD_HELP.dailyCost}
              value={editForm.dailyCost}
              onChange={(value) => setEditForm({ ...editForm, dailyCost: value })}
              hint="Costo interno por día de uso."
            />
          </div>

          <div className="admin-form-group admin-form-group--wide">
            <span className="admin-form-group-title">Notas</span>
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
          </div>

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
        </AdminFormPanel>
      ) : null}

      {writable && bulkItemIds.length ? <InventoryBulkEditor target="items" selection={bulkItemIds.map(id => ({ id, label: inventory.find(item => item.id === id)?.name ?? id }))} onSaved={resources.reload} onClear={() => setBulkItemIds([])} /> : null}
      <AdminDataState
        loading={resources.loading}
        error={resources.error}
        onRetry={resources.reload}
        empty={inventory.length === 0}
        emptyTitle="Inventario vacío" emptyIcon="inventory"
        emptyHint="Cargá los equipos y materiales para asignarlos a los eventos."
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá los filtros." />
        ) : view === "grid" || narrow ? (
          <AdminCardGrid label="Inventario" cards={rows.map((item): AdminCardData => {
            const { availableNow, overcommittedNow, range } = item.availability;
            const available = rangeActive ? (range?.available ?? 0) : availableNow;
            const overcommitted = rangeActive ? (range?.overcommitted ?? false) : overcommittedNow;
            const conflictEvents = range?.conflicts ?? [];
            const menuItems: AdminMenuItem[] = [
              ...(writable
                ? [{ label: "Editar ítem", icon: "edit" as const, onClick: () => openEditItem(item), title: `Editar ítem: ${item.name}` }, { label: "Archivar producto", icon: "inventory" as const, onClick: () => void archiveItem(item), title: `Archivar producto ${item.name}`, disabled: Boolean(archiveBusyId) }]
                : []),
              {
                label: selectedId === item.id ? "Ocultar asignaciones" : "Asignaciones y disponibilidad",
                icon: "info" as const,
                onClick: () => selectInventory(selectedId === item.id ? "" : item.id),
                title: `Ver asignaciones y disponibilidad: ${item.name}`,
              },
            ];
            const availableTitle = `${formatNumber(available)} libres de ${formatNumber(item.quantity)} · comprometidas ${
              rangeActive ? `entre ${dayRangeLabel(from, to)}` : "ahora"
            }${conflictEvents.length > 0 ? ` · ${conflictEvents.map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`).join(", ")}` : ""}`;
            return {
              id: item.id,
              title: (
                <span className="admin-item-identity">
                  <InventoryThumb item={item} size={32} />
                  {writable ? <AdminButton icon="check" variant={bulkItemIds.includes(item.id) ? "primary" : "ghost"} aria-pressed={bulkItemIds.includes(item.id)} disabled={bulkItemIds.length >= 100 && !bulkItemIds.includes(item.id)} title={`Seleccionar producto ${item.name}`} aria-label={`Seleccionar producto ${item.name}`} onClick={() => toggleBulk(item.id, "items")} /> : null}
                  <span className="admin-item-name">{item.name}</span>
                </span>
              ),
              titleTooltip: item.sku ? `${item.name} · ${item.sku}` : item.name,
              subtitle: item.sku ? `SKU ${item.sku} · ${item.category}` : item.category,
              badges: [
                { label: inventoryKindLabel(item.kind), tone: statusTone(item.kind) },
                ...(overcommitted ? [{ label: "Conflicto", tone: "danger" as const, title: "Hay más unidades comprometidas que las que tiene el ítem." }] : []),
              ],
              fields: [
                { label: "Cantidad", value: formatNumber(item.quantity), title: `${formatNumber(item.quantity)} unidades` },
                { label: rangeActive ? "Libres en rango" : "Libres ahora", value: formatNumber(available), title: availableTitle },
                { label: "Costo diario", value: formatMoney(item.dailyCost), title: formatMoney(item.dailyCost) },
                {
                  label: "Cliente final",
                  value: <PriceValue normal={item.listPrice} days={item.listFromDays} from={item.listFromPrice} />,
                  title: pricesTitle(item),
                },
                {
                  label: "Mayorista",
                  value: <PriceValue normal={item.wholesalePrice} days={item.wholesaleFromDays} from={item.wholesaleFromPrice} />,
                  title: pricesTitle(item),
                },
                { label: "Mínimo", value: priceText(item.minimumPrice), title: pricesTitle(item) },
                {
                  label: "Estado",
                  value: <AdminBadge tone={statusTone(item.status)}>{inventoryStatusLabel(item.status)}</AdminBadge>,
                  title: inventoryStatusLabel(item.status),
                },
              ],
              footer: (
                <>
                  {writable ? (
                    <AdminSelect
                      className="admin-filter admin-filter--cell"
                      value={item.status}
                      disabled={statusBusyId === item.id}
                      onChange={(value) => void changeStatus(item, value)}
                      label={`Cambiar estado: ${item.name}`}
                      title={`Cambiar estado: ${item.name}`}
                      options={STATUS_PICK_OPTIONS}
                    />
                  ) : null}
                  <span className="admin-actions">
                    <AdminActionsMenu label={`Acciones del ítem ${item.name}`} items={menuItems} />
                  </span>
                </>
              ),
            };
          })} />
        ) : (
          <AdminTable
            view="inventario"
            label="Inventario"
            columns={[
              { label: "Artículo" },
              { label: "Categoría" },
              { label: "Tipo" },
              { label: "Cantidad", end: true },
              { label: rangeActive ? "Libres en rango" : "Libres ahora", end: true },
              { label: "Costo diario", end: true },
              { label: "Precios", end: true },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((item) => {
              const { availableNow, committedNow, overcommittedNow, range } = item.availability;
              const available = rangeActive ? (range?.available ?? 0) : availableNow;
              const committed = rangeActive ? (range?.committed ?? 0) : committedNow;
              const overcommitted = rangeActive ? (range?.overcommitted ?? false) : overcommittedNow;
              const conflictEvents = range?.conflicts ?? [];
              return (
                <AdminRow key={item.id}>
                  <AdminCell title={item.name}>
                    <span className="admin-item-identity">
                      <InventoryThumb item={item} />
                      {writable ? <AdminButton icon="check" variant={bulkItemIds.includes(item.id) ? "primary" : "ghost"} aria-pressed={bulkItemIds.includes(item.id)} disabled={bulkItemIds.length >= 100 && !bulkItemIds.includes(item.id)} title={`Seleccionar producto ${item.name}`} aria-label={`Seleccionar producto ${item.name}`} onClick={() => toggleBulk(item.id, "items")} /> : null}
                      <span className="admin-item-name">
                        <strong>{item.name}</strong>
                        {item.sku ? <span className="admin-code"> · {item.sku}</span> : null}
                      </span>
                    </span>
                  </AdminCell>
                  <AdminCell title={item.category}>{item.category}</AdminCell>
                  <AdminCell>
                    <AdminBadge tone={statusTone(item.kind)}>{inventoryKindLabel(item.kind)}</AdminBadge>
                  </AdminCell>
                  <AdminCell end title={`${formatNumber(item.quantity)} unidades`}>
                    {formatNumber(item.quantity)}
                  </AdminCell>
                  <AdminCell
                    end
                    title={`${formatNumber(available)} libres de ${formatNumber(item.quantity)} · ${formatNumber(committed)} comprometidas ${
                      rangeActive ? `entre ${dayRangeLabel(from, to)}` : "ahora"
                    }${conflictEvents.length > 0 ? ` · ${conflictEvents.map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`).join(", ")}` : ""}`}
                  >
                    <span className="admin-nowrap" data-tone={available === 0 ? "warn" : undefined}>
                      {formatNumber(available)}
                    </span>
                    {overcommitted ? (
                      <AdminBadge
                        tone="danger"
                        title={
                          rangeActive
                            ? "Hay más unidades comprometidas en el rango que las que tiene el ítem."
                            : "Hay más unidades asignadas a eventos vigentes que las que tiene el ítem."
                        }
                      >
                        Conflicto
                      </AdminBadge>
                    ) : null}
                  </AdminCell>
                  <AdminCell end title={formatMoney(item.dailyCost)}>
                    {formatMoney(item.dailyCost)}
                  </AdminCell>
                  <AdminCell end title={pricesTitle(item)}>
                    <span className="admin-cell-stack">
                      {priceCellLines(item).map((line, index) =>
                        index === 0 ? (
                          <span key={index} className="admin-nowrap">{line}</span>
                        ) : (
                          <small key={index} className="admin-cell-sub admin-nowrap">{line}</small>
                        ),
                      )}
                    </span>
                  </AdminCell>
                  <AdminCell title={writable ? `Cambiar estado: ${item.name}` : `Estado: ${inventoryStatusLabel(item.status)}`}>
                    {writable ? (
                      <AdminSelect
                        className="admin-filter admin-filter--cell"
                        value={item.status}
                        disabled={statusBusyId === item.id}
                        onChange={(value) => void changeStatus(item, value)}
                        label={`Cambiar estado: ${item.name}`}
                        title={`Cambiar estado: ${item.name}`}
                        options={STATUS_PICK_OPTIONS}
                        tone={statusTone(item.status)}
                      />
                    ) : (
                      <AdminBadge tone={statusTone(item.status)}>{inventoryStatusLabel(item.status)}</AdminBadge>
                    )}
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      {writable ? (
                        <><AdminButton icon="inventory" title={`Archivar producto ${item.name}`} aria-label={`Archivar producto ${item.name}`} disabled={Boolean(archiveBusyId)} onClick={() => void archiveItem(item)} /><AdminButton
                          icon="edit"
                          title={`Editar ítem: ${item.name}`}
                          aria-label={`Editar ítem: ${item.name}`}
                          onClick={() => openEditItem(item)}
                        /></>
                      ) : null}
                      <AdminButton
                        icon="info"
                        title={`Ver asignaciones y disponibilidad: ${item.name}`}
                        aria-label={`Ver asignaciones y disponibilidad: ${item.name}`}
                        onClick={() => selectInventory(selectedId === item.id ? "" : item.id)}
                      />
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {selected ? (
        <AdminPanel
          title={`Disponibilidad · ${selected.name}`} icon="inventory"
          meta={
            rangeActive
              ? `${formatNumber(selectedRange?.available ?? 0)} de ${formatNumber(selected.quantity)} libres entre ${dayRangeLabel(from, to)}`
              : `${formatNumber(selected.availability.availableNow)} de ${formatNumber(selected.quantity)} libres ahora`
          }
          action={
            <span className="admin-panel-actions">
              {writable ? (
                <AdminButton
                  icon="edit"
                  title={`Editar ítem: ${selected.name}`}
                  aria-label={`Editar ítem: ${selected.name}`}
                  onClick={() => openEditItem(selected)}
                />
              ) : null}
              <AdminButton
                icon="close"
                title="Cerrar disponibilidad"
                aria-label="Cerrar disponibilidad"
                onClick={() => selectInventory("")}
              />
            </span>
          }
        >
          {selected.imageUrl ? (
            <figure className="admin-item-figure">
              <InventoryThumb item={selected} size={72} />
              <figcaption>
                {selected.category}
                {selected.sku ? ` · ${selected.sku}` : ""}
              </figcaption>
            </figure>
          ) : null}
          <dl className="admin-item-prices">
            <div>
              <dt>Cliente final</dt>
              <dd>{priceText(selected.listPrice)}</dd>
              {selected.listFromPrice > 0 && selected.listFromDays > 0 ? (
                <small>
                  {daysText(selected.listFromDays)}: {priceText(selected.listFromPrice)}
                </small>
              ) : null}
            </div>
            <div>
              <dt>Mayorista</dt>
              <dd>{priceText(selected.wholesalePrice)}</dd>
              {selected.wholesaleFromPrice > 0 && selected.wholesaleFromDays > 0 ? (
                <small>
                  {daysText(selected.wholesaleFromDays)}: {priceText(selected.wholesaleFromPrice)}
                </small>
              ) : null}
            </div>
            <div>
              <dt>Mínimo</dt>
              <dd>{priceText(selected.minimumPrice)}</dd>
            </div>
          </dl>
          {/* «Visible en la web» (issue #111): la landing es estática hoy; el
              flag queda listo para el catálogo dinámico. */}
          <p className="admin-note">
            <AdminBadge
              tone={selected.visibleOnWeb ? "ok" : undefined}
              title="Cuando el catálogo de la landing sea dinámico, este ítem se publica o no según este estado."
            >
              {selected.visibleOnWeb ? "Visible en la web" : "No visible en la web"}
            </AdminBadge>
          </p>
          {selectedPriceWarning ? <AdminNote tone="warn">{selectedPriceWarning}</AdminNote> : null}

          {/* Unidades físicas (issue #112): código, estado y costo por unidad. */}
          <section className="admin-unit-block" aria-label={`Unidades de ${selected.name}`}>
            <header className="admin-unit-head">
              <span className="admin-form-group-title">
                Unidades · {formatNumber(selected.units.length)}
                {selected.availability.maintenanceNow > 0
                  ? ` · ${formatNumber(selected.availability.maintenanceNow)} en mantenimiento`
                  : ""}
              </span>
              {writable ? (
                <AdminButton
                  icon="plus"
                  type="button"
                  busy={unitBusyId === selected.id}
                  title="Agregar una unidad con código automático"
                  disabled={unitEditorOpen}
                  onClick={() => addInventoryUnit()}
                >
                  Agregar unidad
                </AdminButton>
              ) : null}
            </header>
            {unitNotice ? <AdminNote tone="ok">{unitNotice}</AdminNote> : null}
            {unitError ? <AdminNote tone="error">{unitError}</AdminNote> : null}
            <AdminDisclosure title="Reposición" hint="Valor interno conservado">
              <p className="admin-note">{formatMoney(selected.replacementCost)} · editable en los datos secundarios del producto.</p>
            </AdminDisclosure>
            {writable && unitEditorOpen ? (
              <form className="admin-form" aria-label={unitDialog ? `Editar unidad ${unitDialog.code}` : "Agregar unidad"} onSubmit={event => void submitUnitDialog(event)}>
                <TextField label="Código de unidad" help={INVENTORY_FIELD_HELP.code} required={Boolean(unitDialog)} maxLength={FIELD_LIMITS.unitCode} value={unitForm.code} onChange={value => setUnitForm({ ...unitForm, code: normalizeInventoryUnitCode(value) })} hint={unitDialog ? "Único por empresa." : "Vacío: genera un código único al guardar."} disabled={unitDialogBusy} />
                <SelectField label="Estado de unidad" help={INVENTORY_FIELD_HELP.unitStatus} value={unitForm.status} onChange={value => setUnitForm({ ...unitForm, status: value })} options={UNIT_STATUS_PICK_OPTIONS} disabled={unitDialogBusy} />
                <MoneyField label="Costo que tuvo" help={INVENTORY_FIELD_HELP.purchaseCost} value={unitForm.purchaseCost} onChange={value => setUnitForm({ ...unitForm, purchaseCost: value })} hint="Costo interno de adquisición de esta unidad; no es un presupuesto de reparación." disabled={unitDialogBusy} />
                <TextAreaField label="Notas de unidad" help={INVENTORY_FIELD_HELP.notes} maxLength={400} rows={3} wide value={unitForm.notes} onChange={value => setUnitForm({ ...unitForm, notes: value })} hint="Detalle libre existente; no hay fechas ni taller de reparación estructurados." disabled={unitDialogBusy} />
                {unitDialogError ? <AdminNote tone="error">{unitDialogError}</AdminNote> : null}
                <div className="admin-form-actions"><AdminButton type="button" onClick={() => { setUnitEditorOpen(false); setUnitDialog(null); }} disabled={unitDialogBusy}>Cancelar unidad</AdminButton><AdminButton variant="primary" icon="check" type="submit" busy={unitDialogBusy}>Guardar unidad</AdminButton></div>
              </form>
            ) : null}
            {writable && bulkUnitIds.length ? <InventoryBulkEditor target="units" selection={bulkUnitIds.map(id => ({ id, label: inventory.flatMap(item => item.units).find(unit => unit.id === id)?.code ?? id }))} onSaved={resources.reload} onClear={() => setBulkUnitIds([])} /> : null}
            {selected.units.length === 0 ? (
              <AdminNote>
                Sin unidades cargadas: agregá la primera para poder asignar «{selected.name}» a un evento.
              </AdminNote>
            ) : (
              <AdminTable
                view="inventario-unidades"
                label={`Unidades de ${selected.name}`}
                columns={[
                  { label: "Código" },
                  { label: "Estado" },
                  { label: "Costo", end: true },
                  { label: "Acciones", end: true },
                ]}
              >
                {selected.units.map((unit) => (
                  <AdminRow key={unit.id}>
                    <AdminCell title={unit.notes ? `${unit.code} · ${unit.notes}` : unit.code}>
                      {writable ? <AdminButton icon="check" variant={bulkUnitIds.includes(unit.id) ? "primary" : "ghost"} aria-pressed={bulkUnitIds.includes(unit.id)} disabled={bulkUnitIds.length >= 100 && !bulkUnitIds.includes(unit.id)} title={`Seleccionar unidad ${unit.code}`} aria-label={`Seleccionar unidad ${unit.code}`} onClick={() => toggleBulk(unit.id, "units")} /> : null}
                      <span className="admin-code">{unit.code}</span>
                    </AdminCell>
                    <AdminCell title={writable ? `Cambiar estado de ${unit.code}` : inventoryStatusLabel(unit.status)}>
                      {writable ? (
                        <AdminSelect
                          className="admin-filter admin-filter--cell"
                          value={unit.status}
                          disabled={unitEditorOpen || unitBusyId === unit.id}
                          onChange={(value) => void changeUnitStatus(unit, value)}
                          label={`Cambiar estado de la unidad ${unit.code}`}
                          title={`Cambiar estado de la unidad ${unit.code}`}
                          options={UNIT_STATUS_PICK_OPTIONS}
                          tone={statusTone(unit.status)}
                        />
                      ) : (
                        <AdminBadge tone={statusTone(unit.status)}>{inventoryStatusLabel(unit.status)}</AdminBadge>
                      )}
                    </AdminCell>
                    <AdminCell end title={unit.purchaseCost > 0 ? formatMoney(unit.purchaseCost) : "Sin costo cargado"}>
                      {unit.purchaseCost > 0 ? formatMoney(unit.purchaseCost) : "—"}
                    </AdminCell>
                    <AdminCell end className="admin-cell--actions">
                      <span className="admin-actions">
                        {writable ? (
                          <AdminButton
                            icon="edit"
                            title={`Editar la unidad ${unit.code}`}
                            aria-label={`Editar la unidad ${unit.code}`}
                            disabled={unitEditorOpen}
                            onClick={() => openUnitDialog(unit)}
                          />
                        ) : null}
                      </span>
                    </AdminCell>
                  </AdminRow>
                ))}
              </AdminTable>
            )}
          </section>

          {rangeActive ? (
            rangeLoading ? (
              <AdminNote>Calculando la disponibilidad del rango…</AdminNote>
            ) : rangeError ? (
              <AdminNote tone="error">{rangeError}</AdminNote>
            ) : (
              <>
                <AdminNote tone={rangeAvailability && rangeAvailability.available === 0 ? "error" : undefined}>
                  {rangeAvailability
                    ? `${formatNumber(rangeAvailability.available)} de ${formatNumber(rangeAvailability.total)} unidades libres entre ${dayRangeLabel(from, to)}.`
                    : "Sin datos de disponibilidad para el rango."}
                  {rangeAvailability?.blocked
                    ? ` «${rangeAvailability.name}» está ${rangeAvailability.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`
                    : ""}
                  {rangeAvailability && rangeAvailability.conflicts.length > 0
                    ? ` Comprometidas: ${rangeAvailability.conflicts
                        .map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`)
                        .join(", ")}.`
                    : " Sin rangos comprometidos en el rango."}
                </AdminNote>

                {rangeAvailability && rangeAvailability.conflicts.length > 0 ? (
                  <AdminTable
                    view="inventario-rangos"
                    label={`Rangos comprometidos de ${selected.name} en el rango`}
                    columns={[
                      { label: "Evento" },
                      { label: "Rango comprometido" },
                      { label: "Cantidad", end: true },
                    ]}
                  >
                    {rangeAvailability.conflicts.map((conflict) => (
                      <AdminRow key={conflict.id}>
                        <AdminCell title={conflict.eventName}>{conflict.eventName}</AdminCell>
                        <AdminCell title={rangeStamp(conflict.startsAt, conflict.endsAt)}>
                          {rangeStamp(conflict.startsAt, conflict.endsAt)}
                        </AdminCell>
                        <AdminCell end title={`${formatNumber(conflict.quantity)} unidades`}>
                          {formatNumber(conflict.quantity)}
                        </AdminCell>
                      </AdminRow>
                    ))}
                  </AdminTable>
                ) : null}

                {substitutes.length > 0 ? (
                  <AdminTable
                    view="inventario-sustitutos"
                    label={`Sustitutos de ${selected.name} con stock libre en el rango`}
                    columns={[
                      { label: "Sustituto" },
                      { label: "Categoría" },
                      { label: "Libres", end: true },
                      { label: "Total", end: true },
                      { label: "Estado" },
                    ]}
                  >
                    {substitutes.map((substitute) => (
                      <AdminRow key={substitute.id}>
                        <AdminCell title={substitute.name}>
                          <strong>{substitute.name}</strong>
                          {substitute.sku ? <span className="admin-code"> · {substitute.sku}</span> : null}
                        </AdminCell>
                        <AdminCell title={substitute.category}>{substitute.category}</AdminCell>
                        <AdminCell
                          end
                          title={`${formatNumber(substitute.available)} libres de ${formatNumber(substitute.total)} en el rango (${formatNumber(substitute.committed)} comprometidas)`}
                        >
                          <span className="admin-nowrap">{formatNumber(substitute.available)}</span>
                        </AdminCell>
                        <AdminCell end title={`${formatNumber(substitute.total)} unidades`}>
                          {formatNumber(substitute.total)}
                        </AdminCell>
                        <AdminCell>
                          <AdminBadge tone={statusTone(substitute.status)}>{inventoryStatusLabel(substitute.status)}</AdminBadge>
                        </AdminCell>
                      </AdminRow>
                    ))}
                  </AdminTable>
                ) : (
                  <AdminNote>
                    Sin sustitutos de la categoría «{selected.category}» con stock libre en el rango.
                  </AdminNote>
                )}
                <p className="admin-note">
                  Los sustitutos se vinculan desde el presupuesto (Presupuestos → Inventario del presupuesto) para que la
                  aprobación reserve el reemplazo.
                </p>
              </>
            )
          ) : (
            <AdminNote>Elegí un rango (desde y hasta) para ver los rangos comprometidos y los sustitutos sugeridos.</AdminNote>
          )}

          {selected.assignments.length === 0 ? (
            <AdminEmpty
              icon="inventory"
              title="Sin asignaciones"
              hint="Los equipos se asignan a los eventos con cantidad y rango de fechas desde el módulo Eventos, o se reservan al aprobar un presupuesto con ítems vinculados."
            />
          ) : (
            <AdminTable
              view="inventario-asignaciones"
              label={`Asignaciones de ${selected.name}`}
              columns={[
                { label: "Evento" },
                { label: "Rango" },
                { label: "Cantidad", end: true },
                { label: "Salida" },
                { label: "Devolución" },
                { label: "Estado" },
                { label: "Daños" },
              ]}
            >
              {selected.assignments.map((assignment) => {
                const state = inventoryAssignmentState(assignment);
                const countdown = inventoryAssignmentCountdown(assignment);
                const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
                const startsAt = assignment.startsAt ?? assignment.event.startsAt;
                const endsAt = assignment.endsAt ?? assignment.event.endsAt ?? startsAt;
                return (
                  <AdminRow key={assignment.id}>
                    <AdminCell title={assignment.event.name}>{assignment.event.name}</AdminCell>
                    <AdminCell title={startsAt && endsAt ? rangeStamp(startsAt, endsAt) : "Sin fechas"}>
                      {rangeStamp(startsAt, endsAt)}
                    </AdminCell>
                    <AdminCell end title={`${formatNumber(assignment.quantity)} unidades`}>
                      {formatNumber(assignment.quantity)}
                    </AdminCell>
                    <AdminCell title={assignment.checkedOutAt ? `Salida: ${stamp(assignment.checkedOutAt)}` : undefined}>
                      {stamp(assignment.checkedOutAt)}
                    </AdminCell>
                    <AdminCell title={assignment.checkedInAt ? `Devolución: ${stamp(assignment.checkedInAt)}` : undefined}>
                      {stamp(assignment.checkedInAt)}
                    </AdminCell>
                    <AdminCell title={countdown ? countdown.title : "Asignación cerrada"}>
                      <AdminBadge tone={state.tone}>{state.label}</AdminBadge>
                      {countdown ? (
                        <AdminCountdown
                          value={countdown.at}
                          short
                          className="admin-countdown--inline"
                          title={`${countdown.title}: ${selected.name}`}
                        />
                      ) : null}
                    </AdminCell>
                    <AdminCell
                      title={damages ? `${damages}${assignment.damageNotes ? ` · ${assignment.damageNotes}` : ""}` : "Sin daños ni faltantes"}
                    >
                      {damages ?? "—"}
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminPanel>
      ) : null}

      <AdminDisclosure title="ARCHIVADOS" hint={`${archivedRows.length} productos · conserva sus datos y estado operativo`}>
        {archivedRows.length ? <AdminCardGrid label="Productos archivados" cards={archivedRows.map(item => ({
          id: item.id, title: item.name, subtitle: item.category,
          fields: [{ label: "Archivado", value: formatDateShort(item.archivedAt) }, { label: "Estado operativo", value: inventoryStatusLabel(item.status) }, { label: "Unidades", value: formatNumber(item.quantity) }, { label: "Cliente final", value: priceText(item.listPrice) }, { label: "Mayorista", value: priceText(item.wholesalePrice) }],
          footer: <span className="admin-actions"><AdminButton icon="info" title={`Ver producto archivado ${item.name}`} aria-label={`Ver producto archivado ${item.name}`} onClick={() => selectInventory(item.id)}>Ver ficha</AdminButton>{writable ? <AdminButton icon="refresh" title={`Restaurar producto ${item.name}`} aria-label={`Restaurar producto ${item.name}`} busy={archiveBusyId === item.id} disabled={Boolean(archiveBusyId) && archiveBusyId !== item.id} onClick={() => void archiveItem(item, true)}>Restaurar</AdminButton> : null}</span>,
        }))} /> : <AdminEmpty icon="inventory" title="Sin productos archivados" hint="Los productos activos se muestran arriba." />}
      </AdminDisclosure>
    </div>
  );
}
