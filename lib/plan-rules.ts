/**
 * Reglas puras de los planes vendibles (issue #42): catálogo de arranque,
 * límites, consumo y período del mes.
 *
 * Vive aparte de la capa server (`lib/server/plan-limits.ts`) para poder testearse
 * sin base: acá no hay Prisma ni `fetch`. La UI del panel las usa para dibujar el
 * consumo y el servidor para validar (el front solo ayuda, el API revalida).
 *
 * Decisión de conteo (documentada también en el schema): el límite de usuarios
 * cuenta membresías activas **más** invitaciones pendientes (invitar reserva un
 * lugar, así el tope no se rompe al aceptar una invitación vieja) y el de eventos
 * cuenta los **creados** en el mes calendario de Asunción.
 */

export const PLAN_CATALOG = [
  {
    id: "plan_inicial",
    code: "inicial",
    name: "Inicial",
    description: "Para empezar a ordenar la operación de una empresa.",
    maxUsers: 5,
    maxEventsPerMonth: 50,
    priceMonthly: 0,
    features: [
      "Eventos, calendario y checklist",
      "Clientes, leads y presupuestos",
      "Portal del cliente y cobros",
      "Hasta 5 usuarios y 50 eventos por mes",
    ],
    sortOrder: 10,
  },
  {
    id: "plan_negocio",
    code: "negocio",
    name: "Negocio",
    description: "Operación completa: agenda, finanzas, inventario y equipo.",
    maxUsers: 10,
    maxEventsPerMonth: 100,
    priceMonthly: 450000,
    features: [
      "Todo lo del plan Inicial",
      "Inventario, proveedores y promotoras",
      "Tesorería, gastos y cobranzas",
      "Hasta 10 usuarios y 100 eventos por mes",
    ],
    sortOrder: 20,
  },
  {
    id: "plan_pro",
    code: "pro",
    name: "Pro",
    description: "Para productoras y alquileres con equipo grande y varias marcas.",
    maxUsers: 20,
    maxEventsPerMonth: 200,
    priceMonthly: 890000,
    features: [
      "Todo lo del plan Negocio",
      "Exportaciones y reportes imprimibles",
      "Auditoría e historial completo",
      "Hasta 20 usuarios y 200 eventos por mes",
    ],
    sortOrder: 30,
  },
  {
    id: "plan_corporativo",
    code: "corporativo",
    name: "Corporativo",
    description: "Sin límites de usuarios ni de eventos, con acompañamiento dedicado.",
    maxUsers: null,
    maxEventsPerMonth: null,
    priceMonthly: 1900000,
    features: [
      "Todo lo del plan Pro",
      "Sin límite de usuarios",
      "Sin límite de eventos por mes",
      "Acompañamiento dedicado",
    ],
    sortOrder: 40,
  },
] as const;

/** Plan por defecto de toda empresa sin plan asignado (el backfill de la 027). */
export const DEFAULT_PLAN_CODE = "inicial";

/** Plan de la demo pública (issue #42): se ve, no se cambia. */
export const DEMO_PLAN_CODE = "pro";

/** Recursos con tope por plan. */
export const PLAN_RESOURCES = ["users", "events"] as const;
export type PlanResource = (typeof PLAN_RESOURCES)[number];

// ── Límites ─────────────────────────────────────────────────────────────────

/** ¿Sumar `adding` al consumo actual supera el límite? `null` = sin tope. */
export function planLimitReached(limit: number | null | undefined, used: number, adding = 1): boolean {
  if (limit === null || limit === undefined) return false;
  return used + adding > limit;
}

/** Consumo sobre el límite en porcentaje (0–100, recortado); `null` sin tope. */
export function planUsagePercent(used: number, limit: number | null | undefined): number | null {
  if (limit === null || limit === undefined || limit <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Semáforo del consumo: `danger` pasó el tope, `warn` está al 80 % o más. */
export function planUsageLevel(used: number, limit: number | null | undefined): "none" | "ok" | "warn" | "danger" {
  if (limit === null || limit === undefined) return "none";
  if (used > limit) return "danger";
  if (limit > 0 && used / limit >= 0.8) return "warn";
  return "ok";
}

/** Texto del tope para la UI: número formateado o «Sin tope». */
export function planLimitLabel(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return "Sin tope";
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(limit);
}

/**
 * Mensaje único del límite alcanzado: lo usa el API en el 403 explicado y la UI
 * lo muestra tal cual (con el acceso a la página de Plan para pedir el cambio).
 */
export function planLimitMessage(input: {
  planName: string;
  resource: PlanResource;
  limit: number;
  used: number;
  /** Período del cupo de eventos (por ejemplo «septiembre 2026»); sin él, «este mes». */
  periodLabel?: string | null;
}): string {
  const { planName, resource, limit, used, periodLabel } = input;
  const tope = planLimitLabel(limit);
  const usado = planLimitLabel(used);
  if (resource === "users") {
    return `Tu plan «${planName}» incluye ${tope} usuarios y ya tenés ${usado} entre activos e invitaciones pendientes. Solicitá un cambio de plan desde Plan.`;
  }
  const periodo = periodLabel?.trim() ? periodLabel.trim() : "este mes";
  return `Tu plan «${planName}» incluye ${tope} eventos por mes y en ${periodo} ya creaste ${usado}. Solicitá un cambio de plan desde Plan.`;
}

// ── Mes calendario de Asunción ──────────────────────────────────────────────
// Aritmética de claves `YYYY-MM-DD`/`YYYY-MM` (pura, sin zona): el rango real
// (00:00 de Asunción) lo resuelve `lib/server/plan-limits.ts` con los helpers de
// fecha que ya usa el panel.

/** Mes de una clave `YYYY-MM-DD` (`2026-09-21` → `2026-09`). */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** Primer día del mes siguiente a una clave `YYYY-MM-DD` (`2026-12-31` → `2027-01-01`). */
export function nextMonthStartKey(dayKey: string): string {
  const [year, month] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const paddedMonth = String(next.getUTCMonth() + 1).padStart(2, "0");
  return `${next.getUTCFullYear()}-${paddedMonth}-01`;
}

/** Etiqueta del mes en es-PY (`2026-09` → «septiembre 2026»). */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("es-PY", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
