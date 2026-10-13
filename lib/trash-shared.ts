/**
 * Papelera, parte compartida entre el cliente y las pruebas (docs/PAPELERA.md §UI):
 * registro de tipos de entidad, normalización del nombre de confirmación, textos de
 * los bloqueos y armado del menú «•••». Sin imports de servidor.
 *
 * Para sumar una entidad (E3: Client, Lead, Supplier, Promoter, Budget) alcanza con
 * una línea en `TRASH_ENTITIES`.
 */

import type { AdminIconName } from "./admin-types";

export const PURGE_REASON_MAX = 200;

/** Estados de evento que se pueden archivar (mismo criterio que el servidor). */
export const EVENT_ARCHIVABLE_STATUSES = ["COMPLETED", "CANCELLED", "DRAFT"] as const;

/** Mismo criterio que `archiveCrm` del servidor. */
export const LEAD_STALE_DAYS = 30;
export const BUDGET_ARCHIVABLE_STATUSES = ["DRAFT", "LOST", "CANCELLED"] as const;

export function budgetArchiveBlockedReason(status: string): string | null {
  return (BUDGET_ARCHIVABLE_STATUSES as readonly string[]).includes(status) ? null : "Solo se archivan presupuestos en borrador, perdidos o cancelados";
}

export function leadArchiveBlockedReason(status: string, updatedAt: string | null | undefined, now = Date.now()): string | null {
  if (status === "WON" || status === "LOST") return null;
  const last = updatedAt ? new Date(updatedAt).getTime() : NaN;
  if (Number.isFinite(last) && now - last > LEAD_STALE_DAYS * 864e5) return null;
  return `Solo se archivan leads ganados, perdidos o sin actividad hace más de ${LEAD_STALE_DAYS} días`;
}

export function eventArchiveBlockedReason(status: string): string | null {
  return (EVENT_ARCHIVABLE_STATUSES as readonly string[]).includes(status) ? null : "Solo se archivan eventos finalizados, cancelados o en borrador";
}

export type TrashEntityConfig = {
  /** Nombre singular para frases («este evento»). */
  label: string;
  /** Texto del tipo en la lista de Eliminados. */
  typeLabel: string;
  icon: AdminIconName;
  /** Base de la API: `POST <apiBase>/<id>/<action>`. */
  apiBase: string;
  /** Existe `anonymize` para este tipo (se ofrece cuando hay bloqueos contables). */
  anonymizable: boolean;
  /** Artículo y demostrativo para los avisos («este evento», «este producto»). */
  demonstrative: string;
};

export const TRASH_ENTITIES = {
  Event: { label: "evento", typeLabel: "Evento", icon: "events", apiBase: "/api/admin/events", anonymizable: true, demonstrative: "este evento" },
  Client: { label: "cliente", typeLabel: "Cliente", icon: "clients", apiBase: "/api/admin/clients", anonymizable: true, demonstrative: "este cliente" },
  Lead: { label: "lead", typeLabel: "Lead", icon: "leads", apiBase: "/api/admin/leads", anonymizable: true, demonstrative: "este lead" },
  Supplier: { label: "proveedor", typeLabel: "Proveedor", icon: "suppliers", apiBase: "/api/admin/suppliers", anonymizable: true, demonstrative: "este proveedor" },
  Promoter: { label: "promotora", typeLabel: "Promotora", icon: "promoters", apiBase: "/api/admin/promoters", anonymizable: true, demonstrative: "esta promotora" },
  Budget: { label: "presupuesto", typeLabel: "Presupuesto", icon: "budgets", apiBase: "/api/admin/budgets", anonymizable: false, demonstrative: "este presupuesto" },
  InventoryItem: { label: "producto", typeLabel: "Producto", icon: "inventory", apiBase: "/api/admin/inventory", anonymizable: false, demonstrative: "este producto" },
} as const satisfies Record<string, TrashEntityConfig>;

export type TrashEntityType = keyof typeof TRASH_ENTITIES;

export function isTrashEntityType(value: string): value is TrashEntityType {
  return Object.hasOwn(TRASH_ENTITIES, value);
}

export type TrashAction = "archive" | "unarchive" | "trash" | "restore" | "purge" | "anonymize";

