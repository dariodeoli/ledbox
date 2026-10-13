"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  damageSummary,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  inventoryAssignmentCountdown,
  inventoryAssignmentState,
  inventoryKindLabel,
  inventoryStatusLabel,
  statusTone,
} from "@/lib/admin-format";
import { inventoryAvailabilityLabel } from "@/lib/inventory-availability-label";
import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
  inventoryPriceValue,
  inventoryPriceWarning,
  inventoryUnitCodeValid,
  normalizeInventoryUnitCode,
} from "@/lib/field-rules";
import type {
  AdminApiResponse,
  AdminAuditRow,
  AdminInventoryAvailability,
  AdminInventoryItemRow,
  AdminInventorySubstitute,
  AdminInventoryUnitRow,
} from "@/lib/admin-types";
import { CATALOG_AUDIENCE_LABEL, effectiveAudience } from "@/lib/catalog-audience";
import { comboCapacityLabel } from "@/lib/inventory-combos";
import { INVENTORY_FIELD_HELP } from "@/lib/inventory-bulk";
import {
  TIMELINE_KIND_LABEL,
  buildTimeline,
  combosUsing,
  stockSummary,
  unitProblemCounts,
  type TimelineBar,
} from "@/lib/inventory-view";
import { adminApiGet, adminSend, useAdminResource } from "@/lib/admin-api";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDialog,
  AdminDialogSection,
  AdminDisclosure,
  AdminEmpty,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
} from "../AdminUI";
import { DateField, MoneyField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { InventoryBulkEditor } from "./InventoryBulkEditor";
import { InventoryIncidentsPanel } from "./InventoryIncidents";
import {
  AudienceChip,
  InventoryThumb,
  RowCheck,
  STATUS_PICK_OPTIONS,
  StockMeter,
  UNIT_STATUS_PICK_OPTIONS,
  dayRangeLabel,
  daysText,
  priceText,
  rangeStamp,
  stamp,
} from "./InventoryParts";

const SECTION_LABELS = {
  resumen: "Resumen",
  disponibilidad: "Disponibilidad",
  unidades: "Unidades",
  precios: "Precios",
  tienda: "Tienda web",
  combos: "Combos",
  incidentes: "Incidentes",
  historial: "Historial",
} as const;

type SectionKey = keyof typeof SECTION_LABELS;

export type InventoryRangeControls = {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
};

/** Horas de un colchón en minutos: vacío = hereda el de la empresa. */
function bufferText(minutes: number | null | undefined): string {
  if (typeof minutes !== "number") return "Como la empresa";
  const hours = minutes / 60;
  return `${formatNumber(Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10)} h`;
}

/** Mini línea de tiempo de las próximas 4 semanas: reservas y retenciones del producto. */
function AvailabilityTimeline({ item }: { item: AdminInventoryItemRow }) {
  const timeline = useMemo(() => buildTimeline(item.assignments, new Date(), 4), [item.assignments]);
  if (timeline.bars.length === 0) {
    return <AdminNote>Sin reservas ni retenciones en las próximas 4 semanas.</AdminNote>;
  }
  const height = timeline.lanes * 26 + 4;
  const describe = (bar: TimelineBar) =>
    `${TIMELINE_KIND_LABEL[bar.kind]} · ${bar.eventName} · ${formatNumber(bar.quantity)} u. · ${rangeStamp(bar.startsAt.toISOString(), bar.endsAt.toISOString())}${
      bar.holdExpiresAt ? ` · vence ${formatDateTime(bar.holdExpiresAt.toISOString())}` : ""
    }`;
  return (
    <div className="admin-timeline">
      <div className="admin-timeline-scale" aria-hidden="true">
        {Array.from({ length: timeline.weeks }, (_, index) => (
          <span key={index}>{formatDateShort(new Date(timeline.start.getTime() + index * 7 * 86_400_000))}</span>
        ))}
      </div>
      <div className="admin-timeline-track" style={{ height }} aria-hidden="true">
        {timeline.bars.map((bar) => (
          <span
            key={bar.id}
            className="admin-timeline-bar"
            data-kind={bar.kind}
            title={describe(bar)}
            style={{ left: `${bar.left}%`, width: `${bar.width}%`, top: bar.lane * 26 + 2 }}
          >
            {formatNumber(bar.quantity)} · {bar.eventName}
          </span>
        ))}
      </div>
      <ul className="admin-timeline-list" aria-label={`Reservas y retenciones de ${item.name} en las próximas 4 semanas`}>
        {timeline.bars.map((bar) => (
          <li key={bar.id}>
            <span className="admin-timeline-dot" data-kind={bar.kind} aria-hidden="true" />
            <span className="admin-timeline-what">
              <strong>{bar.eventName}</strong>
              <small>
                {TIMELINE_KIND_LABEL[bar.kind]} · {formatNumber(bar.quantity)} u.
                {bar.holdExpiresAt ? ` · vence ${formatDateTime(bar.holdExpiresAt.toISOString())}` : ""}
              </small>
            </span>
            <span className="admin-timeline-when admin-nowrap">{rangeStamp(bar.startsAt.toISOString(), bar.endsAt.toISOString())}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ficha del producto: panel lateral con las secciones Resumen, Disponibilidad,
 * Unidades, Precios, Tienda web, Combos, Incidentes e Historial. Toda la lógica
 * de unidades (alta, estado, edición, lote) vive acá; la edición del producto y
 * el archivado los resuelve el módulo con el mismo contrato de siempre.
 */
export function InventoryFicha({
  item,
  inventory,
  writable,
  canReadAudit,
  range,
  statusBusy,
  archiveBusy,
  onClose,
  onEdit,
  onEditCombo,
  onArchive,
  onChangeStatus,
  onChanged,
  onOpenProduct,
  banner,
}: {
  item: AdminInventoryItemRow;
  inventory: AdminInventoryItemRow[];
  writable: boolean;
  /** OWNER y ADMIN leen la auditoría; el resto ve solo las asignaciones. */
  canReadAudit: boolean;
  range: InventoryRangeControls;
  statusBusy: boolean;
  archiveBusy: boolean;
  onClose: () => void;
  onEdit: (item: AdminInventoryItemRow) => void;
  onEditCombo: (item: AdminInventoryItemRow) => void;
  onArchive: (item: AdminInventoryItemRow, restore: boolean) => void;
  onChangeStatus: (item: AdminInventoryItemRow, next: string) => void;
  onChanged: () => void;
  onOpenProduct: (id: string) => void;
  /** Aviso del módulo (estado cambiado, archivado, error) para que se vea con la ficha abierta. */
  banner?: { tone?: "ok" | "warn" | "error"; text: string } | null;
}) {
  const uid = useId();
  const { from, to } = range;
  const rangeActive = Boolean(from && to);
  const isCombo = Boolean(item.combo);
  const archived = Boolean(item.archivedAt);

  // Unidades físicas (issue #112): alta, estado y edición.
  const [unitBusyId, setUnitBusyId] = useState("");
  const [unitError, setUnitError] = useState("");
  const [unitNotice, setUnitNotice] = useState("");
  const [unitDialog, setUnitDialog] = useState<AdminInventoryUnitRow | null>(null);
  const [unitEditorOpen, setUnitEditorOpen] = useState(false);
  const [unitForm, setUnitForm] = useState({ code: "", status: "AVAILABLE", purchaseCost: "", notes: "" });
  const [unitDialogBusy, setUnitDialogBusy] = useState(false);
  const [unitDialogError, setUnitDialogError] = useState("");
  const [bulkUnitIds, setBulkUnitIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Disponibilidad del producto en el rango pedido + sustitutos sugeridos (issue #18).
  const [rangeAvailability, setRangeAvailability] = useState<AdminInventoryAvailability | null>(null);
  const [substitutes, setSubstitutes] = useState<AdminInventorySubstitute[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState("");

  const audit = useAdminResource(
    `/api/admin/audit?entity=InventoryItem&entityId=${encodeURIComponent(item.id)}&pageSize=10`,
    (payload: AdminApiResponse) => payload.auditLogs ?? ([] as AdminAuditRow[]),
    { enabled: canReadAudit },
  );

  useEffect(() => {
    if (!rangeActive) {
      setRangeAvailability(null);
      setSubstitutes([]);
      setRangeError("");
      setRangeLoading(false);
      return;
    }
    const params = new URLSearchParams({ inventoryId: item.id, startsAt: `${from}T00:00`, endsAt: `${to}T23:59` });
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
  }, [item.id, rangeActive, from, to]);

  const summary = stockSummary(item, rangeActive);
  const problems = unitProblemCounts([item]);
  const priceWarning = inventoryPriceWarning(item);
  const usedIn = useMemo(() => (isCombo ? [] : combosUsing(inventory, item.id)), [inventory, isCombo, item.id]);
  const audience = effectiveAudience(item);
  const toggleUnit = (id: string) =>
    setBulkUnitIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length < 100 ? [...current, id] : current));

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
    onChanged();
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
    if (!unitEditorOpen || unitDialogBusy) return;
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
      ...(unitDialog ? { id: unitDialog.id } : { inventoryId: item.id }),
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
    onChanged();
  }

  const sections: SectionKey[] = isCombo
    ? ["resumen", "disponibilidad", "precios", "tienda", "combos", "historial"]
    : ["resumen", "disponibilidad", "unidades", "precios", "tienda", "combos", "incidentes", "historial"];
  const anchor = (key: SectionKey) => `${uid}-${key}`;
  const jump = (key: SectionKey) => document.getElementById(anchor(key))?.scrollIntoView({ behavior: "smooth", block: "start" });
  const editLabel = isCombo ? "Editar combo" : "Editar producto";

  return (
    <AdminDialog
      title={item.name}
      icon="inventory"
      size="ficha"
      description={[item.category, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(" · ")}
      dirty={unitEditorOpen}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          {writable ? (
            <AdminButton
              icon={archived ? "refresh" : "inventory"}
              type="button"
              busy={archiveBusy}
              disabled={unitEditorOpen}
              title={archived ? `Restaurar producto ${item.name}` : `Archivar producto ${item.name}`}
              onClick={() => onArchive(item, archived)}
            >
              {archived ? "Restaurar" : "Archivar"}
            </AdminButton>
          ) : null}
          <span className="admin-dialog-spacer" />
          <AdminButton type="button" icon="close" onClick={requestClose}>
            Cerrar
          </AdminButton>
          {writable ? (
            <AdminButton
              type="button"
              variant="primary"
              icon="edit"
              disabled={unitEditorOpen}
              title={`${editLabel}: ${item.name}`}
              onClick={() => (isCombo ? onEditCombo(item) : onEdit(item))}
            >
              {editLabel}
            </AdminButton>
          ) : null}
        </>
      )}
    >
      {banner ? <AdminNote tone={banner.tone}>{banner.text}</AdminNote> : null}
      <nav className="admin-ficha-nav" aria-label={`Secciones de ${item.name}`}>
        {sections.map((key) => (
          <button key={key} type="button" className="admin-subtab" onClick={() => jump(key)}>
            {key === "combos" ? (isCombo ? "Componentes" : "Combos") : SECTION_LABELS[key]}
          </button>
        ))}
      </nav>

      <AdminDialogSection title="Resumen" id={anchor("resumen")} stack>
        <div className="admin-ficha-hero">
          <InventoryThumb item={item} size={96} />
          <div className="admin-ficha-hero-main">
            <div className="admin-ficha-badges">
              {archived ? <AdminBadge tone="neutral" title={`Archivado el ${formatDateShort(item.archivedAt)}`}>Archivado</AdminBadge> : null}
              {isCombo ? (
                <AdminBadge tone="accent" title="Sin unidades propias: se arma con sus componentes.">Combo</AdminBadge>
              ) : (
                <AdminBadge tone={statusTone(item.kind)}>{inventoryKindLabel(item.kind)}</AdminBadge>
              )}
              <AudienceChip item={item} />
              {(rangeActive ? (item.availability.range?.overcommitted ?? false) : item.availability.overcommittedNow) ? (
                <AdminBadge tone="danger" title="Hay más unidades comprometidas que las que tiene el producto.">Conflicto</AdminBadge>
              ) : null}
              {writable ? (
                <AdminSelect
                  className="admin-filter admin-filter--cell"
                  value={item.status}
                  disabled={statusBusy}
                  onChange={(value) => onChangeStatus(item, value)}
                  label={`Cambiar estado: ${item.name}`}
                  title={`Cambiar estado: ${item.name}`}
                  options={STATUS_PICK_OPTIONS}
                  tone={statusTone(item.status)}
                />
              ) : (
                <AdminBadge tone={statusTone(item.status)}>{inventoryStatusLabel(item.status)}</AdminBadge>
              )}
            </div>
            <dl className="admin-ficha-stats">
              <div>
                <dt>{rangeActive ? "Libres en el rango" : "Libres hoy"}</dt>
                <dd>
                  <StockMeter summary={summary} combo={isCombo} large />
                </dd>
              </div>
              {isCombo ? (
                <div>
                  <dt>Componentes</dt>
                  <dd>{formatNumber(item.combo?.components.length ?? 0)}</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>Unidades</dt>
                    <dd>{formatNumber(item.quantity)}</dd>
                  </div>
                  <div>
                    <dt>Comprometidas ahora</dt>
                    <dd>{formatNumber(item.availability.committedNow)}</dd>
                  </div>
                  <div>
                    <dt>Fuera de circulación</dt>
                    <dd title={`${problems.maintenance} en mantenimiento · ${problems.damaged} dañadas · ${problems.lost} perdidas`}>
                      {formatNumber(item.availability.maintenanceNow)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        </div>
        {priceWarning ? <AdminNote tone="warn">{priceWarning}</AdminNote> : null}
        {item.notes ? <p className="admin-note" title="Notas internas: no se publican.">{item.notes}</p> : null}
      </AdminDialogSection>

      <AdminDialogSection title="Disponibilidad · próximas 4 semanas" id={anchor("disponibilidad")} stack>
        <AvailabilityTimeline item={item} />
        <div className="admin-ficha-range">
          <DateField
            label="Disponible desde"
            help="Inicio del rango para consultar unidades libres; no crea reservas."
            max={to || undefined}
            value={from}
            onChange={range.setFrom}
            title="Primer día del rango de disponibilidad"
          />
          <DateField
            label="Hasta"
            help="Fin del rango de disponibilidad; no cambia las fechas de las asignaciones existentes."
            min={from || undefined}
            value={to}
            onChange={range.setTo}
            title="Último día del rango de disponibilidad"
          />
          {rangeActive ? (
            <AdminButton
              icon="close"
              type="button"
              title="Quitar el rango y volver a la disponibilidad de hoy"
              aria-label="Quitar el rango de disponibilidad"
              onClick={() => {
                range.setFrom("");
                range.setTo("");
              }}
            >
              Hoy
            </AdminButton>
          ) : null}
        </div>
        {rangeActive ? (
          rangeLoading ? (
            <AdminNote>Calculando la disponibilidad del rango…</AdminNote>
          ) : rangeError ? (
            <AdminNote tone="error">{rangeError}</AdminNote>
          ) : (
            <>
              <AdminNote tone={rangeAvailability && rangeAvailability.available === 0 ? "error" : undefined}>
                {rangeAvailability
                  ? `${inventoryAvailabilityLabel(rangeAvailability.available, "free", true)} de ${formatNumber(rangeAvailability.total)} entre ${dayRangeLabel(from, to)}.`
                  : "Sin datos de disponibilidad para el rango."}
                {rangeAvailability?.blocked
                  ? ` «${rangeAvailability.name}» está ${rangeAvailability.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`
                  : ""}
                {rangeAvailability && rangeAvailability.conflicts.length > 0
                  ? ` ${inventoryAvailabilityLabel(rangeAvailability.committed, "committed", true)}: ${rangeAvailability.conflicts
                      .map((conflict) => `${conflict.eventName} (${formatNumber(conflict.quantity)})`)
                      .join(", ")}.`
                  : " Sin rangos comprometidos en el rango."}
              </AdminNote>

              {rangeAvailability && rangeAvailability.conflicts.length > 0 ? (
                <AdminTable
                  view="inventario-rangos"
                  label={`Rangos comprometidos de ${item.name} en el rango`}
                  columns={[{ label: "Evento" }, { label: "Rango comprometido" }, { label: "Cantidad", end: true }]}
                >
                  {rangeAvailability.conflicts.map((conflict) => (
                    <AdminRow key={conflict.id}>
                      <AdminCell title={conflict.eventName}>{conflict.eventName}</AdminCell>
                      <AdminCell title={rangeStamp(conflict.startsAt, conflict.endsAt)}>{rangeStamp(conflict.startsAt, conflict.endsAt)}</AdminCell>
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
                  label={`Sustitutos de ${item.name} con stock libre en el rango`}
                  columns={[{ label: "Sustituto" }, { label: "Categoría" }, { label: "Libres", end: true }, { label: "Total", end: true }, { label: "Estado" }]}
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
                        title={`${inventoryAvailabilityLabel(substitute.available)} de ${formatNumber(substitute.total)} en el rango (${inventoryAvailabilityLabel(substitute.committed, "committed")})`}
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
              ) : isCombo ? null : (
                <AdminNote>Sin sustitutos de la categoría «{item.category}» con stock libre en el rango.</AdminNote>
              )}
              {isCombo ? null : (
                <p className="admin-note">
                  Los sustitutos se vinculan desde el presupuesto (Presupuestos → Inventario del presupuesto) para que la aprobación reserve el reemplazo.
                </p>
              )}
            </>
          )
        ) : (
          <AdminNote>Elegí un rango (desde y hasta) para ver los rangos comprometidos y los sustitutos sugeridos.</AdminNote>
        )}
      </AdminDialogSection>

      {isCombo ? null : (
        <AdminDialogSection id={anchor("unidades")} stack title={`Unidades · ${formatNumber(item.units.length)}${item.availability.maintenanceNow > 0 ? ` · ${formatNumber(item.availability.maintenanceNow)} fuera de circulación` : ""}`}>
          {/* Unidades físicas (issue #112): código, estado y costo por unidad. */}
          <div className="admin-unit-head" aria-label={`Unidades de ${item.name}`}>
            <span className="admin-unit-summary">
              {problems.total > 0
                ? `${formatNumber(problems.maintenance)} en mantenimiento · ${formatNumber(problems.damaged)} dañadas · ${formatNumber(problems.lost)} perdidas`
                : "Todas las unidades en circulación"}
            </span>
            <span className="admin-actions">
              {writable && bulkUnitIds.length > 0 ? (
                <AdminButton icon="edit" type="button" onClick={() => setBulkOpen(true)} title="Editar en lote las unidades seleccionadas">
                  Editar {formatNumber(bulkUnitIds.length)} en lote
                </AdminButton>
              ) : null}
              {writable ? (
                <AdminButton
                  icon="plus"
                  type="button"
                  title="Agregar una unidad con código automático"
                  disabled={unitEditorOpen}
                  onClick={() => addInventoryUnit()}
                >
                  Agregar unidad
                </AdminButton>
              ) : null}
            </span>
          </div>
          {unitNotice ? <AdminNote tone="ok">{unitNotice}</AdminNote> : null}
          {unitError ? <AdminNote tone="error">{unitError}</AdminNote> : null}
          {writable && unitEditorOpen ? (
            <form className="admin-form" aria-label={unitDialog ? `Editar unidad ${unitDialog.code}` : "Agregar unidad"} onSubmit={(event) => void submitUnitDialog(event)}>
              <TextField
                label="Código de unidad"
                help={INVENTORY_FIELD_HELP.code}
                required={Boolean(unitDialog)}
                maxLength={FIELD_LIMITS.unitCode}
                value={unitForm.code}
                onChange={(value) => setUnitForm({ ...unitForm, code: normalizeInventoryUnitCode(value) })}
                hint={unitDialog ? "Único por empresa." : "Vacío: genera un código único al guardar."}
                disabled={unitDialogBusy}
              />
              <SelectField
                label="Estado de unidad"
                help={INVENTORY_FIELD_HELP.unitStatus}
                value={unitForm.status}
                onChange={(value) => setUnitForm({ ...unitForm, status: value })}
                options={UNIT_STATUS_PICK_OPTIONS}
                disabled={unitDialogBusy}
              />
              <MoneyField
                label="Costo que tuvo"
                help={INVENTORY_FIELD_HELP.purchaseCost}
                value={unitForm.purchaseCost}
                onChange={(value) => setUnitForm({ ...unitForm, purchaseCost: value })}
                hint="Costo interno de adquisición de esta unidad; no es un presupuesto de reparación."
                disabled={unitDialogBusy}
              />
              <TextAreaField
                label="Notas de unidad"
                help={INVENTORY_FIELD_HELP.notes}
                maxLength={400}
                rows={3}
                wide
                value={unitForm.notes}
                onChange={(value) => setUnitForm({ ...unitForm, notes: value })}
                hint="Detalle libre existente; no hay fechas ni taller de reparación estructurados."
                disabled={unitDialogBusy}
              />
              {unitDialogError ? <AdminNote tone="error">{unitDialogError}</AdminNote> : null}
              <div className="admin-form-actions">
                <AdminButton
                  type="button"
                  onClick={() => {
                    setUnitEditorOpen(false);
                    setUnitDialog(null);
                  }}
                  disabled={unitDialogBusy}
                >
                  Cancelar unidad
                </AdminButton>
                <AdminButton variant="primary" icon="check" type="submit" busy={unitDialogBusy}>
                  Guardar unidad
                </AdminButton>
              </div>
            </form>
          ) : null}
          {writable && bulkOpen && bulkUnitIds.length ? (
            <InventoryBulkEditor
              target="units"
              selection={bulkUnitIds.map((id) => ({ id, label: item.units.find((unit) => unit.id === id)?.code ?? id }))}
              onSaved={onChanged}
              onClose={() => setBulkOpen(false)}
              onClear={() => {
                setBulkUnitIds([]);
                setBulkOpen(false);
              }}
            />
          ) : null}
          {item.units.length === 0 ? (
            <AdminNote>Sin unidades cargadas: agregá la primera para poder asignar «{item.name}» a un evento.</AdminNote>
          ) : (
            <AdminDisclosure title="Lista de unidades" hint={`${formatNumber(item.units.length)} · código, estado y costo`} defaultOpen={item.units.length <= 12 || problems.total > 0}>
            <AdminTable
              view="inventario-unidades"
              label={`Unidades de ${item.name}`}
              columns={[{ label: "Código" }, { label: "Estado" }, { label: "Costo", end: true }, { label: "Acciones", end: true }]}
            >
              {item.units.map((unit) => (
                <AdminRow key={unit.id}>
                  <AdminCell title={unit.notes ? `${unit.code} · ${unit.notes}` : unit.code}>
                    {writable ? (
                      <RowCheck
                        checked={bulkUnitIds.includes(unit.id)}
                        disabled={bulkUnitIds.length >= 100 && !bulkUnitIds.includes(unit.id)}
                        label={`Seleccionar unidad ${unit.code}`}
                        onToggle={() => toggleUnit(unit.id)}
                      />
                    ) : null}
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
            </AdminDisclosure>
          )}
        </AdminDialogSection>
      )}

      <AdminDialogSection title="Precios" id={anchor("precios")} stack>
        <dl className="admin-item-prices">
          <div>
            <dt>Cliente final</dt>
            <dd>{priceText(item.listPrice)}</dd>
            {item.listFromPrice > 0 && item.listFromDays > 0 ? (
              <small>
                {daysText(item.listFromDays)}: {priceText(item.listFromPrice)}
              </small>
            ) : null}
          </div>
          <div>
            <dt>Mayorista</dt>
            <dd>{priceText(item.wholesalePrice)}</dd>
            {item.wholesaleFromPrice > 0 && item.wholesaleFromDays > 0 ? (
              <small>
                {daysText(item.wholesaleFromDays)}: {priceText(item.wholesaleFromPrice)}
              </small>
            ) : null}
          </div>
          <div>
            <dt>Mínimo</dt>
            <dd>{priceText(item.minimumPrice)}</dd>
          </div>
        </dl>
        <dl className="admin-item-prices">
          <div>
            <dt>Costo diario</dt>
            <dd>{priceText(item.dailyCost)}</dd>
            <small>Interno, no es un precio de venta.</small>
          </div>
          <div>
            <dt>Reposición</dt>
            <dd>{priceText(item.replacementCost)}</dd>
            <small>Interno, por unidad.</small>
          </div>
          <div>
            <dt>Tiempo antes</dt>
            <dd>{bufferText(item.bufferBeforeMin)}</dd>
            <small>Preparación y entrega.</small>
          </div>
          <div>
            <dt>Tiempo después</dt>
            <dd>{bufferText(item.bufferAfterMin)}</dd>
            <small>Devolución y limpieza.</small>
          </div>
        </dl>
      </AdminDialogSection>

      <AdminDialogSection title="Tienda web" id={anchor("tienda")} stack>
        <p className="admin-note">
          <AudienceChip item={item} />
          <span>
            {audience === "HIDDEN"
              ? "No se publica en la tienda web de la empresa."
              : `Se publica en la tienda web para ${CATALOG_AUDIENCE_LABEL[audience].toLowerCase()}.${audience !== "RETAIL" ? " El catálogo mayorista solo se ve con el link privado de cada cliente." : ""}`}
          </span>
        </p>
        {item.publicDescription ? (
          <p className="admin-ficha-description">{item.publicDescription}</p>
        ) : (
          <AdminNote>Sin descripción pública cargada{writable ? ": se completa en «Editar»." : "."}</AdminNote>
        )}
      </AdminDialogSection>

      <AdminDialogSection title={isCombo ? "Componentes" : "Combos donde se usa"} id={anchor("combos")} stack>
        {item.combo ? (
          <>
            <AdminNote tone={item.combo.capacity === 0 ? "warn" : "ok"}>
              {comboCapacityLabel(item.combo.capacity)}
              {item.combo.limiting
                ? ` · componente limitante: «${item.combo.limiting.name}» (${formatNumber(item.combo.limiting.available)} libres, ${formatNumber(item.combo.limiting.perCombo)} por combo)`
                : ""}
            </AdminNote>
            <AdminTable
              view="inventario-combo"
              label={`Componentes de ${item.name}`}
              columns={[{ label: "Componente" }, { label: "Por combo", end: true }, { label: "Libres", end: true }, { label: "Alcanza para", end: true }]}
            >
              {item.combo.components.map((component) => (
                <AdminRow key={component.componentId}>
                  <AdminCell title={component.name}>
                    <strong>{component.name}</strong>
                    {item.combo?.limiting?.componentId === component.componentId ? (
                      <AdminBadge tone="warn" title="Es el componente que fija cuántos combos se pueden armar.">Limitante</AdminBadge>
                    ) : null}
                    <small className="admin-cell-sub"> · {component.category}</small>
                  </AdminCell>
                  <AdminCell end>{formatNumber(component.quantity)}</AdminCell>
                  <AdminCell end>{formatNumber(component.available)}</AdminCell>
                  <AdminCell end>{formatNumber(component.canMake)}</AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          </>
        ) : usedIn.length === 0 ? (
          <AdminNote>No forma parte de ningún combo.</AdminNote>
        ) : (
          <ul className="admin-ficha-links" aria-label={`Combos que usan ${item.name}`}>
            {usedIn.map((combo) => {
              const component = combo.combo?.components.find((candidate) => candidate.componentId === item.id);
              return (
                <li key={combo.id}>
                  <AdminButton type="button" icon="inventory" title={`Abrir la ficha del combo ${combo.name}`} onClick={() => onOpenProduct(combo.id)}>
                    {combo.name}
                  </AdminButton>
                  <small>
                    {formatNumber(component?.quantity ?? 0)} por combo · {comboCapacityLabel(combo.combo?.capacity ?? 0)}
                  </small>
                </li>
              );
            })}
          </ul>
        )}
      </AdminDialogSection>

      {isCombo ? null : (
        <AdminDialogSection title="Incidentes" id={anchor("incidentes")} stack>
          <InventoryIncidentsPanel inventoryId={item.id} writable={writable} onChanged={onChanged} />
        </AdminDialogSection>
      )}

      <AdminDialogSection title="Historial" id={anchor("historial")} stack>
        {item.assignments.length === 0 ? (
          <AdminEmpty
            icon="inventory"
            title="Sin asignaciones"
            hint="Los equipos se asignan a los eventos con cantidad y rango de fechas desde el módulo Eventos, o se reservan al aprobar un presupuesto con ítems vinculados."
          />
        ) : (
          <AdminTable
            view="inventario-asignaciones"
            label={`Asignaciones de ${item.name}`}
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
            {item.assignments.map((assignment) => {
              const state = inventoryAssignmentState(assignment);
              const countdown = inventoryAssignmentCountdown(assignment);
              const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
              const startsAt = assignment.startsAt ?? assignment.event.startsAt;
              const endsAt = assignment.endsAt ?? assignment.event.endsAt ?? startsAt;
              return (
                <AdminRow key={assignment.id}>
                  <AdminCell title={assignment.event.name}>{assignment.event.name}</AdminCell>
                  <AdminCell title={startsAt && endsAt ? rangeStamp(startsAt, endsAt) : "Sin fechas"}>{rangeStamp(startsAt, endsAt)}</AdminCell>
                  <AdminCell end title={`${formatNumber(assignment.quantity)} unidades`}>
                    {formatNumber(assignment.quantity)}
                  </AdminCell>
                  <AdminCell title={assignment.checkedOutAt ? `Salida: ${stamp(assignment.checkedOutAt)}` : undefined}>{stamp(assignment.checkedOutAt)}</AdminCell>
                  <AdminCell title={assignment.checkedInAt ? `Devolución: ${stamp(assignment.checkedInAt)}` : undefined}>{stamp(assignment.checkedInAt)}</AdminCell>
                  <AdminCell title={countdown ? countdown.title : "Asignación cerrada"}>
                    <AdminBadge tone={state.tone}>{state.label}</AdminBadge>
                    {countdown ? (
                      <AdminCountdown value={countdown.at} short className="admin-countdown--inline" title={`${countdown.title}: ${item.name}`} />
                    ) : null}
                  </AdminCell>
                  <AdminCell title={damages ? `${damages}${assignment.damageNotes ? ` · ${assignment.damageNotes}` : ""}` : "Sin daños ni faltantes"}>
                    {damages ?? "—"}
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
        {canReadAudit ? (
          audit.error ? (
            <AdminNote tone="error">{audit.error}</AdminNote>
          ) : audit.loading ? (
            <AdminNote>Cargando los cambios registrados…</AdminNote>
          ) : (audit.data ?? []).length === 0 ? (
            <AdminNote>Todavía no hay cambios registrados para este producto.</AdminNote>
          ) : (
            <ul className="admin-ficha-audit" aria-label={`Cambios registrados de ${item.name}`}>
              {(audit.data ?? []).map((row) => (
                <li key={row.id}>
                  <span className="admin-ficha-audit-what">{row.summary}</span>
                  <small>
                    {row.actorName} · {formatDateTime(row.createdAt)}
                  </small>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </AdminDialogSection>
    </AdminDialog>
  );
}
