import type { Prisma } from "@prisma/client";
import type {
  AdminRentalGuaranteeRow,
  AdminRentalIncidentRow,
  AdminRentalOccupancyRow,
  AdminRentalProfitRow,
  AdminRentalReport,
} from "@/lib/admin-types";
import { formatDate } from "@/lib/admin-format";
import { db } from "./db";
import {
  BLOCKED_INVENTORY_STATUSES,
  EVENT_RANGE_SELECT,
  assignmentBlockedRange,
  committedAssignmentWhere,
  loadRentalSettings,
  maintenanceUnits,
  resolveRentalBuffers,
  MAINTENANCE_UNITS_SELECT,
  type AssignmentRecord,
  type RentalBuffers,
} from "./inventory-availability";
import { DAY_MS, clientLabel, dayStart } from "./notifications";

/**
 * Sección «Alquileres» del reporte mensual (fase 5). Todo está acotado a la
 * empresa activa y al período; las sumas y los conteos salen de la base
 * (`groupBy`/`aggregate`). Lo único que pasa por memoria son las asignaciones que
 * se solapan con el período, porque la ocupación usa la MISMA regla del motor de
 * disponibilidad (`assignmentBlockedRange`: rango efectivo + colchones + devolución
 * tardía) y no se reimplementa en SQL.
 */

const LIST_LIMIT = 10;
const MAX_PERIOD_ASSIGNMENTS = 20_000;
const LOST_BUDGET_STATUSES = ["LOST", "CANCELLED"] as const;

export type ReportPeriod = { month: string; start: Date; end: Date; days: number };