export function trashActionPath(type: TrashEntityType, id: string, action: TrashAction): string {
  return `${TRASH_ENTITIES[type].apiBase}/${encodeURIComponent(id)}/${action}`;
}

/** Fila de `GET /api/admin/trash` (mismo shape que `TrashRow` del servidor). */
export type TrashItem = {
  type: string;
  id: string;
  name: string;
  deletedAt: string;
  deletedById: string | null;
  deletedByName: string | null;
  reason: string | null;
  anonymized: boolean;
  blockers: TrashBlocker[];
};

export type TrashBlocker = { kind: string; count: number };

// ── Nombre de confirmación ───────────────────────────────────────────────────

/** Igual que `normalizeName` del servidor: sin tildes, minúsculas y espacios colapsados. */
export function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function namesMatch(typed: unknown, actual: string): boolean {
  return typeof typed === "string" && normalizeName(typed) !== "" && normalizeName(typed) === normalizeName(actual);
}

/** El borrado definitivo se habilita con el nombre exacto (normalizado) y un motivo de hasta 200 caracteres. */
export function canConfirmPurge(typedName: string, actualName: string, reason: string): boolean {
  const trimmed = reason.trim();
  return namesMatch(typedName, actualName) && trimmed.length > 0 && trimmed.length <= PURGE_REASON_MAX;
}

// ── Bloqueos ─────────────────────────────────────────────────────────────────

const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

const BLOCKER_TEXT: Record<string, (count: number) => string> = {
  status: () => "Está confirmado o en curso",
  assignments: (n) => (n === 1 ? "Tiene 1 reserva sin devolver" : `Tiene ${n} reservas sin devolver`),
  incidents: (n) => (n === 1 ? "Tiene 1 incidente abierto" : `Tiene ${n} incidentes abiertos`),
  usedInCombos: (n) => (n === 1 ? "Es componente de 1 combo" : `Es componente de ${n} combos`),
  budgetItems: (n) => (n === 1 ? "Está en 1 ítem de presupuesto" : `Está en ${n} ítems de presupuesto`),
  payments: (n) => `Tiene ${plural(n, "cobro", "cobros")}`,
  paymentProofs: (n) => `Tiene ${plural(n, "comprobante", "comprobantes")}`,
  confirmedExpectedPayments: (n) => `Tiene ${plural(n, "pago esperado confirmado", "pagos esperados confirmados")}`,
  invoices: (n) => `Tiene ${plural(n, "factura", "facturas")}`,
  signatureRequests: (n) => `Tiene ${plural(n, "pedido de firma", "pedidos de firma")}`,
  approvedBudgets: (n) => `Tiene ${plural(n, "presupuesto aprobado", "presupuestos aprobados")}`,
  signedBudgets: (n) => `Tiene ${plural(n, "presupuesto firmado", "presupuestos firmados")}`,
  events: (n) => `Tiene ${plural(n, "evento vivo", "eventos vivos")}`,
  budgets: (n) => `Tiene ${plural(n, "presupuesto vivo", "presupuestos vivos")}`,
  pendingJobs: (n) => `Tiene ${plural(n, "trabajo de proveedor pendiente", "trabajos de proveedor pendientes")}`,
  futureTasks: (n) => `Tiene ${plural(n, "tarea en un evento futuro", "tareas en eventos futuros")}`,
  tasks: (n) => `Tiene ${plural(n, "tarea asignada", "tareas asignadas")}`,
  supplierJobs: (n) => `Tiene ${plural(n, "trabajo de proveedor", "trabajos de proveedor")}`,
  expenses: (n) => `Tiene ${plural(n, "gasto", "gastos")}`,
  purchaseInvoices: (n) => `Tiene ${plural(n, "factura de compra", "facturas de compra")}`,
  notDraft: () => "Ya no está en borrador",
  budgetsWithHistory: (n) => `Tiene ${plural(n, "presupuesto con firma, cobro o factura", "presupuestos con firma, cobro o factura")}`,
  eventExpenses: (n) => `Sus eventos tienen ${plural(n, "gasto", "gastos")}`,
  eventInvoices: (n) => `Sus eventos tienen ${plural(n, "factura", "facturas")}`,
  eventSupplierJobs: (n) => `Sus eventos tienen ${plural(n, "trabajo de proveedor", "trabajos de proveedor")}`,
  eventIncidents: (n) => `Sus eventos tienen ${plural(n, "incidente", "incidentes")}`,
  eventAssignments: (n) => (n === 1 ? "Sus eventos tienen 1 reserva sin devolver" : `Sus eventos tienen ${n} reservas sin devolver`),
  eventsWithPayments: (n) => `Tiene ${plural(n, "evento con cobros", "eventos con cobros")}`,
};

