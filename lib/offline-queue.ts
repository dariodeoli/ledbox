"use client";

/**
 * Cola local de acciones de campo (issue #23): checklist del evento y
 * salida/devolución de equipos. Cuando el equipo no tiene señal, la acción se
 * guarda en el navegador (IndexedDB y, si no está disponible, localStorage) y
 * se sube al recuperar la conexión.
 *
 * Reglas (docs/REGLAS-GENERALES.md, §6 estados honestos y §8 dinero/idempotencia):
 * - Una acción se sube **una sola vez**: mientras se envía queda `syncing`
 *   (reclamo atómico por transacción), al confirmar el servidor pasa a `synced`
 *   y nunca se reintenta.
 * - Si el POST llegó pero la respuesta se perdió, el reintento no duplica: el
 *   toggle del checklist es un «set» (mismo estado final) y el movimiento de
 *   equipos responde 409 «ya está registrada», que acá se clasifica como
 *   `duplicate` y se muestra como sincronizado con su constancia.
 * - Un rechazo real (4xx/5xx) queda `failed` con el motivo y no se reintenta solo.
 * - Nada se muestra como «listo» sin confirmación del servidor.
 */

export type OfflineActionKind = "event-task-toggle" | "inventory-checkout" | "inventory-checkin";

/** Estado honesto de una acción: pendiente de subir, subiendo, sincronizada o fallida. */
export type OfflineActionStatus = "pending" | "syncing" | "synced" | "failed";

export type OfflineAction = {
  id: string;
  kind: OfflineActionKind;
  /** Endpoint real del panel que aplica la acción. */
  path: string;
  /** Cuerpo exacto del POST, tal como lo manda el panel online. */
  body: Record<string, unknown>;
  /** Línea corta para el detalle de la cola (ej.: `Marcar cumplida: «Verificar equipos»`). */
  summary: string;
  /** Contexto de la acción (ej.: `Evento: Lanzamiento Samsung`). */
  detail: string;
  createdAt: string;
  status: OfflineActionStatus;
  attempts: number;
  lastAttemptAt: string | null;
  syncedAt: string | null;
  error: string | null;
  /** El servidor confirmó que ya la tenía registrada: se sincronizó sin duplicar. */
  confirmedDuplicate: boolean;
};

export type OfflineActionInput = Pick<OfflineAction, "kind" | "path" | "body" | "summary" | "detail">;

/** Resultado del intento de subir una acción (lo produce el transporte del panel). */
export type OfflineSendOutcome =
  | { kind: "ok" }
  | { kind: "duplicate"; message: string }
  | { kind: "rejected"; error: string }
  | { kind: "offline" };

export type OfflineSender = (action: OfflineAction) => Promise<OfflineSendOutcome>;

export type OfflineQueueSummary = {
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  /** Acciones que todavía no están en el servidor (pendientes + subiendo). */
  toUpload: number;
};

export type FlushSummary = {
  attempted: number;
  synced: number;
  duplicates: number;
  failed: number;
  /** La conexión se cortó durante el envío: el resto sigue pendiente. */
  offline: boolean;
};

const DB_NAME = "ledbox-offline";
const DB_VERSION = 1;
const STORE_NAME = "actions";
const STORAGE_KEY = "ledbox-offline-actions";
const BROADCAST_CHANNEL = "ledbox-offline";
/** Un reclamo de envío más viejo que esto quedó huérfano (pestaña cerrada a mitad de envío). */
const CLAIM_STALE_MS = 60_000;
/** Historial de acciones sincronizadas que se conserva en el equipo. */
const SYNCED_HISTORY_LIMIT = 30;

/** Estados terminales que el usuario puede quitar de la cola. */
const REMOVABLE_STATUSES: readonly OfflineActionStatus[] = ["synced", "failed"];

// ── Ayudas puras ────────────────────────────────────────────────────────────

const OFFLINE_ACTION_KIND_LABELS: Record<OfflineActionKind, string> = {
  "event-task-toggle": "Checklist",
  "inventory-checkout": "Salida de equipos",
  "inventory-checkin": "Devolución de equipos",
};

