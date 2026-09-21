"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { clearAdminApiCache, redirectToLogin } from "@/lib/admin-api";
import { formatNumber, formatSince, type AdminTone } from "@/lib/admin-format";
import {
  canRemoveOfflineAction,
  classifySendOutcome,
  clearSyncedOfflineActions,
  enqueueOfflineAction,
  flushOfflineQueue,
  listOfflineActions,
  offlineActionKindLabel,
  offlineActionStatusLabel,
  offlineQueueSupported,
  removeOfflineAction,
  retryOfflineAction,
  subscribeOfflineQueue,
  summarizeOfflineQueue,
  type OfflineAction,
  type OfflineActionInput,
  type OfflineActionStatus,
  type OfflineSendOutcome,
} from "@/lib/offline-queue";
import { AdminIcon } from "./AdminIcons";
import { AdminBadge, AdminButton, AdminEmpty, AdminNote } from "./AdminUI";

/**
 * Trabajo de campo offline (issue #23).
 *
 * El shell del panel monta este provider: registra el service worker, escucha
 * la conexión y expone la cola local. Con conexión nada cambia (las acciones
 * salen por el mismo endpoint); sin conexión la acción se guarda en el equipo y
 * se sube al recuperar señal, con estado honesto en todo momento.
 */

const SEND_TIMEOUT_MS = 20_000;
const DETAIL_LIMIT = 25;

export type FieldActionResult = { ok: true; queued: boolean; action?: OfflineAction } | { ok: false; error: string };

type OfflineQueueState = {
  /** El navegador puede guardar acciones locales (IndexedDB o localStorage). */
  supported: boolean;
  /** Hay conexión declarada por el navegador y el panel respondió la última vez. */
  online: boolean;
  actions: OfflineAction[];
  syncing: boolean;
  /** Se sincronizó algo en esta sesión: el indicador muestra la constancia. */
  recentlySynced: boolean;
  syncNow: () => Promise<void>;
  retryAction: (id: string) => Promise<void>;
  dismissAction: (id: string) => Promise<void>;
  clearSynced: () => Promise<void>;
  /**
   * Ejecuta una acción de campo: con conexión va al API (igual que siempre);
   * sin conexión queda en la cola local para subir al recuperar señal.
   */
  fieldAction: (input: OfflineActionInput) => Promise<FieldActionResult>;
};

const OfflineQueueContext = createContext<OfflineQueueState>({
  supported: false,
  online: true,
  actions: [],
  syncing: false,
  recentlySynced: false,
  syncNow: async () => {},
  retryAction: async () => {},
  dismissAction: async () => {},
  clearSynced: async () => {},
  fieldAction: async () => ({ ok: false, error: "La cola offline no está disponible." }),
});

export function useOfflineQueue(): OfflineQueueState {
  return useContext(OfflineQueueContext);
}

/** Transporte único de las acciones de campo: clasifica red caída vs. rechazo real. */
async function sendFieldAction(path: string, body: unknown): Promise<OfflineSendOutcome> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
      return { kind: "rejected", error: "La sesión venció. Volvé a iniciar sesión." };
    }
    const verdict = classifySendOutcome(response.status, payload);
    if (verdict.outcome === "synced") return { kind: "ok" };
    if (verdict.outcome === "duplicate") return { kind: "duplicate", message: verdict.error ?? "" };
    return { kind: "rejected", error: verdict.error ?? "No pudimos guardar la acción." };
  } catch {
    return { kind: "offline" };
  } finally {
    window.clearTimeout(timer);
  }
}

