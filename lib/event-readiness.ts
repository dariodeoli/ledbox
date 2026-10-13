import { daysUntilDue } from "./admin-format";
import { promoterIsAvailable, type AdminEventAssignment, type AdminEventPanelRow } from "./admin-types";

/**
 * Preparación de un evento (rediseño de Eventos): lógica pura que usan la
 * lista, las tarjetas, los indicadores y la ficha. Nada acá inventa datos: todo
 * sale de las tareas, las asignaciones y (si llegó) el presupuesto vinculado.
 * No toca el motor de inventario: solo lee lo que el panel ya trae.
 */

/** Unidades que ya salieron: lo despachado o, en filas viejas, toda la asignación. */
export function assignmentDispatched(assignment: Pick<AdminEventAssignment, "quantity" | "checkedOut" | "checkedOutAt" | "checkoutQuantity">): number {
  if ((assignment.checkoutQuantity ?? 0) > 0) return assignment.checkoutQuantity ?? 0;
  return assignment.checkedOut || assignment.checkedOutAt ? assignment.quantity : 0;
}

/** Unidades que salieron y todavía no volvieron ni se declararon faltantes. */
export function assignmentPending(assignment: AdminEventAssignment): number {
  if (assignment.checkedIn || assignment.checkedInAt) return 0;
  return Math.max(0, assignmentDispatched(assignment) - (assignment.returnedQuantity ?? 0) - assignment.missingQuantity);
}

/** Un combo no sale ni vuelve como unidad: sus movimientos son los de sus componentes. */
export function assignmentIsCombo(assignment: Pick<AdminEventAssignment, "inventory">): boolean {
  return (assignment.inventory._count?.components ?? 0) > 0;
}

export type EventDetailTab = "resumen" | "checklist" | "equipos" | "personal" | "historial";

export type EventPhase = "upcoming" | "live" | "ended" | "closed";

export type EventNextKey = "checklist" | "dispatch" | "return" | "finalize";

export type EventNext = { key: EventNextKey; label: string; tab: EventDetailTab };

export type EventGapKey = "checklist" | "dispatch" | "return" | "promoter" | "deposit";

export type EventGap = { key: EventGapKey; label: string; tab: EventDetailTab; tone: "warn" | "danger" };

/** Seña del presupuesto vinculado: `unknown` mientras no se pudo leer el presupuesto. */
export type EventDeposit = "paid" | "pending" | "none" | "unknown";

/** Lo mínimo del presupuesto vinculado que hace falta para saber si la seña entró. */
export type EventBudgetPrep = { advanceAmount: number; collected: number };

export type EventReadiness = {
  phase: EventPhase;
  tasks: { total: number; done: number; pending: number; overdue: number };
  /** Unidades sueltas (los combos se mueven por componentes y no cuentan acá). */
  equipment: { lines: number; combos: number; units: number; dispatched: number; toDispatch: number; pendingReturn: number };
  promoters: { count: number; unavailable: string[] };
  deposit: EventDeposit;
  gaps: EventGap[];
  next: EventNext | null;
};

type ReadinessEvent = Pick<AdminEventPanelRow, "status" | "startsAt" | "endsAt" | "tasks" | "assignments">;

export function isEventClosed(event: Pick<AdminEventPanelRow, "status">): boolean {
  return event.status === "COMPLETED" || event.status === "CANCELLED";
}

/** Ya pasó su fin (o, sin fin, el día de inicio), en día de Asunción. */
export function eventHasEnded(event: Pick<AdminEventPanelRow, "startsAt" | "endsAt">, now = Date.now()): boolean {
  if (event.endsAt) return new Date(event.endsAt).getTime() < now;
  if (!event.startsAt) return false;
  const days = daysUntilDue(event.startsAt);
  return days !== null && days < 0;
}

export function eventPhase(event: Pick<AdminEventPanelRow, "status" | "startsAt" | "endsAt">, now = Date.now()): EventPhase {
  if (isEventClosed(event)) return "closed";
  if (eventHasEnded(event, now)) return "ended";
  const start = event.startsAt ? new Date(event.startsAt).getTime() : null;
  if (event.status === "IN_PROGRESS" || (start !== null && start <= now)) return "live";
  return "upcoming";
}

/** Empieza hoy o dentro de los próximos `days` días (día de Asunción). */
export function startsWithinDays(event: Pick<AdminEventPanelRow, "startsAt">, days = 7): boolean {
  const left = daysUntilDue(event.startsAt);
  return left !== null && left >= 0 && left <= days;
}

