import type { AdminIconName } from "./admin-types";

/**
 * Estado visual del inventario (rediseño E2, docs/INVENTARIO-REDISENO.md §4): UN solo mapa
 * `estado → { key, tone, icon, label }`. Ninguna pantalla decide un estado por su cuenta: la
 * lista, la cuadrícula, «Por categoría», los filtros y la ficha lo piden acá. Puro, sin red ni
 * React. Recibe el bloque `availability` que arma el API (ya con el atraso de P1-3) y el tono
 * sale de dato real, nunca inventado. Siempre ícono + texto: el color acompaña, no es el único
 * canal.
 */

export type InventoryStateTone = "ok" | "warn" | "danger" | "info" | "accent" | "neutral";

/** Estados en orden de precedencia: el primero que se cumple manda. */
export const INVENTORY_STATE_KEYS = ["archived", "out-of-service", "overdue", "rented", "damaged", "maintenance", "available", "empty"] as const;
export type InventoryStateKey = (typeof INVENTORY_STATE_KEYS)[number];

export type InventoryStateEntry = {
  key: string;
  tone: InventoryStateTone;
  icon: AdminIconName;
  label: string;
  /** Nombre completo para filtros y listas largas (la etiqueta del chip puede ser más corta). */
  longLabel?: string;
  /** Explicación para el `title` y para quien lee con lector de pantalla. */
  hint: string;
  /** Resalta la etiqueta (negrita): hoy solo la devolución vencida. */
  emphasis?: boolean;
};

export const INVENTORY_STATES: Record<InventoryStateKey, InventoryStateEntry> = {
  archived: { key: "archived", tone: "neutral", icon: "archive", label: "Archivado", hint: "Fuera de las listas activas; conserva sus datos." },
  "out-of-service": { key: "out-of-service", tone: "info", icon: "wrench", label: "Fuera de servicio", hint: "El producto está en mantenimiento o retirado." },
  overdue: {
    key: "overdue",
    tone: "danger",
    icon: "alert",
    label: "Vencida",
    longLabel: "Devolución vencida",
    hint: "Devolución vencida: salió, no volvió y ya pasó el fin previsto.",
    emphasis: true,
  },
  rented: { key: "rented", tone: "danger", icon: "truck", label: "Alquilado", hint: "No quedan unidades libres: todas están comprometidas ahora." },
  damaged: { key: "damaged", tone: "warn", icon: "alert", label: "Dañado", hint: "No quedan unidades libres: hay unidades dañadas, perdidas o retenidas por daño." },
  maintenance: { key: "maintenance", tone: "info", icon: "wrench", label: "Mantenimiento", hint: "No quedan unidades libres: hay unidades en mantenimiento, reparación o lavandería." },
  available: { key: "available", tone: "ok", icon: "check", label: "Disponible", hint: "Hay unidades libres hoy." },
  empty: { key: "empty", tone: "neutral", icon: "inventory", label: "Sin stock libre", hint: "No hay unidades libres y no hay un motivo registrado." },
};

/** «Reservado a futuro»: marca secundaria (acento · calendario), no compite con el estado principal. */
/** Juego (combo) sin piezas cargadas: no se puede reservar hasta completarlo. */
export const INCOMPLETE_STATE: InventoryStateEntry = {
  key: "incomplete",
  tone: "warn",
  icon: "alert",
  label: "Incompleto",
  hint: "Juego sin piezas cargadas: no se puede reservar hasta completarlo.",
};

export const RESERVED_STATE: InventoryStateEntry = {
  key: "reserved",
  tone: "accent",
  icon: "calendar",
  label: "Reservado",
  hint: "Tiene una reserva a futuro.",
};

/** Opciones del filtro «Estado»: los del mapa, en orden de precedencia, más el reservado. */
export const INVENTORY_STATE_FILTER_OPTIONS: ReadonlyArray<{ value: InventoryStateKey | "reserved"; label: string }> = [
  ...INVENTORY_STATE_KEYS.filter((key) => key !== "empty").map((key) => ({ value: key, label: INVENTORY_STATES[key].longLabel ?? INVENTORY_STATES[key].label })),
  { value: "reserved", label: "Reservado a futuro" },
];

export type InventoryStateAvailability = {
  committedNow: number;
  availableNow: number;
  /** Unidades por estado (AVAILABLE, MAINTENANCE, DAMAGED, LOST, RETIRED), de un `groupBy`. */
  unitsByStatus?: Readonly<Record<string, number>>;
  /** Cantidad retenida por incidentes abiertos sin unidad con código, por tipo (DAMAGE, MISSING, REPAIR, CLEANING). */
  holdByKind?: Readonly<Record<string, number>>;
  /** Inicio de la próxima reserva a futuro (ISO), si hay. */
  nextCommittedAt?: string | null;
  /** Unidades que salieron, no volvieron y pasaron el fin previsto (P1-3). */
  overduePending?: number;
};

export type InventoryStateInput = {
  archivedAt?: string | null;
  /** Estado del producto (`InventoryStatus`). */
  status: string;
  quantity: number;
  availability: InventoryStateAvailability;
};

const num = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** Unidades dañadas o perdidas más lo retenido por daño o faltante. */
export function damagedCount(availability: InventoryStateAvailability): number {
  const units = availability.unitsByStatus ?? {};
  const hold = availability.holdByKind ?? {};
  return num(units.DAMAGED) + num(units.LOST) + num(hold.DAMAGE) + num(hold.MISSING);
}

