"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDateShort, formatNumber, inventoryKindLabel, inventoryStatusLabel } from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import { csvBool, csvFilename, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import type { AdminInventoryIncident, AdminInventoryItemRow, AdminInventoryOccupancy } from "@/lib/admin-types";
import { INVENTORY_FOCUS_LABEL, INVENTORY_TABS, isPublished, itemInFocus, tabCounts, unitProblemCounts, type InventoryFocus } from "@/lib/inventory-view";
import { useAdminSession } from "../AdminShell";
import {
  AdminActionsMenu,
  AdminButton,
  AdminDataState,
  AdminDisclosure,
  AdminEmpty,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminSelect,
  AdminToolbar,
} from "../AdminUI";
import { DateField, SearchField } from "../AdminFields";
import { kpiState } from "@/components/admin/kpi-state";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { InventoryIncidentsDialog } from "./InventoryIncidents";
import { AdminViewSwitch, useAdminModuleView, useAdminNarrowViewport } from "../AdminBoard";
import { AdminCardGrid } from "../AdminCards";
import { ComboDialog } from "./ComboDialog";
import { InventoryBulkEditor } from "./InventoryBulkEditor";
import { InventoryFicha } from "./InventoryFicha";
import { InventoryCreateDialog, InventoryEditDialog, type InventoryNotice } from "./InventoryItemDialogs";
import { OverdueReturnsIndicator } from "./OverdueReturns";
import { InventoryList } from "./InventoryList";
import { TrashDialog, trashMenuItems } from "../TrashDialogs";
import { KIND_OPTIONS, STATUS_OPTIONS, dayRangeLabel, priceText } from "./InventoryParts";

/** Vistas del inventario (issue #57): lista densa y cuadrícula de tarjetas. */
const INVENTARIO_VIEWS = ["list", "grid"] as const;

/** Tope de la edición en lote: el mismo que valida el API. */
const BULK_LIMIT = 100;