export function AdminOfflineProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<OfflineAction[]>([]);
  const [supported, setSupported] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showSyncedHistory, setShowSyncedHistory] = useState(false);
  const syncingRef = useRef(false);
  const toUpload = useMemo(() => summarizeOfflineQueue(actions).toUpload, [actions]);

  const refresh = useCallback(async () => {
    setActions(await listOfflineActions());
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const summary = await flushOfflineQueue(async (action) => {
        const outcome = await sendFieldAction(action.path, action.body);
        setReachable(outcome.kind !== "offline");
        return outcome;
      });
      if (summary.synced + summary.duplicates > 0) setShowSyncedHistory(true);
      if (typeof navigator !== "undefined") setBrowserOnline(navigator.onLine);
      await refresh();
      // Las acciones sincronizadas cambian datos del panel: la próxima lectura va a la red.
      clearAdminApiCache();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refresh]);

  const fieldAction = useCallback(
    async (input: OfflineActionInput): Promise<FieldActionResult> => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const action = await enqueueOfflineAction(input);
        await refresh();
        return { ok: true, queued: true, action };
      }
      const outcome = await sendFieldAction(input.path, input.body);
      if (outcome.kind === "offline") {
        setReachable(false);
        const action = await enqueueOfflineAction(input);
        await refresh();
        return { ok: true, queued: true, action };
      }
      if (outcome.kind === "ok" || outcome.kind === "duplicate") {
        setReachable(true);
        clearAdminApiCache();
        // Si había acciones esperando, este es un buen momento para subirlas.
        void syncNow();
        return { ok: true, queued: false };
      }
      return { ok: false, error: outcome.error };
    },
    [refresh, syncNow],
  );

  // Service worker del panel: shell cacheado y navegación offline honesta.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Sin service worker el panel sigue online; el aviso offline no aplica.
    });
  }, []);

  useEffect(() => {
    setSupported(offlineQueueSupported());
    setBrowserOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    void refresh();
    const unsubscribe = subscribeOfflineQueue(setActions);
    return unsubscribe;
  }, [refresh]);

  useEffect(() => {
    function handleOnline() {
      setBrowserOnline(true);
      setReachable(true);
      void syncNow();
    }
    function handleOffline() {
      setBrowserOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncNow]);

  // Al abrir el panel con acciones viejas sin subir, se intenta sincronizar.
  useEffect(() => {
    if (!browserOnline || syncing || toUpload === 0) return;
    void syncNow();
  }, [browserOnline, syncing, toUpload, syncNow]);

  const value = useMemo<OfflineQueueState>(
    () => ({
      supported,
      online: browserOnline && reachable,
      actions,
      syncing,
      recentlySynced: showSyncedHistory,
      syncNow,
      retryAction: async (id) => {
        await retryOfflineAction(id);
        await refresh();
      },
      dismissAction: async (id) => {
        await removeOfflineAction(id);
        await refresh();
      },
      clearSynced: async () => {
        await clearSyncedOfflineActions();
        setShowSyncedHistory(false);
        await refresh();
      },
      fieldAction,
    }),
    [supported, browserOnline, reachable, actions, syncing, showSyncedHistory, syncNow, refresh, fieldAction],
  );

  return <OfflineQueueContext.Provider value={value}>{children}</OfflineQueueContext.Provider>;
}

// ── Indicador del shell ─────────────────────────────────────────────────────

const STATUS_TONES: Record<OfflineActionStatus, AdminTone> = {
  pending: "warn",
  syncing: "info",
  synced: "ok",
  failed: "danger",
};