/** Aviso concreto en castellano para un bloqueo; un tipo nuevo cae en un texto genérico con su cantidad. */
export function formatBlocker(blocker: TrashBlocker): string {
  const text = BLOCKER_TEXT[blocker.kind];
  return text ? text(blocker.count) : `Tiene ${blocker.count} ${blocker.kind}`;
}

export function formatBlockers(blockers: readonly TrashBlocker[]): string[] {
  return blockers.map(formatBlocker);
}

/** Se puede ofrecer «Anonimizar»: el tipo lo soporta y quedan bloqueos contables. */
export function canOfferAnonymize(type: string, blockers: readonly TrashBlocker[]): boolean {
  return isTrashEntityType(type) && TRASH_ENTITIES[type].anonymizable && blockers.length > 0;
}

/** Lee `blockers` de un cuerpo de error 409 (ignora lo que no tenga la forma esperada). */
export function readBlockers(payload: unknown): TrashBlocker[] {
  const raw = payload && typeof payload === "object" ? (payload as { blockers?: unknown }).blockers : null;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { kind, count } = entry as { kind?: unknown; count?: unknown };
    return typeof kind === "string" && typeof count === "number" && count > 0 ? [{ kind, count }] : [];
  });
}

// ── Menú «•••» ───────────────────────────────────────────────────────────────

export type TrashMenuEntry = {
  key: "archive" | "unarchive" | "trash";
  label: string;
  icon: AdminIconName;
  title: string;
  disabled?: boolean;
};

export const ARCHIVE_FIRST_TITLE = "Archivalo primero";

/**
 * Entradas de archivar/desarchivar/eliminar según el estado. Sin permiso de
 * escritura (VIEWER, FINANCE…) no hay ninguna. «Eliminar» solo funciona sobre lo
 * archivado: en lo activo queda visible pero deshabilitado con «Archivalo primero».
 */
export function trashMenuEntries(input: {
  type: TrashEntityType;
  name: string;
  archived: boolean;
  canWrite: boolean;
  /** Motivo por el que hoy no se puede archivar (p. ej. el estado del evento). */
  archiveBlockedReason?: string | null;
}): TrashMenuEntry[] {
  if (!input.canWrite) return [];
  const { label } = TRASH_ENTITIES[input.type];
  const entries: TrashMenuEntry[] = [];
  if (input.archived) {
    entries.push({ key: "unarchive", label: "Desarchivar", icon: "refresh", title: `Desarchivar ${label} ${input.name}` });
    entries.push({ key: "trash", label: "Eliminar", icon: "trash", title: `Enviar a la papelera ${label} ${input.name}` });
  } else {
    entries.push({
      key: "archive",
      label: "Archivar",
      icon: "inventory",
      title: input.archiveBlockedReason || `Archivar ${label} ${input.name}`,
      disabled: Boolean(input.archiveBlockedReason),
    });
    entries.push({ key: "trash", label: "Eliminar", icon: "trash", title: ARCHIVE_FIRST_TITLE, disabled: true });
  }
  return entries;
}

// ── Filtros de Ajustes → Eliminados ─────────────────────────────────────────

/** Día calendario (AAAA-MM-DD) en Asunción de un instante ISO; vacío si no se puede leer. */
export function trashDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export type TrashFilters = { type: string; by: string; from: string; to: string };

export const TRASH_NO_ONE = "none";

/** `type`/`by` en «ALL» no filtran; `by` = id de quien eliminó (o «none» si no se registró); `from`/`to` son días inclusivos. */
export function filterTrashItems(items: readonly TrashItem[], filters: TrashFilters): TrashItem[] {
  return items.filter((item) => {
    if (filters.type !== "ALL" && item.type !== filters.type) return false;
    if (filters.by !== "ALL" && (item.deletedById ?? TRASH_NO_ONE) !== filters.by) return false;
    const day = trashDayKey(item.deletedAt);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });
}