/** Unidades en mantenimiento más lo retenido por reparación o limpieza. */
export function maintenanceCount(availability: InventoryStateAvailability): number {
  const units = availability.unitsByStatus ?? {};
  const hold = availability.holdByKind ?? {};
  return num(units.MAINTENANCE) + num(hold.REPAIR) + num(hold.CLEANING);
}

/** Clave del estado principal según la precedencia del diseño (§4). */
export function inventoryStateKey(input: InventoryStateInput): InventoryStateKey {
  const { availability } = input;
  if (input.archivedAt) return "archived";
  if (input.status === "MAINTENANCE" || input.status === "RETIRED") return "out-of-service";
  if (num(availability.overduePending) > 0) return "overdue";
  const freeNow = num(availability.availableNow);
  if (freeNow === 0 && num(availability.committedNow) > 0) return "rented";
  if (freeNow === 0 && damagedCount(availability) > 0) return "damaged";
  if (freeNow === 0 && maintenanceCount(availability) > 0) return "maintenance";
  if (freeNow > 0) return "available";
  return "empty";
}

export type InventorySegment = { key: "free" | "rented" | "damaged" | "maintenance"; tone: InventoryStateTone; count: number; label: string };

export type InventoryVisualState = {
  state: InventoryStateEntry;
  /** Reserva a futuro (marca secundaria) con la fecha real de la próxima. */
  reserved: (InventoryStateEntry & { at: string }) | null;
  free: number;
  total: number;
  /** «12/40»; null en combos y productos sin unidades (no hay total propio). */
  fraction: string | null;
  /** Barra segmentada solo cuando el stock está repartido (más de un grupo con unidades). */
  segments: InventorySegment[];
  partial: boolean;
};

/**
 * Todo lo que la pantalla dibuja de un producto: estado principal, reserva a futuro, «libres/total»
 * y la barra segmentada (verde libres · rojo comprometidas o vencidas · naranja dañadas · azul
 * mantenimiento). Los tramos se recortan para no pasar del total.
 */
export function inventoryVisualState(input: InventoryStateInput, options: { combo?: boolean } = {}): InventoryVisualState {
  const { availability } = input;
  const state = INVENTORY_STATES[inventoryStateKey(input)];
  const free = num(availability.availableNow);
  const total = options.combo ? 0 : Math.max(0, input.quantity);
  const nextAt = availability.nextCommittedAt ?? null;
  const reserved = nextAt ? { ...RESERVED_STATE, at: nextAt, label: `Reservado desde ${formatReservedDay(nextAt)}` } : null;

  const rawSegments: Array<Omit<InventorySegment, "label">> = [
    { key: "damaged", tone: "warn", count: damagedCount(availability) },
    { key: "maintenance", tone: "info", count: maintenanceCount(availability) },
    { key: "rented", tone: "danger", count: num(availability.committedNow) + num(availability.overduePending) },
    { key: "free", tone: "ok", count: free },
  ];
  let room = total;
  const clamped = new Map<InventorySegment["key"], number>();
  for (const segment of rawSegments) {
    const count = Math.min(segment.count, room);
    room -= count;
    clamped.set(segment.key, count);
  }
  const labels: Record<InventorySegment["key"], string> = { free: "libres", rented: "comprometidas", damaged: "dañadas", maintenance: "en mantenimiento" };
  const ordered = (["free", "rented", "damaged", "maintenance"] as const)
    .map((key): InventorySegment => ({ key, tone: rawSegments.find((entry) => entry.key === key)!.tone, count: clamped.get(key) ?? 0, label: labels[key] }))
    .filter((segment) => segment.count > 0);
  const partial = total > 0 && ordered.length > 1;
  return {
    state,
    reserved,
    free,
    total,
    fraction: total > 0 ? `${free}/${total}` : null,
    segments: total > 0 ? ordered : [],
    partial,
  };
}

/** ¿El producto entra en el filtro de estado elegido? `""` o `ALL` no filtran. */
export function inventoryStateMatches(input: InventoryStateInput, filter: string): boolean {
  if (!filter || filter === "ALL") return true;
  if (filter === "reserved") return Boolean(input.availability.nextCommittedAt);
  return inventoryStateKey(input) === filter;
}

/** «18/10» de una fecha ISO (America/Asuncion, como el resto del panel). */
export function formatReservedDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}`;
}

// ── Unidades ────────────────────────────────────────────────────────────────

export const UNIT_STATES: Record<string, InventoryStateEntry> = {
  AVAILABLE: { key: "available", tone: "ok", icon: "check", label: "Disponible", hint: "La unidad está libre." },
  DAMAGED: { key: "damaged", tone: "warn", icon: "alert", label: "Dañada", hint: "La unidad está dañada." },
  MAINTENANCE: { key: "maintenance", tone: "info", icon: "wrench", label: "Mantenimiento", hint: "La unidad está en mantenimiento o lavandería." },
  LOST: { key: "lost", tone: "danger", icon: "alert", label: "Perdida", hint: "La unidad se perdió." },
  RETIRED: { key: "archived", tone: "neutral", icon: "archive", label: "Retirada", hint: "La unidad salió del inventario." },
};

/** Estado visual de una unidad física; un estado desconocido se muestra tal cual, en neutro. */
export function unitVisualState(status: string): InventoryStateEntry {
  return UNIT_STATES[status] ?? { key: "empty", tone: "neutral", icon: "info", label: status || "Sin estado", hint: "Estado no reconocido." };
}