function queueHeadline(toUpload: number, failed: number): string {
  const parts: string[] = [];
  if (toUpload > 0) parts.push(`${formatNumber(toUpload)} sin subir`);
  if (failed > 0) parts.push(`${formatNumber(failed)} fallida${failed === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "Al día";
}

function OfflineActionRow({ action }: { action: OfflineAction }) {
  const { retryAction, dismissAction } = useOfflineQueue();
  const when = `${formatSince(action.createdAt)}${action.syncedAt ? ` · subida ${formatSince(action.syncedAt)}` : ""}`;
  const detail = action.status === "failed" && action.error ? action.error : action.detail;
  return (
    <li className="admin-offline-item" data-status={action.status}>
      <div className="admin-offline-item-head">
        <AdminBadge tone={STATUS_TONES[action.status]}>{offlineActionStatusLabel(action.status)}</AdminBadge>
        <span className="admin-offline-kind">{offlineActionKindLabel(action.kind)}</span>
        <span className="admin-offline-when" title={when}>
          {when}
        </span>
      </div>
      <p className="admin-offline-summary" title={action.summary}>
        {action.summary}
      </p>
      {detail ? (
        <p className="admin-offline-detail" data-tone={action.status === "failed" ? "error" : undefined} title={detail}>
          {action.status === "failed" ? <AdminIcon name="alert" size={12} /> : null}
          <span>{detail}</span>
        </p>
      ) : null}
      {action.confirmedDuplicate ? (
        <p className="admin-offline-detail">El servidor ya la tenía registrada: no se duplicó.</p>
      ) : null}
      {action.attempts > 1 && action.status === "pending" ? (
        <p className="admin-offline-detail">
          {formatNumber(action.attempts)} intentos sin conexión · se reintenta al volver la señal.
        </p>
      ) : null}
      {canRemoveOfflineAction(action) ? (
        <div className="admin-offline-item-actions">
          {action.status === "failed" ? (
            <AdminButton icon="refresh" onClick={() => void retryAction(action.id)} title="Volver a subir esta acción">
              Reintentar
            </AdminButton>
          ) : null}
          <AdminButton
            icon="close"
            onClick={() => void dismissAction(action.id)}
            title="Quitar esta acción del historial local"
            aria-label="Quitar de la cola"
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Chip del topbar con el estado de sincronización y el detalle de cada acción.
 * Sin acciones en cola y con conexión no dibuja nada: el panel online queda igual.
 */
export function AdminOfflineIndicator() {
  const { supported, online, actions, syncing, recentlySynced, syncNow, clearSynced } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const summary = useMemo(() => summarizeOfflineQueue(actions), [actions]);
  const visible =
    supported && (summary.toUpload > 0 || summary.failed > 0 || !online || (recentlySynced && summary.synced > 0));

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function closeOnOutside(event: PointerEvent) {
      const node = wrapRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open]);

  if (!visible) return null;

  const queued = summary.toUpload + summary.failed;

  async function sync() {
    setNote("");
    const before = summarizeOfflineQueue(actions).toUpload;
    await syncNow();
    const after = summarizeOfflineQueue(await listOfflineActions()).toUpload;
    const uploaded = Math.max(0, before - after);
    setNote(
      uploaded > 0
        ? `${formatNumber(uploaded)} acción${uploaded === 1 ? "" : "es"} confirmada${uploaded === 1 ? "" : "s"} por el servidor.`
        : "Nada para subir.",
    );
  }

  return (
    <div className="admin-offline" ref={wrapRef}>
      <button
        type="button"
        className="admin-iconbtn admin-offline-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Sincronización de campo: ${queueHeadline(summary.toUpload, summary.failed)}`}
        aria-expanded={open}
        aria-controls="admin-offline-panel"
        title="Sincronización de campo"
      >
        <AdminIcon name={online ? "refresh" : "alert"} size={16} />
        {queued > 0 ? (
          <span className="admin-offline-count" data-tone={summary.failed > 0 ? "danger" : undefined} aria-hidden="true">
            {queued > 99 ? "99+" : formatNumber(queued)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="admin-offline-panel" id="admin-offline-panel" role="region" aria-label="Sincronización de campo">
          <header className="admin-offline-head">
            <strong>Sincronización</strong>
            <span className="admin-offline-total">{queueHeadline(summary.toUpload, summary.failed)}</span>
          </header>

          <p className="admin-offline-connection" data-online={online ? "true" : "false"}>
            <AdminIcon name={online ? "check" : "alert"} size={12} />
            <span>
              {online
                ? "Con conexión: las acciones se envían al panel y las pendientes se suben solas."
                : supported
                  ? "Sin conexión: las acciones de campo se guardan en este equipo y se suben al volver la señal."
                  : "Sin conexión y este navegador no puede guardar acciones locales: no vas a poder marcar campo hasta recuperar señal."}
            </span>
          </p>

          {actions.length === 0 ? (
            <AdminEmpty icon="check" title="Sin acciones en cola" hint="El checklist y los equipos están al día con el servidor." />
          ) : (
            <ul className="admin-offline-list">
              {actions.slice(0, DETAIL_LIMIT).map((action) => (
                <OfflineActionRow key={action.id} action={action} />
              ))}
            </ul>
          )}

          {actions.length > DETAIL_LIMIT ? (
            <p className="admin-offline-note">Mostrando las últimas {formatNumber(DETAIL_LIMIT)} acciones de la cola local.</p>
          ) : null}

          {note ? <AdminNote tone="ok">{note}</AdminNote> : null}

          <footer className="admin-offline-foot">
            <AdminButton
              variant="primary"
              icon="refresh"
              busy={syncing}
              disabled={!online || summary.toUpload === 0}
              onClick={() => void sync()}
              title={online ? "Subir ahora las acciones pendientes" : "Sin conexión: no hay a dónde subir"}
            >
              Sincronizar ahora
            </AdminButton>
            {summary.synced > 0 ? (
              <AdminButton icon="close" onClick={() => void clearSynced()} title="Quitar del historial las acciones ya sincronizadas">
                Limpiar sincronizadas
              </AdminButton>
            ) : null}
          </footer>

          <p className="admin-offline-note">
            Cada acción se sube una sola vez: si el POST ya había llegado, el servidor lo confirma y no se duplica.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Aviso persistente del shell cuando no hay conexión o quedan acciones sin subir. */
export function AdminOfflineBanner() {
  const { supported, online, actions, syncing, syncNow } = useOfflineQueue();
  const summary = useMemo(() => summarizeOfflineQueue(actions), [actions]);
  const offline = !online;
  if (!offline && summary.toUpload === 0 && summary.failed === 0) return null;

  const headline = offline ? "Sin conexión" : summary.failed > 0 ? "Acciones de campo fallidas" : "Acciones sin subir";
  const message = offline
    ? supported
      ? `Las acciones de campo se guardan en este equipo (${formatNumber(summary.toUpload)} sin subir). Se suben solas al volver la señal.`
      : "Este equipo no puede guardar acciones locales: no marques campo hasta recuperar señal."
    : summary.failed > 0
      ? `${formatNumber(summary.failed)} acción${summary.failed === 1 ? "" : "es"} necesitan revisión antes de subir.`
      : `Quedan ${formatNumber(summary.toUpload)} acciones de campo por subir.`;

  return (
    <div className="admin-offline-banner" data-tone={offline ? "warn" : summary.failed > 0 ? "danger" : "info"} role="status">
      <AdminIcon name={offline ? "alert" : summary.failed > 0 ? "alert" : "refresh"} size={15} />
      <p className="admin-offline-banner-text">
        <strong>{headline}</strong>
        <span>{message}</span>
      </p>
      <AdminButton
        icon="refresh"
        busy={syncing}
        disabled={offline || summary.toUpload === 0}
        onClick={() => void syncNow()}
        title={offline ? "Sin conexión: se reintenta automáticamente al volver la señal" : "Subir las acciones pendientes"}
      >
        Sincronizar ahora
      </AdminButton>
    </div>
  );
}
