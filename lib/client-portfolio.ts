import type { AdminClientBudgetRow, AdminClientMetrics, AdminClientRow } from "./admin-types";

/**
 * Reglas de la cartera y de la ficha de Clientes (rediseño): una sola fuente
 * para los KPI-filtro de la lista, los segmentos por tipo y la acción comercial
 * principal de la ficha. Son funciones puras sobre el payload de
 * `GET /api/admin/clients` y `GET /api/admin/clients/[id]`: no inventan datos.
 */

/** Segmentos por tipo real del cliente (`Client.type`: FINAL | RESELLER). */
export const CLIENT_SEGMENTS = [
  { key: "ALL", label: "Todos" },
  { key: "FINAL", label: "Cliente final" },
  { key: "RESELLER", label: "Mayorista" },
] as const;
export type ClientSegment = (typeof CLIENT_SEGMENTS)[number]["key"];

export type ClientKpiKey = "ACTIVE" | "BALANCE" | "WHOLESALE_LINK" | "NEW_MONTH" | "DORMANT";

/** Meses sin movimientos a partir de los cuales un cliente figura «sin actividad». */
export const DORMANT_MONTHS = 6;

type PortfolioClient = Pick<AdminClientRow, "type" | "active" | "createdAt" | "catalogLinkActive"> & {
  metrics: Pick<AdminClientMetrics, "balance" | "lastActivityAt">;
};

/** `aaaa-mm` del instante en el calendario de Asunción (el mes que ve el negocio). */
export function asuncionMonth(value: string | number | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit" }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}`;
}

/**
 * Sin actividad hace más de 6 meses: se mide desde la última actividad comercial
 * real (presupuesto, evento o cobro) y, si nunca la tuvo, desde el alta; así un
 * cliente recién cargado no figura como dormido.
 */
export function isDormant(client: PortfolioClient, now: number = Date.now()): boolean {
  const reference = new Date(client.metrics.lastActivityAt ?? client.createdAt);
  if (Number.isNaN(reference.getTime())) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - DORMANT_MONTHS);
  return reference.getTime() < limit.getTime();
}

export function matchesKpi(client: PortfolioClient, kpi: ClientKpiKey, now: number = Date.now()): boolean {
  switch (kpi) {
    case "ACTIVE":
      return client.active;
    case "BALANCE":
      return client.metrics.balance > 0;
    case "WHOLESALE_LINK":
      return client.type === "RESELLER" && client.catalogLinkActive === true;
    case "NEW_MONTH":
      return asuncionMonth(client.createdAt) === asuncionMonth(now);
    case "DORMANT":
      return isDormant(client, now);
  }
}

export function portfolioKpis(clients: readonly PortfolioClient[], now: number = Date.now()) {
  const count = (kpi: ClientKpiKey) => clients.filter((client) => matchesKpi(client, kpi, now)).length;
  return {
    total: clients.length,
    active: count("ACTIVE"),
    withBalance: count("BALANCE"),
    balanceAmount: clients.reduce((sum, client) => sum + Math.max(0, client.metrics.balance), 0),
    wholesaleLink: count("WHOLESALE_LINK"),
    resellers: clients.filter((client) => client.type === "RESELLER").length,
    newThisMonth: count("NEW_MONTH"),
    dormant: count("DORMANT"),
  };
}

export type ClientPrimaryAction =
  | { kind: "collect"; label: "Cobrar" }
  | { kind: "follow"; label: "Seguir presupuesto"; budgetId: string }
  | { kind: "quote"; label: "Nuevo presupuesto" };

/** Presupuesto enviado (o en negociación) más reciente que espera respuesta del cliente. */
export function openSentBudget(budgets: readonly Pick<AdminClientBudgetRow, "id" | "status" | "createdAt">[]) {
  return [...budgets]
    .filter((budget) => budget.status === "SENT" || budget.status === "NEGOTIATING")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

/**
 * Acción comercial principal de la ficha según el estado real del cliente:
 * saldo vencido → Cobrar; presupuesto enviado → Seguir presupuesto; si no →
 * Nuevo presupuesto. Cada una exige su permiso: si el rol no tiene el de la
 * primera, pasa a la siguiente que sí pueda hacer; sin ninguna, no hay acción.
 */
export function clientPrimaryAction(
  detail: { metrics: Pick<AdminClientMetrics, "overdue">; budgets: readonly Pick<AdminClientBudgetRow, "id" | "status" | "createdAt">[] },
  can: { collect: boolean; quote: boolean },
): ClientPrimaryAction | null {
  if (detail.metrics.overdue > 0 && can.collect) return { kind: "collect", label: "Cobrar" };
  const sent = openSentBudget(detail.budgets);
  if (sent && can.quote) return { kind: "follow", label: "Seguir presupuesto", budgetId: sent.id };
  if (can.quote) return { kind: "quote", label: "Nuevo presupuesto" };
  return null;
}

/**
 * Último evento realizado: el más reciente que ya empezó y no se canceló. Es un
 * hecho (no una estimación): sin eventos pasados devuelve `null`.
 */
export function lastClientEvent<T extends { startsAt: string | null; status: string }>(events: readonly T[], now: number = Date.now()): T | null {
  let best: T | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!event.startsAt || event.status === "CANCELLED") continue;
    const time = new Date(event.startsAt).getTime();
    if (!Number.isFinite(time) || time > now || time <= bestTime) continue;
    best = event;
    bestTime = time;
  }
  return best;
}