export function offlineActionKindLabel(kind: string | null | undefined): string {
  return OFFLINE_ACTION_KIND_LABELS[kind as OfflineActionKind] ?? "Acción de campo";
}

const OFFLINE_ACTION_STATUS_LABELS: Record<OfflineActionStatus, string> = {
  pending: "Pendiente de subir",
  syncing: "Subiendo",
  synced: "Sincronizado",
  failed: "Falló",
};

export function offlineActionStatusLabel(status: string | null | undefined): string {
  return OFFLINE_ACTION_STATUS_LABELS[status as OfflineActionStatus] ?? "Sin estado";
}

/**
 * Clasifica la respuesta del panel. `duplicate` es el caso de idempotencia: la
 * acción ya estaba aplicada (respuesta perdida y reintento posterior) y el
 * servidor lo informa con 409; se cuenta como sincronizada, sin duplicar.
 */
export function classifySendOutcome(status: number, payload: unknown): { outcome: "synced" | "duplicate" | "failed"; error?: string } {
  const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
    ? String((payload as { error: string }).error)
    : "";
  if (status >= 200 && status < 300) return { outcome: "synced" };
  if (status === 409 && /ya est[áa] registrada/i.test(message)) return { outcome: "duplicate", error: message };
  return { outcome: "failed", error: message || `El panel respondió ${status}.` };
}

/** Un reclamo huérfano (pestaña cerrada durante el envío) vuelve a pendiente. */
export function normalizeStaleClaim(action: OfflineAction, now = Date.now()): OfflineAction {
  if (action.status !== "syncing") return action;
  const claimedAt = action.lastAttemptAt ? Date.parse(action.lastAttemptAt) : Number.NaN;
  if (Number.isFinite(claimedAt) && now - claimedAt <= CLAIM_STALE_MS) return action;
  return { ...action, status: "pending", error: null };
}

export function summarizeOfflineQueue(actions: readonly OfflineAction[]): OfflineQueueSummary {
  const summary: OfflineQueueSummary = { pending: 0, syncing: 0, synced: 0, failed: 0, toUpload: 0 };
  for (const action of actions) summary[action.status] += 1;
  summary.toUpload = summary.pending + summary.syncing;
  return summary;
}

export function canRemoveOfflineAction(action: OfflineAction): boolean {
  return REMOVABLE_STATUSES.includes(action.status);
}

/** Tarea del checklist con la acción más reciente en cola (o `null`). */
export function queuedActionForTask(actions: readonly OfflineAction[], taskId: string): OfflineAction | null {
  return latestQueuedAction(actions, (action) => action.kind === "event-task-toggle" && action.body.id === taskId);
}

/** Asignación de equipos con la acción de salida/devolución más reciente en cola. */
export function queuedActionForAssignment(actions: readonly OfflineAction[], assignmentId: string): OfflineAction | null {
  return latestQueuedAction(
    actions,
    (action) => (action.kind === "inventory-checkout" || action.kind === "inventory-checkin") && action.body.id === assignmentId,
  );
}

function latestQueuedAction(actions: readonly OfflineAction[], matches: (action: OfflineAction) => boolean): OfflineAction | null {
  let latest: OfflineAction | null = null;
  for (const action of actions) {
    if (action.status === "synced" || !matches(action)) continue;
    if (!latest || action.createdAt > latest.createdAt) latest = action;
  }
  return latest;
}