export function depositState(budget: EventBudgetPrep | null | undefined, known: boolean): EventDeposit {
  if (!known) return "unknown";
  if (!budget || budget.advanceAmount <= 0) return "none";
  return budget.collected >= budget.advanceAmount ? "paid" : "pending";
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Movimiento de campo guardado en este equipo y todavía sin subir (cola sin conexión). */
export type QueuedMovement = "out" | "back" | null;

/**
 * Qué se puede hacer con una asignación, con las mismas reglas de siempre:
 * despachar lo que falta salir, registrar la devolución de lo que salió y
 * editar/quitar solo mientras no salió ni volvió. Un combo se mueve por componentes.
 */
export function assignmentControls(assignment: AdminEventAssignment, queued: QueuedMovement = null) {
  const isOut = Boolean(assignment.checkedOutAt || assignment.checkedOut || queued === "out");
  const isBack = Boolean(assignment.checkedInAt || assignment.checkedIn || queued === "back");
  const isCombo = assignmentIsCombo(assignment);
  const pendingBack = isOut && !isBack ? assignmentPending(assignment) : 0;
  const toDispatch = assignment.quantity - assignmentDispatched(assignment);
  return {
    isOut,
    isBack,
    isCombo,
    pendingBack,
    toDispatch,
    canDispatch: !isBack && !isCombo && toDispatch > 0,
    canReturn: isOut && !isBack && !isCombo && pendingBack > 0,
    canEdit: !isOut && !isBack,
  };
}

export function eventReadiness(
  event: ReadinessEvent,
  options: { deposit?: EventDeposit; now?: number; queued?: (assignmentId: string) => QueuedMovement } = {},
): EventReadiness {
  const now = options.now ?? Date.now();
  const phase = eventPhase(event, now);
  const deposit = options.deposit ?? "unknown";

  const done = event.tasks.filter((task) => task.completedAt).length;
  const overdue = event.tasks.filter((task) => {
    if (task.completedAt || !task.dueAt) return false;
    const days = daysUntilDue(task.dueAt);
    return days !== null && days < 0;
  }).length;
  const tasks = { total: event.tasks.length, done, pending: event.tasks.length - done, overdue };

  const loose = event.assignments.filter((assignment) => !assignmentIsCombo(assignment));
  // Una salida/devolución en cola cuenta como hecha: la fila no ofrece repetirla.
  const dispatchedOf = (assignment: AdminEventAssignment) =>
    options.queued?.(assignment.id) === "out" ? assignment.quantity : assignmentDispatched(assignment);
  const pendingOf = (assignment: AdminEventAssignment) => {
    const queued = options.queued?.(assignment.id) ?? null;
    if (queued === "back") return 0;
    return queued === "out"
      ? Math.max(0, assignment.quantity - (assignment.returnedQuantity ?? 0) - assignment.missingQuantity)
      : assignmentPending(assignment);
  };
  const equipment = {
    lines: event.assignments.length,
    combos: event.assignments.length - loose.length,
    units: loose.reduce((sum, assignment) => sum + assignment.quantity, 0),
    dispatched: loose.reduce((sum, assignment) => sum + Math.min(assignment.quantity, dispatchedOf(assignment)), 0),
    toDispatch: loose.reduce((sum, assignment) => sum + Math.max(0, assignment.quantity - dispatchedOf(assignment)), 0),
    pendingReturn: loose.reduce((sum, assignment) => sum + pendingOf(assignment), 0),
  };

  const promoterIds = new Set<string>();
  const unavailable = new Set<string>();
  for (const task of event.tasks) {
    if (!task.promoter) continue;
    promoterIds.add(task.promoter.id);
    if (!promoterIsAvailable(task.promoter)) unavailable.add(task.promoter.name);
  }
  const promoters = { count: promoterIds.size, unavailable: [...unavailable] };

  const gaps: EventGap[] = [];
  let next: EventNext | null = null;
  if (phase !== "closed") {
    const imminent = phase !== "upcoming" || startsWithinDays(event, 7);
    if (tasks.pending > 0) {
      gaps.push({
        key: "checklist",
        tab: "checklist",
        tone: tasks.overdue > 0 ? "danger" : "warn",
        label: `${plural(tasks.pending, "tarea pendiente", "tareas pendientes")}${tasks.overdue > 0 ? ` (${tasks.overdue} vencida${tasks.overdue === 1 ? "" : "s"})` : ""}`,
      });
    }
    if (imminent && phase !== "ended" && equipment.toDispatch > 0) {
      gaps.push({ key: "dispatch", tab: "equipos", tone: phase === "live" ? "danger" : "warn", label: `Faltan ${equipment.toDispatch} por despachar` });
    }
    if (phase === "ended" && equipment.pendingReturn > 0) {
      gaps.push({ key: "return", tab: "equipos", tone: "danger", label: `Faltan ${equipment.pendingReturn} por devolver` });
    }
    if (promoters.unavailable.length > 0) {
      gaps.push({ key: "promoter", tab: "personal", tone: "warn", label: `Promotora sin disponibilidad: ${promoters.unavailable.join(", ")}` });
    }
    if (deposit === "pending") gaps.push({ key: "deposit", tab: "resumen", tone: "warn", label: "Seña pendiente de cobro" });

    // La siguiente acción lógica, una sola.
    if (phase === "ended") {
      next = equipment.pendingReturn > 0
        ? { key: "return", label: "Registrar devolución", tab: "equipos" }
        : { key: "finalize", label: "Finalizar", tab: "resumen" };
    } else if (phase === "live") {
      if (equipment.toDispatch > 0) next = { key: "dispatch", label: "Despachar", tab: "equipos" };
      else if (tasks.pending > 0) next = { key: "checklist", label: "Completar checklist", tab: "checklist" };
    } else if (tasks.pending > 0) {
      next = { key: "checklist", label: "Completar checklist", tab: "checklist" };
    } else if (imminent && equipment.toDispatch > 0) {
      next = { key: "dispatch", label: "Despachar", tab: "equipos" };
    }
  }

  return { phase, tasks, equipment, promoters, deposit, gaps, next };
}

/** Filtros de los indicadores de la cabecera: cada uno filtra la lista al tocarlo. */
export type EventFocus = "next7" | "live" | "gaps" | "close";

export function matchesFocus(event: ReadinessEvent, focus: EventFocus, readiness: EventReadiness): boolean {
  if (readiness.phase === "closed") return false;
  switch (focus) {
    case "next7":
      return readiness.phase === "upcoming" && startsWithinDays(event, 7);
    case "live":
      return readiness.phase === "live";
    case "gaps":
      return readiness.gaps.length > 0;
    case "close":
      return readiness.phase === "ended";
  }
}
