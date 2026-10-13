/**
 * «Para hacer hoy» del Resumen: arma las acciones por urgencia a partir de datos
 * reales (avisos operativos + `GET /api/admin/resumen`). Es una función pura para
 * poder fijarla con tests; la pantalla solo la dibuja.
 *
 * Urgencia (de arriba abajo):
 * 1. rojo: mora (cobros a plazo vencidos), cheque rechazado y pagos esperados vencidos;
 * 2. ámbar: leads sin contestar y checklist incompleto de eventos próximos;
 * 3. cian: comprobantes por confirmar;
 * 4. neutro: el resto de los avisos (tareas, proveedores, reservas, solicitudes del portal).
 */

import type { AdminNotification, AdminResumen } from "./admin-types";

export type TodayTone = "danger" | "warn" | "info" | "neutral";

export type TodayAction = {
  id: string;
  tone: TodayTone;
  title: string;
  detail: string;
  /** Texto del botón de acción («Cobrar», «Contestar»…). */
  label: string;
  /** Lugar exacto donde se resuelve. */
  href: string;
  /** Día (`YYYY-MM-DD`) del hecho, si aplica. */
  date: string | null;
};

/** Cantidad que se muestra antes de «Ver todos». */
export const TODAY_ACTIONS_LIMIT = 5;

const TONE_RANK: Record<TodayTone, number> = { danger: 0, warn: 1, info: 2, neutral: 3 };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Texto de los montos del detalle: PYG completo con separador de miles es-PY. */
const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
function money(value: number): string {
  return `Gs ${gs.format(value)}`;
}

/** Días enteros entre dos claves `YYYY-MM-DD` (a − b). */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

const NEUTRAL_LABEL: Record<string, string> = {
  task: "Resolver",
  supplier_due: "Pagar",
  reservation: "Reservar",
  portal_request: "Responder",
  collection: "Cobrar",
  collection_due: "Cobrar",
};

export function buildTodayActions(input: {
  notifications: readonly AdminNotification[];
  resumen: Pick<AdminResumen, "money" | "attention"> | null;
  /** Día de hoy en Asunción (`YYYY-MM-DD`), para «hace N días». */
  today: string;
}): TodayAction[] {
  const { notifications, resumen, today } = input;
  const actions: TodayAction[] = [];

  if (resumen) {
    const { money: cash, attention } = resumen;
    if (cash.overdueCount > 0) {
      actions.push({
        id: "mora",
        tone: "danger",
        title: `${plural(cash.overdueCount, "cobro en mora", "cobros en mora")} · ${money(cash.overdueAmount)}`,
        detail: "Cuotas a plazo vencidas sin cobrar: cobralas o recordáselas al cliente.",
        label: "Cobrar",
        href: "/finanzas/por-cobrar",
        date: null,
      });
    }
    if (attention.rejectedCheques > 0) {
      actions.push({
        id: "cheques",
        tone: "danger",
        title: plural(attention.rejectedCheques, "cheque rechazado", "cheques rechazados"),
        detail: "Cobros con cheque anulados en los últimos 30 días: confirmá cómo se re-emitieron.",
        label: "Revisar",
        href: "/finanzas/por-cobrar",
        date: null,
      });
    }
    if (attention.newLeads > 0) {
      const age = attention.oldestLeadDay ? dayDiff(today, attention.oldestLeadDay) : 0;
      actions.push({
        id: "leads",
        tone: "warn",
        title: `${plural(attention.newLeads, "lead sin contestar", "leads sin contestar")}`,
        detail:
          age > 0
            ? `El más viejo espera hace ${plural(age, "día", "días")}: contestá antes de que se enfríe.`
            : "Entraron hoy: contestá mientras están calientes.",
        label: "Contestar",
        href: "/leads?estado=NEW",
        date: attention.oldestLeadDay,
      });
    }
    if (attention.proofsToConfirm > 0) {
      actions.push({
        id: "comprobantes",
        tone: "info",
        title: `${plural(attention.proofsToConfirm, "comprobante por confirmar", "comprobantes por confirmar")} · ${money(attention.proofsAmount)}`,
        detail: "El cliente ya pagó: verificá en el banco y confirmá el cobro.",
        label: "Confirmar",
        href: "/finanzas/por-confirmar",
        date: null,
      });
    }
  }

  for (const notification of notifications) {
    const base = {
      id: notification.id,
      date: notification.date,
      href: notification.href,
    };
    const detail = [notification.subtitle].filter(Boolean).join(" · ");
    switch (notification.kind) {
      // Cubiertos por los agregados de arriba (misma fuente, sin duplicar).
      case "lead":
      case "payment_proof":
        break;
      case "collection_due":
        if (notification.level === "overdue" && resumen && resumen.money.overdueCount > 0) break;
        actions.push({
          ...base,
          tone: notification.level === "overdue" ? "danger" : "neutral",
          title: notification.title,
          detail,
          label: "Cobrar",
          href: "/finanzas/por-cobrar",
        });
        break;
      case "expected_due":
        actions.push({
          ...base,
          tone: notification.level === "overdue" ? "danger" : "neutral",
          title: notification.title,
          detail,
          label: "Reclamar",
          href: "/finanzas/por-confirmar",
        });
        break;
      case "checklist":
        actions.push({ ...base, tone: "warn", title: notification.title, detail, label: "Completar", href: "/eventos" });
        break;
      default:
        actions.push({
          ...base,
          tone: "neutral",
          title: notification.title,
          detail,
          label: NEUTRAL_LABEL[notification.kind] ?? "Abrir",
        });
    }
  }

  // Orden estable: urgencia, y dentro de cada una el orden de armado (agregados
  // primero y después los avisos, que ya vienen por nivel y fecha).
  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => TONE_RANK[a.action.tone] - TONE_RANK[b.action.tone] || a.index - b.index)
    .map(({ action }) => action);
}

export type WeekChip = { label: string; tone: "danger" | "warn" | "ok" | "neutral" };

/**
 * Chip de estado de un evento de la semana: lo más urgente primero. Checklist sin
 * arrancar o incompleto, después seña pendiente; sin tareas cargadas se dice así
 * (no se inventa un «listo»).
 */
export function weekEventChip(event: {
  tasksTotal: number;
  tasksDone: number;
  depositPending: number;
}): WeekChip {
  if (event.tasksTotal > 0 && event.tasksDone === 0) {
    return { label: `Checklist 0/${event.tasksTotal}`, tone: "danger" };
  }
  if (event.tasksTotal > 0 && event.tasksDone < event.tasksTotal) {
    return { label: `Checklist ${event.tasksDone}/${event.tasksTotal}`, tone: "warn" };
  }
  if (event.depositPending > 0) {
    return { label: `Seña pendiente · ${money(event.depositPending)}`, tone: "warn" };
  }
  if (event.tasksTotal === 0) return { label: "Sin checklist", tone: "neutral" };
  return { label: "Listo", tone: "ok" };
}