/** Orden de subida: el más viejo primero (respeta la secuencia de los toggles). */
export function sortOfflineActionsForFlush(actions: readonly OfflineAction[]): OfflineAction[] {
  return [...actions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ── Persistencia ────────────────────────────────────────────────────────────

let databasePromise: Promise<IDBDatabase | null> | null = null;

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `oa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

/** ¿Este navegador puede guardar la cola? (IndexedDB o localStorage). */
export function offlineQueueSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof indexedDB !== "undefined") return true;
  try {
    window.localStorage.setItem("ledbox-offline-probe", "1");
    window.localStorage.removeItem("ledbox-offline-probe");
    return true;
  } catch {
    return false;
  }
}

function readLocalStorage(): OfflineAction[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineAction[]) : [];
  } catch {
    return [];
  }
}

function writeLocalStorage(actions: OfflineAction[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // Sin espacio o modo privado: la acción queda solo en memoria de la pestaña.
  }
}

async function readStoredActions(): Promise<OfflineAction[]> {
  const database = await openDatabase();
  if (!database) return typeof window === "undefined" ? [] : readLocalStorage();
  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as OfflineAction[]) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function writeStoredAction(action: OfflineAction): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    const actions = readLocalStorage().filter((candidate) => candidate.id !== action.id);
    actions.push(action);
    writeLocalStorage(actions);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(action);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteStoredAction(id: string): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    writeLocalStorage(readLocalStorage().filter((action) => action.id !== id));
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteStoredActions(ids: readonly string[]): Promise<void> {
  for (const id of ids) await deleteStoredAction(id);
}

/**
 * Reclama una acción para enviarla: solo si sigue `pending` (transacción única
 * en IndexedDB). Dos pestañas que sincronizan a la vez no pueden enviar la misma.
 */
async function claimAction(id: string): Promise<OfflineAction | null> {
  const database = await openDatabase();
  if (!database) {
    const actions = readLocalStorage();
    const current = actions.find((action) => action.id === id);
    if (!current || current.status !== "pending") return null;
    const claimed: OfflineAction = {
      ...current,
      status: "syncing",
      attempts: current.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      error: null,
    };
    writeLocalStorage(actions.map((action) => (action.id === id ? claimed : action)));
    return claimed;
  }
  return new Promise((resolve) => {
    let claimed: OfflineAction | null = null;
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        const current = request.result as OfflineAction | undefined;
        if (!current || current.status !== "pending") return;
        const next: OfflineAction = {
          ...current,
          status: "syncing",
          attempts: current.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          error: null,
        };
        claimed = next;
        store.put(next);
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Deja el historial de sincronizadas corto para no crecer sin control en el equipo. */
async function pruneSyncedHistory(): Promise<void> {
  const actions = await readStoredActions();
  const synced = actions
    .filter((action) => action.status === "synced")
    .sort((a, b) => (b.syncedAt ?? b.createdAt).localeCompare(a.syncedAt ?? a.createdAt));
  if (synced.length <= SYNCED_HISTORY_LIMIT) return;
  await deleteStoredActions(synced.slice(SYNCED_HISTORY_LIMIT).map((action) => action.id));
}

// ── API de la cola ──────────────────────────────────────────────────────────

const listeners = new Set<(actions: OfflineAction[]) => void>();
let channel: BroadcastChannel | null = null;

function emit(actions: OfflineAction[]): void {
  mirrorQueueSummary(actions);
  for (const listener of listeners) listener(actions);
}

/**
 * Copia un resumen liviano a localStorage para `/offline.html`. Esa página no
 * puede abrir IndexedDB (crearía una versión sin el store de acciones y
 * rompería la cola), así que lee este espejo.
 */
function mirrorQueueSummary(actions: readonly OfflineAction[]): void {
  if (typeof window === "undefined") return;
  try {
    const summary = summarizeOfflineQueue(actions);
    window.localStorage.setItem(
      "ledbox-offline-mirror",
      JSON.stringify({ toUpload: summary.toUpload, failed: summary.failed, updatedAt: new Date().toISOString() }),
    );
  } catch {
    // Sin localStorage la página offline no muestra el resumen; la cola sigue intacta.
  }
}

function announceChange(): void {
  try {
    channel ??= typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BROADCAST_CHANNEL) : null;
    channel?.postMessage({ type: "ledbox-offline-changed" });
  } catch {
    // Sin BroadcastChannel la cola se refresca al volver a la pestaña.
  }
}

/** Escucha los cambios de la cola (misma pestaña y otras abiertas del panel). */
export function subscribeOfflineQueue(listener: (actions: OfflineAction[]) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    channel ??= typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BROADCAST_CHANNEL) : null;
    if (channel) {
      channel.onmessage = () => {
        void listOfflineActions().then(emit);
      };
    }
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.onmessage = null;
    }
  };
}

function handleStorage(event: StorageEvent): void {
  if (event.key && event.key !== STORAGE_KEY) return;
  void listOfflineActions().then(emit);
}

/** Acciones guardadas, normalizadas (reclamos huérfanos vuelven a pendiente). */
export async function listOfflineActions(): Promise<OfflineAction[]> {
  if (typeof window === "undefined") return [];
  const stored = await readStoredActions();
  const now = Date.now();
  const normalized = stored.map((action) => normalizeStaleClaim(action, now));
  const changed = normalized.filter((action, index) => action !== stored[index]);
  for (const action of changed) await writeStoredAction(action);
  return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function enqueueOfflineAction(input: OfflineActionInput): Promise<OfflineAction> {
  const action: OfflineAction = {
    ...input,
    id: createId(),
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    lastAttemptAt: null,
    syncedAt: null,
    error: null,
    confirmedDuplicate: false,
  };
  await writeStoredAction(action);
  await pruneSyncedHistory();
  announceChange();
  emit(await listOfflineActions());
  return action;
}

/** Reintenta una acción fallida (vuelve a pendiente y limpia el error). */
export async function retryOfflineAction(id: string): Promise<void> {
  const actions = await readStoredActions();
  const action = actions.find((candidate) => candidate.id === id);
  if (!action || action.status === "syncing") return;
  await writeStoredAction({ ...action, status: "pending", error: null });
  announceChange();
  emit(await listOfflineActions());
}

export async function removeOfflineAction(id: string): Promise<void> {
  await deleteStoredAction(id);
  announceChange();
  emit(await listOfflineActions());
}

export async function clearSyncedOfflineActions(): Promise<void> {
  const actions = await readStoredActions();
  await deleteStoredActions(actions.filter((action) => action.status === "synced").map((action) => action.id));
  announceChange();
  emit(await listOfflineActions());
}

let flushInFlight: Promise<FlushSummary> | null = null;

/**
 * Sube la cola en orden, de a una acción: reclama, envía, y marca el estado
 * real. Solo una sincronización por vez; si la conexión se corta, lo que queda
 * sigue pendiente para el próximo intento.
 */
export function flushOfflineQueue(send: OfflineSender): Promise<FlushSummary> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runFlush(send).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlush(send: OfflineSender): Promise<FlushSummary> {
  const summary: FlushSummary = { attempted: 0, synced: 0, duplicates: 0, failed: 0, offline: false };
  const queued = sortOfflineActionsForFlush(await listOfflineActions()).filter((action) => action.status === "pending");
  for (const action of queued) {
    const claimed = await claimAction(action.id);
    if (!claimed) continue; // otra pestaña ya la tomó
    summary.attempted += 1;
    emit(await listOfflineActions());

    const outcome = await send(claimed);
    if (outcome.kind === "offline") {
      // Sin conexión: vuelve a pendiente y se corta la sincronización.
      await writeStoredAction({ ...claimed, status: "pending" });
      summary.offline = true;
      break;
    }
    if (outcome.kind === "ok") {
      summary.synced += 1;
      await writeStoredAction({ ...claimed, status: "synced", syncedAt: new Date().toISOString(), error: null });
    } else if (outcome.kind === "duplicate") {
      summary.duplicates += 1;
      await writeStoredAction({
        ...claimed,
        status: "synced",
        syncedAt: new Date().toISOString(),
        error: null,
        confirmedDuplicate: true,
      });
    } else {
      summary.failed += 1;
      await writeStoredAction({ ...claimed, status: "failed", error: outcome.error });
    }
    announceChange();
    emit(await listOfflineActions());
  }
  await pruneSyncedHistory();
  return summary;
}
