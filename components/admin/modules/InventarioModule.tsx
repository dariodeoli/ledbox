"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDateShort, formatNumber, inventoryKindLabel, inventoryStatusLabel } from "@/lib/admin-format";
import { canImportCatalog, canWriteOperations } from "@/lib/admin-policy";
import { csvBool, csvFilename, downloadCsv, type CsvBlock } from "@/lib/admin-export";
import type { AdminInventoryGridRow, AdminInventoryIncident, AdminInventoryItemRow, AdminInventoryOccupancy, AdminInventoryRow } from "@/lib/admin-types";
import { INVENTORY_FOCUS_LABEL, INVENTORY_TABS, isPublished, itemInFocus, tabCounts, unitProblemCounts, type InventoryFocus } from "@/lib/inventory-view";
import { EMPTY_GRID_FILTERS, activeFilterCount, applyInventoryFilters, categoryFilterOptions, type InventoryGridFilters } from "@/lib/inventory-grid-view";
import { INVENTORY_STATE_FILTER_OPTIONS } from "@/lib/inventory-visual-state";
import { useAdminSession } from "../AdminShell";
import {
  AdminActionsMenu,
  AdminButton,
  AdminDataState,
  AdminDialog,
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
import { useInventoryGrid, useUnitCodeMatches } from "./InventoryGridData";
import { InventoryByCategory, InventoryCompactGrid } from "./InventoryTiles";
import { InventoryIncidentsDialog } from "./InventoryIncidents";
import { AdminViewSwitch, useAdminModuleView, useAdminNarrowViewport } from "../AdminBoard";
import { AdminCardGrid } from "../AdminCards";
import dynamic from "next/dynamic";
import { ComboDialog } from "./ComboDialog";
import { InventoryBulkEditor } from "./InventoryBulkEditor";
import { InventoryFicha } from "./InventoryFicha";
import { useInventoryTaxonomy } from "./InventoryTaxonomy";
import { InventoryCreateDialog, InventoryEditDialog, type InventoryEditable, type InventoryNotice } from "./InventoryItemDialogs";
import { OverdueReturnsIndicator } from "./OverdueReturns";
import { InventoryList } from "./InventoryList";
import { TrashDialog, trashMenuItems } from "../TrashDialogs";
import { KIND_OPTIONS, dayRangeLabel, priceText } from "./InventoryParts";
import { supplierOptions, warehouseOptions } from "./InventoryTaxonomy";

/** Vistas del inventario: lista densa, cuadrícula compacta y «Por categoría» (rediseño E2). */
const INVENTARIO_VIEWS = ["list", "grid", "category"] as const;

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
const AdminImportPanel = dynamic(() => import("../AdminImportPanel").then((mod) => mod.AdminImportPanel), { ssr: false });

export function InventarioModule() {
  const { role, demo } = useAdminSession();
  const searchParams = useSearchParams();
  const productParam = searchParams.get("producto")?.trim() ?? "";
  const handledProductParam = useRef("");

  const [filters, setFilters] = useState<InventoryGridFilters>(EMPTY_GRID_FILTERS);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { focus } = filters;
  const setFilter = <K extends keyof InventoryGridFilters>(key: K, value: InventoryGridFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const setFocus = (next: InventoryFocus) => setFilter("focus", next);
  const [showForm, setShowForm] = useState(false);
  const [incidentsOpen, setIncidentsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [comboDialog, setComboDialog] = useState<{ item: AdminInventoryRow | null } | null>(null);
  const [editItem, setEditItem] = useState<InventoryEditable | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState<InventoryNotice | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const [archiveBusyId, setArchiveBusyId] = useState("");
  /** Producto que se está por mandar a la papelera (diálogo de eliminar). */
  const [trashTarget, setTrashTarget] = useState<Pick<AdminInventoryRow, "id" | "name"> | null>(null);
  const [bulkItemIds, setBulkItemIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [view, setView] = useAdminModuleView("inventario", INVENTARIO_VIEWS);
  /** Ancho compacto (issue #151): las tarjetas de la cuadrícula, siempre. */
  const narrow = useAdminNarrowViewport();
  /** Barra fija de búsqueda y filtros: su alto fija dónde se pegan los encabezados de «Por categoría». */
  const barRef = useRef<HTMLDivElement>(null);

  const writable = canWriteOperations(role);
  const canImport = writable && canImportCatalog(role) && !demo;
  const canReadAudit = role === "OWNER" || role === "ADMIN";
  const rangeActive = Boolean(from && to);

  // Categorías, depósitos y proveedores para los filtros y los formularios (rediseño E1).
  const taxonomy = useInventoryTaxonomy();
  // Lista liviana por páginas (E2): sin unidades ni asignaciones; con el rango, la disponibilidad de ese rango.
  const resources = useInventoryGrid({ from: from && to ? from : "", to: from && to ? to : "" });
  const incidentsResource = useAdminResource("/api/admin/inventory/incidents?status=open", (payload) => ((payload as { incidents?: AdminInventoryIncident[] }).incidents ?? []));
  const occupancyResource = useAdminResource("/api/admin/inventory/occupancy", (payload) => payload.occupancy as AdminInventoryOccupancy);
  const unitMatchIds = useUnitCodeMatches(filters.query);

  // Ficha: el detalle completo (unidades y asignaciones) se pide solo del producto abierto.
  const detailPath = useMemo(() => {
    const params = new URLSearchParams({ vivas: "1", itemId: selectedId });
    if (from) params.set("startsAt", `${from}T00:00`);
    if (to) params.set("endsAt", `${to}T23:59`);
    return `/api/admin/inventory?${params.toString()}`;
  }, [selectedId, from, to]);
  const detailResource = useAdminResource(detailPath, (payload) => ((payload.inventory ?? [])[0] ?? null) as AdminInventoryItemRow | null, { enabled: Boolean(selectedId) });

  const inventory = useMemo(() => resources.data ?? [], [resources.data]);
  const detail = detailResource.data && detailResource.data.id === selectedId ? detailResource.data : null;
  const openIncidents = incidentsResource.data;
  const openIncidentIds = useMemo(() => new Set((openIncidents ?? []).map((incident) => incident.inventoryId)), [openIncidents]);
  // El «ahora» de los filtros por fecha cambia con cada recarga de datos.
  const now = useMemo(() => new Date(), [resources.data]);
  const filterContext = useMemo(() => ({ openIncidentIds, now, unitMatchIds, categoryTree: taxonomy.tree }), [openIncidentIds, now, unitMatchIds, taxonomy.tree]);
  // Los productos livianos con detalle más reciente (la ficha abierta se refresca sola al guardar).
  const selectedRow = useMemo(() => inventory.find((item) => item.id === selectedId) ?? null, [inventory, selectedId]);

  // Alto de la barra fija → variable CSS que usan los encabezados pegajosos de «Por categoría».
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = bar.parentElement;
    const apply = () => root?.style.setProperty("--admin-inv-bar-h", getComputedStyle(bar).position === "sticky" ? `${bar.offsetHeight}px` : "0px");
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  function reloadAll() {
    resources.reload();
    incidentsResource.reload();
    occupancyResource.reload();
    if (selectedId) detailResource.reload();
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

  // Filtros combinados con «Y». Las pestañas cuentan sobre lo filtrado sin el foco.
  const showingArchived = filters.state === "archived";
  const baseRows = useMemo(() => applyInventoryFilters(inventory, { ...filters, focus: "all" }, filterContext, { archived: showingArchived }), [inventory, filters, filterContext, showingArchived]);
  const rows = useMemo(() => baseRows.filter((item) => itemInFocus(item, filters.focus, filterContext)), [baseRows, filters.focus, filterContext]);
  const archivedRows = useMemo(() => applyInventoryFilters(inventory, { ...filters, focus: "all", state: "ALL" }, filterContext, { archived: true }), [inventory, filters, filterContext]);
  const counts = useMemo(() => tabCounts(baseRows, filterContext), [baseRows, filterContext]);
  const filtersActive = activeFilterCount(filters, rangeActive);
  const categoryOptions = useMemo(() => categoryFilterOptions(taxonomy.tree), [taxonomy.tree]);
  const stateOptions = useMemo(() => [{ value: "ALL", label: "Todos los estados" }, ...INVENTORY_STATE_FILTER_OPTIONS], []);
  const warehouseChoices = useMemo(() => warehouseOptions(taxonomy.warehouses, { includeEmpty: "Todos los depósitos" }), [taxonomy.warehouses]);
  const supplierChoices = useMemo(() => supplierOptions(taxonomy.suppliers, "Todos los proveedores"), [taxonomy.suppliers]);

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
    setFocus(focus === next ? "all" : next);
  }

  async function archiveItem(item: Pick<AdminInventoryRow, "id" | "name">, restore = false) {
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

  async function changeStatus(item: Pick<AdminInventoryRow, "id" | "name">, next: string) {
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
    const free = (item: AdminInventoryGridRow) => (rangeActive ? (item.availability.range?.available ?? 0) : item.availability.availableNow);
    const committed = (item: AdminInventoryGridRow) => (rangeActive ? (item.availability.range?.committed ?? 0) : item.availability.committedNow);
    const conflict = (item: AdminInventoryGridRow) => (rangeActive ? (item.availability.range?.overcommitted ?? false) : item.availability.overcommittedNow);
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
        <AdminButton icon="search" disabled title="Escanear el código de un producto o unidad: próximamente" aria-label="Escanear: próximamente">
          Escanear · próximamente
        </AdminButton>
        {canImport ? (
          <AdminButton icon="upload" onClick={() => setImportOpen(true)} aria-haspopup="dialog" title="Cargar productos, juegos y fotos desde una planilla, ChatGPT o la IA de LedBox">
            Importar
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

      <div className="admin-inv-bar" ref={barRef}>
        <AdminToolbar>
          <SearchField value={filters.query} onChange={(value) => setFilter("query", value)} label="Buscar inventario" placeholder="Nombre, SKU o código de unidad…" />
          <AdminSelect value={filters.kind} onChange={(value) => setFilter("kind", value)} label="Filtrar por tipo" options={KIND_OPTIONS} />
          <AdminSelect value={filters.categoryId} onChange={(value) => setFilter("categoryId", value)} label="Filtrar por categoría" options={categoryOptions} />
          <AdminSelect value={filters.warehouseId} onChange={(value) => setFilter("warehouseId", value)} label="Filtrar por depósito" options={warehouseChoices} />
          <AdminSelect value={filters.state} onChange={(value) => setFilter("state", value)} label="Filtrar por estado" options={stateOptions} />
          <AdminSelect value={filters.supplierId} onChange={(value) => setFilter("supplierId", value)} label="Filtrar por proveedor" options={supplierChoices} />
          <div className="admin-inv-range">
          <div className="admin-field--filter">
            <DateField
              label="Disponible desde"
              max={to || undefined}
              value={from}
              onChange={setFrom}
              title="Primer día del rango para consultar unidades libres; no crea reservas"
            />
          </div>
          <div className="admin-field--filter">
            <DateField
              label="Hasta"
              min={from || undefined}
              value={to}
              onChange={setTo}
              title="Último día del rango de disponibilidad; no cambia las fechas de las asignaciones existentes"
            />
          </div>
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
          {filtersActive > 0 ? (
            <AdminButton
              icon="close"
              title="Quitar la búsqueda y todos los filtros"
              aria-label={`Limpiar ${filtersActive} filtros`}
              onClick={() => {
                setFilters(EMPTY_GRID_FILTERS);
                setFrom("");
                setTo("");
              }}
            >
              Limpiar filtros
            </AdminButton>
          ) : null}
          <AdminViewSwitch view={view} onChange={setView} label="Vista de inventario" views={INVENTARIO_VIEWS} labels={{ list: "Lista", grid: "Cuadrícula", category: "Por categoría" }} />
        </AdminToolbar>
      </div>

      {notice && !selectedId ? <AdminNote tone={notice.tone}>{notice.message}</AdminNote> : null}
      {statusError && !selectedId ? <AdminNote tone="error">{statusError}</AdminNote> : null}
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

      {resources.loading && resources.data ? (
        <AdminNote>
          Cargando el resto del inventario… {formatNumber(inventory.length)}
          {resources.total != null ? ` de ${formatNumber(resources.total)}` : ""} productos.
        </AdminNote>
      ) : null}

      <AdminDataState
        loading={resources.loading && !resources.data}
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
        ) : view === "grid" ? (
          <InventoryCompactGrid rows={rows} writable={writable} rangeActive={rangeActive} bulkIds={bulkItemIds} onToggleBulk={toggleBulk} onOpen={openFicha} />
        ) : view === "category" ? (
          <InventoryByCategory rows={rows} tree={taxonomy.tree} writable={writable} rangeActive={rangeActive} bulkIds={bulkItemIds} onToggleBulk={toggleBulk} onOpen={openFicha} />
        ) : (
          <InventoryList
            rows={rows}
            warehouses={taxonomy.warehouses}
            cards={narrow}
            writable={writable}
            rangeActive={rangeActive}
            from={from}
            to={to}
            bulkIds={bulkItemIds}
            archiveBusyId={archiveBusyId}
            onToggleBulk={toggleBulk}
            onOpen={openFicha}
            onEdit={setEditItem}
            onEditCombo={(item) => setComboDialog({ item })}
            onArchive={(item) => void archiveItem(item)}
            onTrash={(item) => setTrashTarget(item)}
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

      {selectedId && detail ? (
        <InventoryFicha
          key={detail.id}
          item={detail}
          inventory={inventory}
          writable={writable}
          canReadAudit={canReadAudit}
          range={{ from, to, setFrom, setTo }}
          statusBusy={statusBusyId === detail.id}
          archiveBusy={archiveBusyId === detail.id}
          banner={banner}
          onClose={closeFicha}
          onEdit={setEditItem}
          onEditCombo={(item) => setComboDialog({ item })}
          onArchive={(item, restore) => void archiveItem(item, restore)}
          onTrash={(item) => setTrashTarget(item)}
          onChangeStatus={(item, next) => void changeStatus(item, next)}
          onChanged={reloadAll}
          taxonomy={taxonomy}
          onOpenProduct={openFicha}
        />
      ) : selectedId ? (
        <AdminDialog
          title={selectedRow?.name ?? "Producto"}
          icon="inventory"
          size="ficha"
          onClose={closeFicha}
          footer={({ requestClose }) => (
            <>
              <span className="admin-dialog-spacer" />
              <AdminButton type="button" icon="close" onClick={requestClose}>
                Cerrar
              </AdminButton>
            </>
          )}
        >
          {detailResource.error ? (
            <AdminNote tone="error">{detailResource.error}</AdminNote>
          ) : (
            <AdminNote>Cargando la ficha del producto…</AdminNote>
          )}
        </AdminDialog>
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
          taxonomy={taxonomy}
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
          taxonomy={taxonomy}
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

      {canImport && importOpen ? <AdminImportPanel moduloId="productos" onClose={() => setImportOpen(false)} onApplied={reloadAll} /> : null}
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
          taxonomy={taxonomy}
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
