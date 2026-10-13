"use client";

import { useId, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import {
  PURGE_REASON_MAX,
  TRASH_ENTITIES,
  canConfirmPurge,
  canOfferAnonymize,
  formatBlockers,
  trashActionPath,
  trashMenuEntries,
  type TrashMenuEntry,
  type TrashAction,
  type TrashBlocker,
  type TrashEntityType,
} from "@/lib/trash-shared";
import { TextAreaField, TextField } from "./AdminFields";
import { AdminButton, AdminDialog, AdminNote, type AdminMenuItem } from "./AdminUI";

/**
 * Papelera, interfaz compartida (docs/PAPELERA.md §UI): el diálogo de eliminar y de
 * borrado definitivo, el aviso de bloqueos y las entradas del menú «•••» que usan
 * Eventos, Inventario y Ajustes → Eliminados. Una sola implementación por tipo de aviso.
 */

/** Llama a `POST <apiBase>/<id>/<action>` de la entidad. */
export function runTrashAction(type: TrashEntityType, id: string, action: TrashAction, body: Record<string, unknown> = {}) {
  return adminSend(trashActionPath(type, id, action), body);
}

/** Aviso concreto de los bloqueos (un renglón por tipo), el mismo en fichas, listas y diálogos. */
export function TrashBlockersNote({ blockers, title }: { blockers: readonly TrashBlocker[]; title?: string }) {
  if (blockers.length === 0) return null;
  return (
    <div className="admin-trash-blockers" role="alert">
      {title ? <strong>{title}</strong> : null}
      <ul>
        {formatBlockers(blockers).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Entradas Archivar / Desarchivar / Eliminar del «•••». Vacío sin permiso de escritura;
 * «Eliminar» en lo activo queda deshabilitado con el aviso «Archivalo primero».
 */
export function trashMenuItems(input: {
  type: TrashEntityType;
  name: string;
  archived: boolean;
  canWrite: boolean;
  archiveBlockedReason?: string | null;
  /** Limita las entradas (p. ej. Inventario ya tiene su propio «Archivar»). */
  only?: readonly TrashMenuEntry["key"][];
  busy?: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
  onTrash: () => void;
}): AdminMenuItem[] {
  return trashMenuEntries(input).filter((entry) => !input.only || input.only.includes(entry.key)).map((entry) => ({
    label: entry.label,
    icon: entry.icon,
    title: entry.title,
    disabled: entry.disabled || input.busy,
    onClick: entry.key === "archive" ? input.onArchive : entry.key === "unarchive" ? input.onUnarchive : input.onTrash,
  }));
}

export type TrashDialogMode = "trash" | "purge" | "anonymize";

/**
 * - `trash`: manda a la papelera (motivo opcional); si el servidor bloquea, lista los bloqueos.
 * - `purge`: borrado definitivo; pide el nombre exacto y un motivo (≤200). Con bloqueos contables
 *   (409) lista cada uno y, si el tipo lo permite, ofrece anonimizar.
 * - `anonymize`: igual que `purge` pero conserva el historial contable.
 */
export function TrashDialog({
  mode: initialMode,
  type,
  id,
  name,
  initialBlockers,
  onClose,
  onDone,
}: {
  mode: TrashDialogMode;
  type: TrashEntityType;
  id: string;
  name: string;
  /** Bloqueos ya conocidos (los trae la lista de Eliminados). */
  initialBlockers?: readonly TrashBlocker[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<TrashDialogMode>(initialMode);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState<readonly TrashBlocker[]>(initialBlockers ?? []);
  const formId = useId();
  const entity = TRASH_ENTITIES[type];
  const definitive = mode !== "trash";
  const ready = definitive ? canConfirmPurge(typed, name, reason) : reason.trim().length <= PURGE_REASON_MAX;
  // En «trash» los bloqueos son del servidor; en «purge» permiten pasar a anonimizar.
  const offerAnonymize = mode === "purge" && blockers.length > 0 && canOfferAnonymize(type, blockers);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const body = definitive ? { confirmName: typed.trim(), reason: reason.trim() } : { reason: reason.trim() || undefined };
    const action: TrashAction = mode === "trash" ? "trash" : mode === "purge" ? "purge" : "anonymize";
    const result = await runTrashAction(type, id, action, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setBlockers(result.blockers ?? []);
      return;
    }
    onDone(
      mode === "trash"
        ? `${capital(entity.label)} «${name}» está en la papelera. Podés restaurar desde Ajustes → Eliminados.`
        : mode === "purge"
          ? `${capital(entity.label)} «${name}» se eliminó definitivamente.`
          : `${capital(entity.label)} «${name}» se anonimizó: se conserva el historial contable.`,
    );
  }

  const title = mode === "trash" ? `Eliminar ${entity.label}` : mode === "purge" ? "Eliminar definitivamente" : "Anonimizar";
  const description =
    mode === "trash"
      ? `«${name}» sale de todas las listas y va a la papelera.`
      : mode === "purge"
        ? `«${name}» se borra para siempre. No se puede deshacer.`
        : `«${name}» conserva su historial contable pero pierde los datos personales. No se puede deshacer.`;

  return (
    <AdminDialog
      title={title}
      icon="trash"
      description={description}
      dirty={typed.length > 0 || reason.length > 0}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          {error ? (
            <div className="admin-dialog-footer-note">
              <AdminNote tone="error">{error}</AdminNote>
            </div>
          ) : null}
          <AdminButton type="button" icon="close" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          {offerAnonymize ? (
            <AdminButton type="button" icon="user" disabled={busy} onClick={() => { setMode("anonymize"); setError(""); }}>
              Anonimizar en su lugar
            </AdminButton>
          ) : null}
          <AdminButton
            variant="primary"
            icon="trash"
            type="submit"
            form={formId}
            busy={busy}
            disabled={!ready || (mode === "purge" && blockers.length > 0)}
            title={definitive && !ready ? "Escribí el nombre exacto y el motivo para habilitar el botón" : undefined}
          >
            {mode === "trash" ? "Enviar a la papelera" : mode === "purge" ? "Eliminar definitivamente" : "Anonimizar"}
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
        <TrashBlockersNote
          blockers={blockers}
          title={mode === "trash" ? `No se puede eliminar ${entity.demonstrative}` : `No se puede eliminar definitivamente ${entity.demonstrative}`}
        />
        {blockers.length > 0 && mode === "purge" && !offerAnonymize ? (
          <AdminNote tone="warn">Mientras tenga estos registros se conserva en la papelera.</AdminNote>
        ) : null}
        {offerAnonymize ? (
          <AdminNote tone="warn">Podés anonimizarlo: se borran los datos personales y se conserva el historial contable.</AdminNote>
        ) : null}
        {definitive ? (
          <TextField
            label={`Escribí el nombre para confirmar: ${name}`}
            value={typed}
            onChange={setTyped}
            autoFocus
            autoComplete="off"
            required
            hint="Sin distinguir mayúsculas ni tildes."
          />
        ) : null}
        <TextAreaField
          label="Motivo"
          optional={!definitive}
          required={definitive}
          value={reason}
          onChange={setReason}
          maxLength={PURGE_REASON_MAX}
          rows={2}
          hint={`${reason.length}/${PURGE_REASON_MAX}`}
        />
      </form>
    </AdminDialog>
  );
}

function capital(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Flujo completo de archivar / desarchivar / eliminar de un módulo (Clientes, Leads,
 * Proveedores, Promotoras, Presupuestos): arma las entradas del «•••», corre la acción,
 * muestra el aviso y monta el diálogo de eliminar. El módulo solo pasa `onChanged` (recarga).
 */
export function useTrashFlow(type: TrashEntityType, options: { onChanged: () => void; onTrashed?: (id: string) => void }) {
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const entity = TRASH_ENTITIES[type];

  async function toggleArchive(id: string, name: string, restore: boolean) {
    if (busyId) return;
    setBusyId(id);
    setFeedback(null);
    const result = await runTrashAction(type, id, restore ? "unarchive" : "archive");
    setBusyId("");
    if (!result.ok) {
      setFeedback({ tone: "error", text: result.error });
      return;
    }
    setFeedback({ tone: "ok", text: restore ? `«${name}» desarchivado.` : `«${name}» archivado. Lo ves con el filtro de archivados.` });
    options.onChanged();
  }

  function menu(row: { id: string; name: string; archived: boolean; canWrite: boolean; archiveBlockedReason?: string | null }): AdminMenuItem[] {
    return trashMenuItems({
      type,
      name: row.name,
      archived: row.archived,
      canWrite: row.canWrite,
      archiveBlockedReason: row.archiveBlockedReason,
      busy: Boolean(busyId),
      onArchive: () => void toggleArchive(row.id, row.name, false),
      onUnarchive: () => void toggleArchive(row.id, row.name, true),
      onTrash: () => setTarget({ id: row.id, name: row.name }),
    });
  }

  const dialog = target ? (
    <TrashDialog
      mode="trash"
      type={type}
      id={target.id}
      name={target.name}
      onClose={() => setTarget(null)}
      onDone={(message) => {
        const id = target.id;
        setTarget(null);
        setFeedback({ tone: "ok", text: message });
        options.onTrashed?.(id);
        options.onChanged();
      }}
    />
  ) : null;
  const note = feedback ? <AdminNote tone={feedback.tone}>{feedback.text}</AdminNote> : null;
  return { menu, dialog, note, entity };
}
