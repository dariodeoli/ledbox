import { collectedAmount, overdueAmount, overdueCount, type AdminClientMetrics } from "@/lib/admin-types";

/**
 * Métricas reales de la ficha 360 del cliente (issue #34): una sola fuente para
 * la lista (`GET /api/admin/clients`) y el detalle (`GET /api/admin/clients/[id]`).
 *
 * La matemática vive acá y no en cada endpoint para que el orden por «monto
 * contratado», el filtro «sin compras» y los KPIs de la ficha no puedan
 * divergir. Las definiciones están documentadas en `lib/admin-types.ts`
 * (`AdminClientMetrics`).
 *
 * Los hechos aceptan `Date` (filas de Prisma server-side) o ISO (contrato JSON):
 * la regla de mora reutiliza `overdueAmount`/`overdueCount`, que evalúan el
 * vencimiento con el calendario de Asunción (`isOverdue`), el mismo que usa el
 * panel sobre el JSON.
 */

type MetricDate = string | Date;

type MetricBudget = {
  status: string;
  total: number;
  createdAt: MetricDate;
  approvedAt?: MetricDate | null;
};

type MetricPayment = {
  amount: number;
  status: string;
  dueAt: MetricDate | null;
  createdAt: MetricDate;
};

type MetricEvent = {
  name: string;
  status: string;
  startsAt: MetricDate | null;
  endsAt?: MetricDate | null;
  createdAt: MetricDate;
};

export type ClientMetricFacts = {
  budgets: MetricBudget[];
  payments: MetricPayment[];
  events: MetricEvent[];
};

/** Días promedio de un mes (año gregoriano), para expresar intervalos en meses. */
const MONTH_DAYS = 30.4375;
const DAY_MS = 86_400_000;

/** Instante real de una fecha (ISO o `Date`); `null` si falta o es inválida. */
function timeOf(value: MetricDate | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Fecha de contratación: la aprobación real cuando existe; si no, el alta del presupuesto. */
function contractTime(budget: MetricBudget): number | null {
  return timeOf(budget.approvedAt) ?? timeOf(budget.createdAt);
}

function toIso(time: number | null): string | null {
  return time === null ? null : new Date(time).toISOString();
}

export function clientMetrics(facts: ClientMetricFacts, now: Date = new Date()): AdminClientMetrics {
  const approved = facts.budgets.filter((budget) => budget.status === "APPROVED");
  const contractTimes = approved
    .map(contractTime)
    .filter((time): time is number => time !== null)
    .sort((a, b) => a - b);

  const contracted = approved.reduce((sum, budget) => sum + budget.total, 0);
  const collected = collectedAmount(facts.payments);

  // Frecuencia de contratación: promedio de días entre contrataciones
  // consecutivas, expresado en meses. Menos de 2 contratos no tiene muestra.
  const samples = Math.max(0, contractTimes.length - 1);
  const averageMonths =
    samples > 0
      ? Math.round(
          (contractTimes.slice(1).reduce((sum, time, index) => sum + (time - contractTimes[index]) / DAY_MS, 0) /
            samples /
            MONTH_DAYS) *
            10,
        ) / 10
      : null;

  // Próxima actividad: el primer evento en curso o por venir. Un evento que ya
  // arrancó cuenta hasta que termina (su `endsAt` manda); cancelados y
  // finalizados no son agenda.
  const nowTime = now.getTime();
  const upcoming = facts.events
    .filter((event) => event.status !== "CANCELLED" && event.status !== "COMPLETED")
    .filter((event) => {
      const end = timeOf(event.endsAt) ?? timeOf(event.startsAt);
      return end !== null && end >= nowTime;
    })
    .sort((a, b) => (timeOf(a.startsAt) ?? Number.POSITIVE_INFINITY) - (timeOf(b.startsAt) ?? Number.POSITIVE_INFINITY));
  const nextEvent = upcoming[0] ?? null;

  // Última actividad comercial: el alta más reciente entre presupuestos, cobros
  // y eventos (la agenda futura no adelanta la última actividad: se mira cuándo
  // se registró el hecho, no cuándo ocurre).
  const lastActivityAt = [
    ...facts.budgets.map((budget) => timeOf(budget.createdAt)),
    ...facts.payments.map((payment) => timeOf(payment.createdAt)),
    ...facts.events.map((event) => timeOf(event.createdAt)),
  ].reduce<number | null>((latest, time) => (time !== null && (latest === null || time > latest) ? time : latest), null);

  return {
    contracts: approved.length,
    contracted,
    collected,
    balance: Math.max(0, contracted - collected),
    overdue: overdueAmount(facts.payments),
    overdueCount: overdueCount(facts.payments),
    budgets: facts.budgets.length,
    lost: facts.budgets.filter((budget) => budget.status === "LOST").length,
    events: facts.events.length,
    upcomingEvents: upcoming.length,
    nextEventAt: toIso(timeOf(nextEvent?.startsAt ?? null)),
    nextEventName: nextEvent?.name ?? null,
    lastContractAt: toIso(contractTimes.length > 0 ? contractTimes[contractTimes.length - 1] : null),
    averageMonths,
    frequencySamples: samples,
    averageTicket: approved.length > 0 ? Math.round(contracted / approved.length) : null,
    lastActivityAt: toIso(lastActivityAt),
  };
}

/**
 * Indexa una lista de hechos por cliente para no recorrerla entera por cada
 * fila: la lista de clientes arma las métricas de todos de una sola pasada.
 */
export function factsByClient<T extends { clientId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.clientId);
    if (list) list.push(row);
    else map.set(row.clientId, [row]);
  }
  return map;
}
