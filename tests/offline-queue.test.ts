import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canRemoveOfflineAction,
  classifySendOutcome,
  normalizeStaleClaim,
  offlineActionKindLabel,
  offlineActionStatusLabel,
  queuedActionForAssignment,
  queuedActionForTask,
  sortOfflineActionsForFlush,
  summarizeOfflineQueue,
  type OfflineAction,
} from "../lib/offline-queue";

function action(overrides: Partial<OfflineAction> & Pick<OfflineAction, "id" | "kind" | "status">): OfflineAction {
  return {
    path: "/api/admin/event-ops",
    body: { kind: "toggle", id: "task_1", completed: true },
    summary: "Marcar cumplida",
    detail: "Evento: Lanzamiento",
    createdAt: "2026-09-21T12:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    syncedAt: null,
    error: null,
    confirmedDuplicate: false,
    ...overrides,
  };
}

test("idempotencia: una acción ya registrada se clasifica como duplicada, no como error", () => {
  assert.deepEqual(classifySendOutcome(200, { task: { id: "t1" } }), { outcome: "synced" });
  assert.deepEqual(classifySendOutcome(201, {}), { outcome: "synced" });
  assert.equal(classifySendOutcome(409, { error: "La salida ya está registrada para esta asignación." }).outcome, "duplicate");
  assert.equal(classifySendOutcome(409, { error: "La devolución ya está registrada para esta asignación." }).outcome, "duplicate");
});

test("un rechazo real queda fallido con el motivo del servidor", () => {
  assert.deepEqual(classifySendOutcome(400, { error: "Dañadas y faltantes no pueden superar las 2 unidades asignadas." }), {
    outcome: "failed",
    error: "Dañadas y faltantes no pueden superar las 2 unidades asignadas.",
  });
  assert.deepEqual(classifySendOutcome(409, { error: "Registrá primero la salida del equipo." }), {
    outcome: "failed",
    error: "Registrá primero la salida del equipo.",
  });
  assert.deepEqual(classifySendOutcome(500, {}), { outcome: "failed", error: "El panel respondió 500." });
});

test("reclamo huérfano: vuelve a pendiente solo si el envío quedó viejo", () => {
  const now = Date.parse("2026-09-21T12:10:00.000Z");
  const fresh = action({ id: "a", kind: "event-task-toggle", status: "syncing", lastAttemptAt: "2026-09-21T12:09:30.000Z" });
  assert.equal(normalizeStaleClaim(fresh, now).status, "syncing");
  const stale = action({ id: "b", kind: "event-task-toggle", status: "syncing", lastAttemptAt: "2026-09-21T12:08:30.000Z" });
  assert.deepEqual(
    { status: normalizeStaleClaim(stale, now).status, error: normalizeStaleClaim(stale, now).error },
    { status: "pending", error: null },
  );
  const lost = action({ id: "c", kind: "event-task-toggle", status: "syncing", lastAttemptAt: null });
  assert.equal(normalizeStaleClaim(lost, now).status, "pending");
  const synced = action({ id: "d", kind: "event-task-toggle", status: "synced" });
  assert.equal(normalizeStaleClaim(synced, now), synced);
});

test("resumen de la cola: pendientes + subiendo son lo que falta subir", () => {
  const summary = summarizeOfflineQueue([
    action({ id: "1", kind: "event-task-toggle", status: "pending" }),
    action({ id: "2", kind: "event-task-toggle", status: "syncing" }),
    action({ id: "3", kind: "event-task-toggle", status: "synced" }),
    action({ id: "4", kind: "event-task-toggle", status: "failed", error: "Sin permiso" }),
  ]);
  assert.deepEqual(summary, { pending: 1, syncing: 1, synced: 1, failed: 1, toUpload: 2 });
});

test("marcadores por fila: la acción en cola más nueva manda y lo sincronizado no marca", () => {
  const task = action({ id: "a", kind: "event-task-toggle", status: "pending", createdAt: "2026-09-21T12:00:00.000Z" });
  const newer = action({
    id: "b",
    kind: "event-task-toggle",
    status: "failed",
    createdAt: "2026-09-21T12:05:00.000Z",
    body: { kind: "toggle", id: "task_1", completed: false },
  });
  const synced = action({ id: "c", kind: "event-task-toggle", status: "synced", createdAt: "2026-09-21T12:06:00.000Z" });
  assert.equal(queuedActionForTask([task, synced], "task_1")?.id, "a");
  assert.equal(queuedActionForTask([task, newer, synced], "task_1")?.id, "b");
  assert.equal(queuedActionForTask([synced], "task_1"), null);
  assert.equal(queuedActionForTask([task], "task_2"), null);

  const checkout = action({
    id: "m1",
    kind: "inventory-checkout",
    status: "pending",
    path: "/api/admin/inventory",
    body: { kind: "checkout", id: "assign_1" },
  });
  assert.equal(queuedActionForAssignment([checkout, task], "assign_1")?.id, "m1");
  assert.equal(queuedActionForAssignment([checkout], "assign_2"), null);
});

test("la subida respeta el orden de creación", () => {
  const older = action({ id: "1", kind: "event-task-toggle", status: "pending", createdAt: "2026-09-21T12:00:00.000Z" });
  const middle = action({ id: "2", kind: "event-task-toggle", status: "pending", createdAt: "2026-09-21T12:03:00.000Z" });
  const newer = action({ id: "3", kind: "event-task-toggle", status: "pending", createdAt: "2026-09-21T12:01:00.000Z" });
  assert.deepEqual(
    sortOfflineActionsForFlush([older, middle, newer]).map((item) => item.id),
    ["1", "3", "2"],
  );
});

test("etiquetas y acciones quitables de la cola", () => {
  assert.equal(offlineActionKindLabel("inventory-checkout"), "Salida de equipos");
  assert.equal(offlineActionKindLabel("otro"), "Acción de campo");
  assert.equal(offlineActionStatusLabel("pending"), "Pendiente de subir");
  assert.equal(offlineActionStatusLabel("nada"), "Sin estado");
  assert.equal(canRemoveOfflineAction(action({ id: "1", kind: "event-task-toggle", status: "synced" })), true);
  assert.equal(canRemoveOfflineAction(action({ id: "2", kind: "event-task-toggle", status: "failed" })), true);
  assert.equal(canRemoveOfflineAction(action({ id: "3", kind: "event-task-toggle", status: "pending" })), false);
  assert.equal(canRemoveOfflineAction(action({ id: "4", kind: "event-task-toggle", status: "syncing" })), false);
});