/** Período `[start, end)` del mes `YYYY-MM` en Asunción (UTC-3 fijo). */
export function reportPeriod(month: string): ReportPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mes inválido");
  const start = dayStart(`${month}-01`);
  const [year, monthNumber] = month.split("-").map(Number);
  const next = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
  const end = dayStart(`${next}-01`);
  return { month, start, end, days: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Porcentaje con un decimal; `null` si el denominador es 0 (no hay base para calcular). */
export function percentOf(part: number, whole: number, cap = false): number | null {
  if (!(whole > 0)) return null;
  const value = (part / whole) * 100;
  return round1(cap ? Math.min(100, value) : value);
}

/**
 * Días-unidad (24 h) que una asignación bloquea dentro del período: cantidad ×
 * horas del rango bloqueado (con colchones) recortado al período. Un extremo
 * abierto se recorta al período, igual que el motor lo trata como «abierto».
 */
export function assignmentUnitDays(
  row: Pick<AssignmentRecord, "quantity" | "startsAt" | "endsAt" | "event" | "checkedInAt">,
  buffers: RentalBuffers,
  period: { start: Date; end: Date },
): number {
  const blocked = assignmentBlockedRange(row, buffers);
  const from = Math.max(blocked.start?.getTime() ?? period.start.getTime(), period.start.getTime());
  const to = Math.min(blocked.end?.getTime() ?? period.end.getTime(), period.end.getTime());
  if (to <= from || row.quantity <= 0) return 0;
  return (row.quantity * (to - from)) / DAY_MS;
}

export type OccupancyItem = {
  id: string;
  name: string;
  quantity: number;
  /** Unidades dañadas/perdidas/en mantenimiento + retenidas por incidentes (misma regla del motor). */
  maintenance: number;
  buffers: RentalBuffers;
};

/** Ocupación de un producto en el período: días-unidad comprometidos / disponibles. */
export function occupancyRow(
  item: OccupancyItem,
  assignments: ReadonlyArray<Pick<AssignmentRecord, "quantity" | "startsAt" | "endsAt" | "event" | "checkedInAt">>,
  period: { start: Date; end: Date; days: number },
): AdminRentalOccupancyRow | null {
  const usable = Math.max(0, item.quantity - item.maintenance);
  const availableDays = usable * period.days;
  if (availableDays <= 0) return null;
  const committedDays = assignments.reduce((sum, row) => sum + assignmentUnitDays(row, item.buffers, period), 0);
  return {
    id: item.id,
    name: item.name,
    committedDays: round1(committedDays),
    availableDays: round1(availableDays),
    percent: percentOf(committedDays, availableDays, true) ?? 0,
  };
}

/** Más usados (solo con uso real) y menos usados (sin repetir los ya listados). */
export function rankOccupancy(
  rows: ReadonlyArray<AdminRentalOccupancyRow>,
  limit = LIST_LIMIT,
): { top: AdminRentalOccupancyRow[]; least: AdminRentalOccupancyRow[] } {
  const byUse = [...rows].sort((a, b) => b.percent - a.percent || b.committedDays - a.committedDays || a.name.localeCompare(b.name, "es"));
  const top = byUse.filter((row) => row.percent > 0).slice(0, limit);
  const shown = new Set(top.map((row) => row.id));
  const least = [...rows]
    .filter((row) => !shown.has(row.id))
    .sort((a, b) => a.percent - b.percent || a.committedDays - b.committedDays || a.name.localeCompare(b.name, "es"))
    .slice(0, limit);
  return { top, least };
}

/** Suma de costos con desconocidos aparte: sin ningún costo cargado el total es `null`, nunca 0. */
export function knownCostTotal(sum: number | null | undefined, withCost: number): number | null {
  return withCost > 0 ? sum ?? 0 : null;
}

/** Producto rentable: ingresos − costos conocidos de incidentes. */
export function profitRow(input: {
  inventoryId: string;
  name: string;
  revenue: number;
  costSum: number | null;
  incidentCount: number;
  incidentsWithCost: number;
}): AdminRentalProfitRow {
  const incidentCost = knownCostTotal(input.costSum, input.incidentsWithCost);
  return {
    inventoryId: input.inventoryId,
    name: input.name,
    revenue: input.revenue,
    incidentCost,
    unknownCostCount: input.incidentCount - input.incidentsWithCost,
    net: input.revenue - (incidentCost ?? 0),
  };
}

/** Rentable en el ranking: producto alquilable (no combo, no consumible) y no bloqueado ni archivado. */
function rentableItemWhere(organizationId: string): Prisma.InventoryItemWhereInput {
  return {
    organizationId,
    kind: "REUSABLE",
    archivedAt: null,
    status: { notIn: [...BLOCKED_INVENTORY_STATUSES] },
    components: { none: {} },
    quantity: { gt: 0 },
  };
}

/** Superset (en SQL) de las asignaciones cuyo rango bloqueado puede tocar el período; la recorta `assignmentUnitDays`. */
function overlapPrefilter(period: { start: Date; end: Date }, marginMin: number): Prisma.EventInventoryWhereInput {
  const hi = new Date(period.end.getTime() + marginMin * 60_000);
  const lo = new Date(period.start.getTime() - marginMin * 60_000);
  return {
    AND: [
      {
        OR: [
          { startsAt: { lte: hi } },
          { startsAt: null, event: { OR: [{ setupAt: { lte: hi } }, { setupAt: null, startsAt: { lte: hi } }, { setupAt: null, startsAt: null }] } },
        ],
      },
      {
        OR: [
          { endsAt: { gte: lo } },
          { checkedInAt: { gte: lo } },
          { endsAt: null, event: { OR: [{ strikeAt: { gte: lo } }, { strikeAt: null, endsAt: { gte: lo } }, { strikeAt: null, endsAt: null }] } },
        ],
      },
    ],
  };
}

async function occupancySection(organizationId: string, period: ReportPeriod, now: Date): Promise<AdminRentalReport["occupancy"]> {
  const [settings, overrides] = await Promise.all([
    loadRentalSettings(organizationId),
    db.inventoryItem.aggregate({ where: { organizationId }, _max: { bufferBeforeMin: true, bufferAfterMin: true } }),
  ]);
  const orgBuffers = resolveRentalBuffers(settings);
  const marginMin = Math.max(orgBuffers.beforeMin, orgBuffers.afterMin, overrides._max.bufferBeforeMin ?? 0, overrides._max.bufferAfterMin ?? 0);

  const assignments = await db.eventInventory.findMany({
    where: {
      AND: [
        committedAssignmentWhere(organizationId, now),
        { inventory: rentableItemWhere(organizationId) },
        overlapPrefilter(period, marginMin),
      ],
    },
    take: MAX_PERIOD_ASSIGNMENTS + 1,
    orderBy: [{ inventoryId: "asc" }, { id: "asc" }],
    select: { inventoryId: true, quantity: true, startsAt: true, endsAt: true, checkedInAt: true, event: { select: EVENT_RANGE_SELECT } },
  });
  // Corte determinista: si hay más asignaciones que el tope, el reporte lo avisa en vez de subestimar en silencio.
  const truncated = assignments.length > MAX_PERIOD_ASSIGNMENTS;
  if (truncated) assignments.length = MAX_PERIOD_ASSIGNMENTS;
  const byItem = new Map<string, typeof assignments>();
  for (const row of assignments) byItem.set(row.inventoryId, [...(byItem.get(row.inventoryId) ?? []), row]);
  const usedIds = [...byItem.keys()];

  const itemSelect = {
    id: true,
    name: true,
    quantity: true,
    incidentHold: true,
    bufferBeforeMin: true,
    bufferAfterMin: true,
    _count: { select: MAINTENANCE_UNITS_SELECT },
  } satisfies Prisma.InventoryItemSelect;
  const [used, unused, unusedCount] = await Promise.all([
    usedIds.length ? db.inventoryItem.findMany({ where: { ...rentableItemWhere(organizationId), id: { in: usedIds } }, select: itemSelect }) : Promise.resolve([]),
    db.inventoryItem.findMany({
      where: { ...rentableItemWhere(organizationId), id: { notIn: usedIds } },
      orderBy: { name: "asc" },
      take: LIST_LIMIT * 3,
      select: itemSelect,
    }),
    db.inventoryItem.count({ where: { ...rentableItemWhere(organizationId), id: { notIn: usedIds } } }),
  ]);

  const rows: AdminRentalOccupancyRow[] = [];
  for (const item of [...used, ...unused]) {
    const row = occupancyRow(
      {
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        maintenance: maintenanceUnits(item),
        buffers: resolveRentalBuffers(settings, item),
      },
      byItem.get(item.id) ?? [],
      period,
    );
    if (row) rows.push(row);
  }
  const { top, least } = rankOccupancy(rows);
  return { rankedItems: used.length + unusedCount, top, least, truncated };
}

async function catalogSection(organizationId: string, period: ReportPeriod, now: Date): Promise<AdminRentalReport["catalog"]> {
  const inPeriod = { organizationId, createdAt: { gte: period.start, lt: period.end } };
  const [groups, overdueOpen] = await Promise.all([
    db.quoteRequest.groupBy({ by: ["status"], where: inPeriod, _count: { _all: true } }),
    // Nadie marca EXPIRED hoy: un pedido sin responder cuyo plazo pasó cuenta como vencido.
    db.quoteRequest.count({ where: { ...inPeriod, status: { in: ["NEW", "REVIEWING"] }, respondBy: { lt: now } } }),
  ]);
  const count = (status: string) => groups.find((group) => group.status === status)?._count._all ?? 0;
  const received = groups.reduce((sum, group) => sum + group._count._all, 0);
  const converted = count("CONVERTED");
  const declined = count("DECLINED");
  const expired = count("EXPIRED") + overdueOpen;
  return {
    received,
    converted,
    declined,
    expired,
    open: Math.max(0, received - converted - declined - expired),
    conversionRate: percentOf(converted, received),
  };
}

async function cancellationsSection(organizationId: string, period: ReportPeriod): Promise<AdminRentalReport["cancellations"]> {
  const eventWhere = { organizationId, status: "CANCELLED" as const, startsAt: { gte: period.start, lt: period.end } };
  const budgetWhere = { organizationId, status: { in: [...LOST_BUDGET_STATUSES] }, updatedAt: { gte: period.start, lt: period.end } };
  const [eventCount, events, budgetGroups, budgets] = await Promise.all([
    db.event.count({ where: eventWhere }),
    db.event.findMany({ where: eventWhere, orderBy: { startsAt: "desc" }, take: LIST_LIMIT, select: { id: true, name: true, startsAt: true, client: { select: { name: true, company: true } } } }),
    db.budget.groupBy({ by: ["status"], where: budgetWhere, _count: { _all: true }, _sum: { total: true } }),
    db.budget.findMany({ where: budgetWhere, orderBy: { updatedAt: "desc" }, take: LIST_LIMIT, select: { id: true, title: true, status: true, total: true, client: { select: { name: true, company: true } } } }),
  ]);
  const group = (status: string) => budgetGroups.find((row) => row.status === status);
  return {
    events: {
      count: eventCount,
      rows: events.map((event) => ({ id: event.id, name: event.name, client: clientLabel(event.client), date: event.startsAt ? formatDate(event.startsAt) : "A confirmar" })),
    },
    budgets: {
      lost: group("LOST")?._count._all ?? 0,
      cancelled: group("CANCELLED")?._count._all ?? 0,
      amount: budgetGroups.reduce((sum, row) => sum + (row._sum.total ?? 0), 0),
      rows: budgets.map((budget) => ({ id: budget.id, title: budget.title, client: clientLabel(budget.client), status: budget.status, total: budget.total })),
    },
  };
}

async function incidentsSection(organizationId: string, period: ReportPeriod): Promise<AdminRentalReport["incidents"]> {
  const groups = await db.inventoryIncident.groupBy({
    by: ["kind", "status"],
    where: { organizationId, openedAt: { gte: period.start, lt: period.end } },
    _count: { _all: true, cost: true },
    _sum: { quantity: true, cost: true },
    orderBy: [{ kind: "asc" }, { status: "asc" }],
  });
  const rows: AdminRentalIncidentRow[] = groups.map((group) => ({
    kind: group.kind,
    status: group.status,
    count: group._count._all,
    quantity: group._sum.quantity ?? 0,
    knownCost: knownCostTotal(group._sum.cost, group._count.cost),
    unknownCostCount: group._count._all - group._count.cost,
  }));
  const withCost = groups.reduce((sum, group) => sum + group._count.cost, 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    total,
    rows,
    knownCost: knownCostTotal(groups.reduce((sum, group) => sum + (group._sum.cost ?? 0), 0), withCost),
    unknownCostCount: total - withCost,
  };
}

async function depositsSection(organizationId: string, period: ReportPeriod): Promise<AdminRentalReport["deposits"]> {
  // Señas: el anticipo del plan de pagos; cuenta en el período de su vencimiento (o de su alta si no tiene).
  const advanceWhere: Prisma.ExpectedPaymentWhereInput = {
    organizationId,
    concept: "advance",
    status: { not: "CANCELLED" },
    OR: [{ dueAt: { gte: period.start, lt: period.end } }, { dueAt: null, createdAt: { gte: period.start, lt: period.end } }],
  };
  const budgetRef: Prisma.BudgetWhereInput = {
    organizationId,
    securityDeposit: { not: null },
    // Solo garantías de presupuestos vigentes: un borrador, perdido o cancelado no custodia nada.
    status: { notIn: ["DRAFT", "LOST", "CANCELLED"] },
    OR: [
      { event: { startsAt: { gte: period.start, lt: period.end } } },
      { OR: [{ eventId: null }, { event: { startsAt: null } }], createdAt: { gte: period.start, lt: period.end } },
    ],
  };
  const [advances, guarantees] = await Promise.all([
    db.expectedPayment.groupBy({
      by: ["status"],
      where: advanceWhere,
      _count: { _all: true },
      _sum: { amount: true, paidAmount: true },
    }),
    db.budget.groupBy({
      by: ["securityDepositStatus"],
      where: budgetRef,
      _count: { _all: true },
      _sum: { securityDeposit: true, securityDepositRetained: true },
    }),
  ]);
  // Pendiente = lo que falta cobrar de señas de presupuestos vivos (un presupuesto perdido o cancelado no espera plata).
  const pendingLive = await db.expectedPayment.groupBy({
    by: ["status"],
    where: { ...advanceWhere, status: { in: ["AWAITING", "PROOF", "PARTIAL"] }, budget: { status: { notIn: [...LOST_BUDGET_STATUSES] } } },
    _sum: { amount: true, paidAmount: true },
  });
  const pending = pendingLive.reduce((sum, row) => sum + Math.max(0, (row._sum.amount ?? 0) - (row._sum.paidAmount ?? 0)), 0);
  const proofInReview = pendingLive
    .filter((row) => row.status === "PROOF")
    .reduce((sum, row) => sum + Math.max(0, (row._sum.amount ?? 0) - (row._sum.paidAmount ?? 0)), 0);

  const guaranteeRows: AdminRentalGuaranteeRow[] = guarantees
    .filter((row) => row.securityDepositStatus)
    .map((row) => {
      const amount = row._sum.securityDeposit ?? 0;
      const status = row.securityDepositStatus as string;
      const retained = status === "KEPT" ? amount : status === "KEPT_PARTIAL" ? row._sum.securityDepositRetained ?? 0 : 0;
      const returned = status === "RETURNED" ? amount : status === "KEPT_PARTIAL" ? amount - retained : 0;
      return { status, count: row._count._all, amount, retained, returned };
    });
  return {
    advances: {
      // Una seña confirmada está cobrada entera (las filas anteriores al cobro parcial pueden traer paidAmount en 0).
      collected: advances.reduce((sum, row) => sum + (row.status === "CONFIRMED" ? row._sum.amount ?? 0 : row._sum.paidAmount ?? 0), 0),
      pending,
      proofInReview,
      count: advances.reduce((sum, row) => sum + row._count._all, 0),
    },
    guarantees: guaranteeRows,
  };
}

async function profitabilitySection(organizationId: string, period: ReportPeriod): Promise<AdminRentalReport["profitability"]> {
  const revenue = await db.budgetItem.groupBy({
    by: ["inventoryId"],
    where: {
      excluded: false,
      inventoryId: { not: null },
      budget: { organizationId, status: "APPROVED", approvedAt: { gte: period.start, lt: period.end } },
    },
    _sum: { subtotal: true },
  });
  const earning = revenue.filter((row) => row.inventoryId && (row._sum.subtotal ?? 0) > 0);
  if (earning.length === 0) return null;
  const ids = earning.map((row) => row.inventoryId as string);
  const [items, incidents] = await Promise.all([
    db.inventoryItem.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } }),
    db.inventoryIncident.groupBy({
      by: ["inventoryId"],
      where: { organizationId, inventoryId: { in: ids }, openedAt: { gte: period.start, lt: period.end } },
      _count: { _all: true, cost: true },
      _sum: { cost: true },
    }),
  ]);
  const names = new Map(items.map((item) => [item.id, item.name]));
  const rows = earning
    .filter((row) => names.has(row.inventoryId as string))
    .map((row) => {
      const incident = incidents.find((entry) => entry.inventoryId === row.inventoryId);
      return profitRow({
        inventoryId: row.inventoryId as string,
        name: names.get(row.inventoryId as string) as string,
        revenue: row._sum.subtotal ?? 0,
        costSum: incident?._sum.cost ?? null,
        incidentCount: incident?._count._all ?? 0,
        incidentsWithCost: incident?._count.cost ?? 0,
      });
    })
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, "es"))
    .slice(0, LIST_LIMIT);
  return rows.length ? { rows } : null;
}

/** Sección «Alquileres» de la empresa para el mes `YYYY-MM`. */
export async function getRentalReport(organizationId: string, month: string, now = new Date()): Promise<AdminRentalReport> {
  const period = reportPeriod(month);
  const [occupancy, catalog, cancellations, incidents, deposits, profitability] = await Promise.all([
    occupancySection(organizationId, period, now),
    catalogSection(organizationId, period, now),
    cancellationsSection(organizationId, period),
    incidentsSection(organizationId, period),
    depositsSection(organizationId, period),
    profitabilitySection(organizationId, period),
  ]);
  return { days: period.days, occupancy, catalog, cancellations, incidents, deposits, profitability };
}