/** Cambia el parámetro `?producto=` sin recargar ni apilar historial. */
function syncProductParam(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("producto", id);
  else url.searchParams.delete("producto");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Inventario: qué tengo, cuánto queda libre hoy y qué necesita atención.
 * Orden: acciones → indicadores que filtran → pestañas → filtros → lista (o
 * tarjetas con foto) → ficha lateral del producto (`?producto=<id>` la abre por
 * link). La disponibilidad la calcula el API; acá solo se muestra.
 */
export function InventarioModule() {
  const { role } = useAdminSession();
  const searchParams = useSearchParams();
  const productParam = searchParams.get("producto")?.trim() ?? "";
  const handledProductParam = useRef("");

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [focus, setFocus] = useState<InventoryFocus>("all");
  const [showForm, setShowForm] = useState(false);
  const [incidentsOpen, setIncidentsOpen] = useState(false);
  const [comboDialog, setComboDialog] = useState<{ item: AdminInventoryItemRow | null } | null>(null);
  const [editItem, setEditItem] = useState<AdminInventoryItemRow | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState<InventoryNotice | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const [archiveBusyId, setArchiveBusyId] = useState("");
  /** Producto que se está por mandar a la papelera (diálogo de eliminar). */
  const [trashTarget, setTrashTarget] = useState<AdminInventoryItemRow | null>(null);
  const [bulkItemIds, setBulkItemIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [view, setView] = useAdminModuleView("inventario", INVENTARIO_VIEWS);
  /** Ancho compacto (issue #151): las tarjetas de la cuadrícula, siempre. */
  const narrow = useAdminNarrowViewport();

  const writable = canWriteOperations(role);
  const canReadAudit = role === "OWNER" || role === "ADMIN";
  const rangeActive = Boolean(from && to);

  // La lista viaja con el rango cuando está completo: el API devuelve la
  // disponibilidad de cada ítem en ese rango además de la de hoy.
  const listPath = useMemo(() => {
    const params = new URLSearchParams({ vivas: "1" });
    if (from) params.set("startsAt", `${from}T00:00`);
    if (to) params.set("endsAt", `${to}T23:59`);
    const search = params.toString();
    return `/api/admin/inventory?${search}`;
  }, [from, to]);

  const resources = useAdminResource(listPath, (payload) => (payload.inventory ?? []) as AdminInventoryItemRow[]);
  const incidentsResource = useAdminResource("/api/admin/inventory/incidents?status=open", (payload) => ((payload as { incidents?: AdminInventoryIncident[] }).incidents ?? []));
  const occupancyResource = useAdminResource("/api/admin/inventory/occupancy", (payload) => payload.occupancy as AdminInventoryOccupancy);

  const inventory = useMemo(() => resources.data ?? [], [resources.data]);
  const selected = useMemo(() => inventory.find((item) => item.id === selectedId) ?? null, [inventory, selectedId]);
  const openIncidents = incidentsResource.data;
  const openIncidentIds = useMemo(() => new Set((openIncidents ?? []).map((incident) => incident.inventoryId)), [openIncidents]);
  // El «ahora» de los filtros por fecha cambia con cada recarga de datos.
  const now = useMemo(() => new Date(), [resources.data]);
  const focusContext = useMemo(() => ({ openIncidentIds, now }), [openIncidentIds, now]);

  function reloadAll() {
    resources.reload();
    incidentsResource.reload();
    occupancyResource.reload();
  }

  /** Abre la ficha y deja el link `?producto=<id>` en la barra de direcciones. */
  function openFicha(id: string) {
    handledProductParam.current = id;
    setSelectedId(id);
    syncProductParam(id);
  }

  function closeFicha() {
    setSelectedId("");
    syncProductParam("");
  }

  // Link `?producto=<id>`: abre la ficha de ese producto de la empresa activa. Un
  // id ajeno o borrado no abre nada y avisa (nunca se muestra data de otra empresa).
  useEffect(() => {
    if (!productParam) {
      handledProductParam.current = "";
      return;
    }
    if (resources.loading || !resources.data || handledProductParam.current === productParam) return;
    handledProductParam.current = productParam;
    if (resources.data.some((item) => item.id === productParam)) {
      setSelectedId(productParam);
    } else {
      setNotice({ tone: "warn", message: "No encontramos ese producto en esta empresa." });
      syncProductParam("");
    }
  }, [productParam, resources.loading, resources.data]);

  const searched = useMemo(
    () =>
      inventory
        .filter((item) => (kind === "ALL" ? true : item.kind === kind))
        .filter((item) => (status === "ALL" ? true : item.status === status))
        .filter((item) => matchesQuery(query, [item.name, item.category, item.sku, item.status])),
    [inventory, kind, status, query],
  );
  const activeSearched = useMemo(() => searched.filter((item) => !item.archivedAt), [searched]);
  const rows = useMemo(() => activeSearched.filter((item) => itemInFocus(item, focus, focusContext)), [activeSearched, focus, focusContext]);
  const archivedRows = useMemo(() => searched.filter((item) => Boolean(item.archivedAt)), [searched]);
  const counts = useMemo(() => tabCounts(activeSearched, focusContext), [activeSearched, focusContext]);

  const totals = useMemo(() => {
    const active = inventory.filter((item) => !item.archivedAt);
    const rentable = active.filter((item) => !item.combo);
    const problems = unitProblemCounts(rentable);
    return {
      active: active.length,
      combos: active.length - rentable.length,
      archived: inventory.length - active.length,
      units: rentable.reduce((sum, item) => sum + item.quantity, 0),
      free: rentable.reduce((sum, item) => sum + item.availability.availableNow, 0),
      problems,
      published: active.filter(isPublished).length,
    };
  }, [inventory]);

  const occupancy = occupancyResource.data;
  const bulkSelection = useMemo(
    () => bulkItemIds.map((id) => ({ id, label: inventory.find((item) => item.id === id)?.name ?? id })),
    [bulkItemIds, inventory],
  );

  function toggleBulk(id: string) {
    setBulkItemIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length < BULK_LIMIT ? [...current, id] : current));
  }

  function toggleFocus(next: InventoryFocus) {
    setFocus((current) => (current === next ? "all" : next));
  }

  async function archiveItem(item: AdminInventoryItemRow, restore = false) {
    if (archiveBusyId) return;
    setArchiveBusyId(item.id);
    setStatusError("");
    const result = await adminSend("/api/admin/inventory", { kind: restore ? "item-restore" : "item-archive", id: item.id });
    setArchiveBusyId("");
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    setNotice({ tone: "ok", message: `Producto «${item.name}» ${restore ? "restaurado" : "archivado"}. Conserva estado operativo, unidades, precios y asignaciones.` });
    setBulkItemIds((current) => current.filter((id) => id !== item.id));
    if (!restore && selectedId === item.id) closeFicha();
    resources.reload();
  }

  async function changeStatus(item: AdminInventoryItemRow, next: string) {
    setStatusBusyId(item.id);
    setStatusError("");
    setNotice(null);
    const result = await adminSend("/api/admin/inventory", { kind: "status", id: item.id, status: next });
    setStatusBusyId("");
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    setNotice({ tone: "ok", message: `«${item.name}» pasó a ${inventoryStatusLabel(next)}.` });
    resources.reload();
  }

  /** CSV del inventario filtrado: cantidades y costos reales de cada ítem. */
  function exportInventory() {
    const free = (item: AdminInventoryItemRow) => (rangeActive ? (item.availability.range?.available ?? 0) : item.availability.availableNow);
    const committed = (item: AdminInventoryItemRow) => (rangeActive ? (item.availability.range?.committed ?? 0) : item.availability.committedNow);
    const conflict = (item: AdminInventoryItemRow) => (rangeActive ? (item.availability.range?.overcommitted ?? false) : item.availability.overcommittedNow);
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
          rangeActive ? "Libres en el rango" : "Libres ahora",
          rangeActive ? "Comprometidas en el rango" : "Comprometidas ahora",
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
            free(item),
            committed(item),
            item.replacementCost,
            item.dailyCost,
            csvBool(conflict(item)),
          ]),
          [
            "Total",
            "",
            "",
            "",
            "",
            rows.reduce((sum, item) => sum + item.quantity, 0),
            rows.reduce((sum, item) => sum + free(item), 0),
            rows.reduce((sum, item) => sum + committed(item), 0),
            "",
            "",
            "",
          ],
        ],
      },
    ];
    downloadCsv(csvFilename("inventario"), blocks);
  }

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const item of inventory) {
      const category = item.category?.trim();
      if (category) seen.add(category);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, "es")).map((category) => ({ value: category, label: category }));
  }, [inventory]);

  const incidentCount = openIncidents?.length ?? null;
  const banner = statusError
    ? { tone: "error" as const, text: statusError }
    : notice
      ? { tone: notice.tone, text: notice.message }
      : null;
  const focusLabel = INVENTORY_FOCUS_LABEL[focus];

  return (
    <div className="admin-module-page">
      <div className="admin-inv-actions">
        {writable ? (
          <AdminButton type="button" variant="primary" icon="plus" onClick={() => setShowForm(true)} aria-haspopup="dialog">
            Nuevo producto
          </AdminButton>
        ) : null}
        {writable ? (
          <AdminButton icon="inventory" onClick={() => setComboDialog({ item: null })} title="Armar un combo con productos que ya tenés cargados">
            Nuevo combo
          </AdminButton>
        ) : null}
        <AdminButton
          icon="alert"
          onClick={() => setIncidentsOpen(true)}
          title="Daños, faltantes y reparaciones de inventario"
          aria-label={incidentCount == null ? "Incidentes de inventario" : `Incidentes de inventario: ${incidentCount} abiertos`}
        >
          Incidentes{incidentCount == null ? "" : ` (${formatNumber(incidentCount)})`}
        </AdminButton>
        <span className="admin-inv-actions-end admin-export">
          <AdminButton icon="download" onClick={exportInventory} title="Exportar el inventario filtrado a CSV" aria-label="Exportar el inventario filtrado a CSV">
            Exportar CSV
          </AdminButton>
        </span>
      </div>

      <AdminKpis state={kpiState(resources)} label="Indicadores de inventario" className="admin-kpis--inventario">
        <AdminKpi
          label="Productos activos"
          icon="inventory"
          value={formatNumber(totals.active)}
          note={`${formatNumber(totals.combos)} combos · ${formatNumber(totals.archived)} archivados`}
          onSelect={() => setFocus("all")}
          active={focus === "all"}
          actionLabel="Ver todos los productos activos"
        />
        <AdminKpi
          label="Unidades disponibles hoy"
          icon="check"
          value={formatNumber(totals.free)}
          note={`de ${formatNumber(totals.units)} unidades`}
          tone={totals.free === 0 ? "warn" : "ok"}
          onSelect={() => toggleFocus("free")}
          active={focus === "free"}
          actionLabel="Ver los productos con unidades libres hoy"
        />
        <AdminKpi
          label="En reparación / dañadas / perdidas"
          icon="alert"
          value={formatNumber(totals.problems.total)}
          note={`${formatNumber(totals.problems.maintenance)} mant. · ${formatNumber(totals.problems.damaged)} dañ. · ${formatNumber(totals.problems.lost)} perd.`}
          tone={totals.problems.total > 0 ? "warn" : undefined}
          onSelect={() => toggleFocus("incidents")}
          active={focus === "incidents"}
          actionLabel="Ver los productos con incidentes o unidades fuera de circulación"
        />
        <AdminKpi
          label="Ocupación de esta semana"
          icon="events"
          state={kpiState(occupancyResource)}
          value={occupancy ? (occupancy.percent == null ? "—" : `${formatNumber(occupancy.percent)} %`) : null}
          note={
            occupancy
              ? occupancy.percent == null
                ? "sin unidades para alquilar"
                : `${formatNumber(occupancy.committedDays)} de ${formatNumber(occupancy.availableDays)} días-unidad`
              : undefined
          }
          tone={occupancy?.percent != null && occupancy.percent >= 80 ? "accent" : undefined}
          onSelect={() => toggleFocus("week")}
          active={focus === "week"}
          actionLabel="Ver los productos con reservas esta semana"
        />
        <AdminKpi
          label="Publicados en la tienda"
          icon="eye"
          value={formatNumber(totals.published)}
          note={`${formatNumber(totals.active - totals.published)} ocultos`}
          onSelect={() => toggleFocus("published")}
          active={focus === "published"}
          actionLabel="Ver los productos publicados en la tienda web"
        />
      </AdminKpis>

      <OverdueReturnsIndicator />

      <nav className="admin-subtabs admin-inv-tabs" aria-label="Filtrar el inventario">
        {INVENTORY_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className="admin-subtab"
            data-active={focus === tab.value ? "true" : undefined}
            aria-pressed={focus === tab.value}
            onClick={() => setFocus(tab.value)}
          >
            {tab.label}
            <span className="admin-subtab-count">{formatNumber(counts[tab.value])}</span>
          </button>
        ))}
        {focusLabel ? (
          <button type="button" className="admin-subtab" data-active="true" aria-pressed="true" title="Quitar este filtro" onClick={() => setFocus("all")}>
            {focusLabel}
            <span className="admin-subtab-count">{formatNumber(rows.length)}</span>
          </button>
        ) : null}
      </nav>

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
          <AdminButton
            icon="close"
            title="Quitar el rango y volver a la disponibilidad de hoy"
            aria-label="Quitar el rango de disponibilidad"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Hoy
          </AdminButton>
        ) : null}
        {narrow ? null : <AdminViewSwitch view={view} onChange={setView} label="Vista de inventario" views={INVENTARIO_VIEWS} />}
      </AdminToolbar>

      {notice && !selected ? <AdminNote tone={notice.tone}>{notice.message}</AdminNote> : null}
      {statusError && !selected ? <AdminNote tone="error">{statusError}</AdminNote> : null}
      {rangeActive ? <AdminNote>Disponibilidad entre {dayRangeLabel(from, to)}; «Unidades disponibles hoy» sigue siendo la de hoy.</AdminNote> : null}
      {from && !to ? <AdminNote>Elegí «Hasta» para ver la disponibilidad en el rango (mientras tanto se muestra la de hoy).</AdminNote> : null}
      {!from && to ? <AdminNote>Elegí «Disponible desde» para ver la disponibilidad en el rango (mientras tanto se muestra la de hoy).</AdminNote> : null}

      {writable && bulkItemIds.length ? (
        <div className="admin-bulkbar" role="region" aria-label="Productos seleccionados">
          <strong>{formatNumber(bulkItemIds.length)} seleccionados</strong>
          <span className="admin-bulkbar-actions">
            <AdminButton variant="primary" icon="edit" onClick={() => setBulkOpen(true)} title="Editar en lote los productos seleccionados">
              Editar en lote
            </AdminButton>
            <AdminButton
              icon="check"
              onClick={() => setBulkItemIds(rows.slice(0, BULK_LIMIT).map((item) => item.id))}
              title={`Seleccionar los productos visibles (hasta ${BULK_LIMIT})`}
            >
              Seleccionar visibles
            </AdminButton>
            <AdminButton icon="close" onClick={() => setBulkItemIds([])} title="Quitar la selección">
              Quitar selección
            </AdminButton>
          </span>
        </div>
      ) : null}

      <AdminDataState
        loading={resources.loading}
        error={resources.error}
        onRetry={resources.reload}
        empty={inventory.length === 0}
        emptyTitle="Inventario vacío"
        emptyIcon="inventory"
        emptyHint="Cargá los equipos y materiales para asignarlos a los eventos."
        emptyAction={writable ? <button type="button" className="admin-empty-link" onClick={() => setShowForm(true)}>Cargar el primer producto →</button> : undefined}
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda, otra pestaña o cambiá los filtros." />
        ) : (
          <InventoryList
            rows={rows}
            cards={view === "grid" || narrow}
            writable={writable}
            rangeActive={rangeActive}
            from={from}
            to={to}
            bulkIds={bulkItemIds}
            statusBusyId={statusBusyId}
            archiveBusyId={archiveBusyId}
            onToggleBulk={toggleBulk}
            onOpen={openFicha}
            onEdit={setEditItem}
            onEditCombo={(item) => setComboDialog({ item })}
            onArchive={(item) => void archiveItem(item)}
            onTrash={(item) => setTrashTarget(item)}
            onChangeStatus={(item, next) => void changeStatus(item, next)}
          />
        )}
      </AdminDataState>

      <AdminDisclosure title="ARCHIVADOS" hint={`${archivedRows.length} productos · conserva sus datos y estado operativo`}>
        {archivedRows.length ? (
          <AdminCardGrid
            label="Productos archivados"
            cards={archivedRows.map((item) => ({
              id: item.id,
              title: item.name,
              subtitle: item.category,
              fields: [
                { label: "Archivado", value: formatDateShort(item.archivedAt) },
                { label: "Estado operativo", value: inventoryStatusLabel(item.status) },
                { label: "Unidades", value: formatNumber(item.quantity) },
                { label: "Cliente final", value: priceText(item.listPrice) },
                { label: "Mayorista", value: priceText(item.wholesalePrice) },
              ],
              footer: (
                <span className="admin-actions">
                  <AdminButton icon="info" title={`Ver producto archivado ${item.name}`} aria-label={`Ver producto archivado ${item.name}`} onClick={() => openFicha(item.id)}>
                    Ver ficha
                  </AdminButton>
                  {writable ? (
                    <AdminButton
                      icon="refresh"
                      title={`Restaurar producto ${item.name}`}
                      aria-label={`Restaurar producto ${item.name}`}
                      busy={archiveBusyId === item.id}
                      disabled={Boolean(archiveBusyId) && archiveBusyId !== item.id}
                      onClick={() => void archiveItem(item, true)}
                    >
                      Restaurar
                    </AdminButton>
                  ) : null}
                  {writable ? (
                    <AdminActionsMenu
                      label={`Más acciones de ${item.name}`}
                      items={trashMenuItems({
                        type: "InventoryItem",
                        name: item.name,
                        archived: true,
                        canWrite: writable,
                        only: ["trash"],
                        busy: Boolean(archiveBusyId),
                        onArchive: () => void archiveItem(item),
                        onUnarchive: () => void archiveItem(item, true),
                        onTrash: () => setTrashTarget(item),
                      })}
                    />
                  ) : null}
                </span>
              ),
            }))}
          />
        ) : (
          <AdminEmpty icon="inventory" title="Sin productos archivados" hint="Los productos activos se muestran arriba." />
        )}
      </AdminDisclosure>

      {selected ? (
        <InventoryFicha
          key={selected.id}
          item={selected}
          inventory={inventory}
          writable={writable}
          canReadAudit={canReadAudit}
          range={{ from, to, setFrom, setTo }}
          statusBusy={statusBusyId === selected.id}
          archiveBusy={archiveBusyId === selected.id}
          banner={banner}
          onClose={closeFicha}
          onEdit={setEditItem}
          onEditCombo={(item) => setComboDialog({ item })}
          onArchive={(item, restore) => void archiveItem(item, restore)}
          onTrash={(item) => setTrashTarget(item)}
          onChangeStatus={(item, next) => void changeStatus(item, next)}
          onChanged={reloadAll}
          onOpenProduct={openFicha}
        />
      ) : null}

      {writable && trashTarget ? (
        <TrashDialog
          mode="trash"
          type="InventoryItem"
          id={trashTarget.id}
          name={trashTarget.name}
          onClose={() => setTrashTarget(null)}
          onDone={(message) => {
            if (selectedId === trashTarget.id) closeFicha();
            setBulkItemIds((current) => current.filter((id) => id !== trashTarget.id));
            setTrashTarget(null);
            setNotice({ tone: "ok", message });
            resources.reload();
          }}
        />
      ) : null}

      {writable && showForm ? (
        <InventoryCreateDialog
          categories={categories}
          onClose={() => setShowForm(false)}
          onCreated={(created) => {
            setNotice(created);
            setShowForm(false);
            reloadAll();
          }}
        />
      ) : null}

      {writable && editItem ? (
        <InventoryEditDialog
          item={editItem}
          categories={categories}
          onClose={() => setEditItem(null)}
          onSaved={(saved) => {
            setNotice(saved);
            setEditItem(null);
            reloadAll();
          }}
          onOpenUnits={(id) => {
            setEditItem(null);
            openFicha(id);
          }}
        />
      ) : null}

      {writable && comboDialog ? (
        <ComboDialog
          combo={comboDialog.item}
          inventory={inventory}
          onClose={() => setComboDialog(null)}
          onSaved={(message) => {
            setComboDialog(null);
            setNotice({ tone: "ok", message });
            reloadAll();
          }}
        />
      ) : null}

      {writable && bulkOpen && bulkItemIds.length ? (
        <InventoryBulkEditor
          target="items"
          selection={bulkSelection}
          onSaved={resources.reload}
          onClose={() => setBulkOpen(false)}
          onClear={() => {
            setBulkItemIds([]);
            setBulkOpen(false);
          }}
        />
      ) : null}

      {incidentsOpen ? (
        <InventoryIncidentsDialog
          writable={writable}
          onClose={() => {
            setIncidentsOpen(false);
            incidentsResource.reload();
          }}
          onChanged={reloadAll}
        />
      ) : null}
    </div>
  );
}
