"use client";
import { useClientSelector } from "@/lib/admin-client-selector";

import { useId, useState } from "react";
import { adminSend } from "@/lib/admin-api";
import { canWriteOperations } from "@/lib/admin-policy";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import { useAdminSession } from "../AdminShell";
import type { AdminClientOption } from "@/lib/admin-types";
import { AdminButton, AdminDialog, AdminNote, AdminPlanLimitNote } from "../AdminUI";
import { Combobox } from "../AdminFields";
import { ClientQuickDialog } from "./ClientQuickForm";
import { EMPTY_EVENT_QUICK, EventQuickFields, eventQuickError, eventQuickPayload } from "./EventQuickForm";

/** Presupuestos reutiliza las altas de Operación, sin una segunda ficha mínima. */
export const ClientQuickCreateDialog = ClientQuickDialog;

export function EventQuickCreateDialog({ initialName, clientId, clients, clientsLoading, onClose, onCreated }: {
  initialName: string;
  clientId: string;
  clients: AdminClientOption[];
  clientsLoading: boolean;
  onClose: () => void;
  onCreated: (event: { id: string; name: string }, clientId: string) => void;
}) {
  const { role } = useAdminSession();
  const writable = canWriteOperations(role);
  const [formClientId, setFormClientId] = useState(clientId);
  const remoteClients = useClientSelector(formClientId);
  const [form, setForm] = useState({ ...EMPTY_EVENT_QUICK, name: initialName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [limitError, setLimitError] = useState("");
  const formId = useId();
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...EMPTY_EVENT_QUICK, name: initialName });
  const lockedClient = clientId ? clients.find((client) => client.id === clientId) : null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !writable) return;
    const invalid = !formClientId ? "Elegí el cliente del evento." : eventQuickError(form);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError("");
    setLimitError("");
    const result = await adminSend<{ event?: { id: string; name: string } }>("/api/admin/events", {
      ...eventQuickPayload(form),
      clientId: formClientId,
    });
    setBusy(false);
    if (!result.ok) {
      if (result.code === "plan_limit") setLimitError(result.error);
      else setError(result.error);
      return;
    }
    const created = result.data.event;
    if (!created?.id) {
      setError("El evento se guardó, pero no recibimos su id: recargá Eventos y elegilo de nuevo.");
      return;
    }
    onCreated(created, formClientId);
  }

  if (!writable) {
    return (
      <AdminDialog title="Crear evento" icon="events" size="sm" onClose={onClose} footer={<AdminButton icon="close" type="button" onClick={onClose}>Cerrar</AdminButton>}>
        <AdminNote>No tenés permiso para crear eventos.</AdminNote>
      </AdminDialog>
    );
  }

  return <AdminDialog
    title="Crear evento"
    icon="events"
    size="md"
    description="Queda elegido en el presupuesto. Los datos de operación son opcionales."
    error={error}
    dirty={dirty}
    onClose={onClose}
    footer={({ requestClose }) => <>
      <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>Cancelar</AdminButton>
      <AdminButton variant="primary" icon="check" type="submit" form={formId} busy={busy} busyLabel="Guardando…">Crear evento</AdminButton>
    </>}
  >
    <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
      <EventQuickFields values={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} autoFocus>
        {clientId ? <dl className="admin-dialog-facts"><div><dt>Cliente</dt><dd>{lockedClient ? clientDisplayName(lockedClient) : "El cliente del presupuesto"}</dd></div></dl> :
          <Combobox label="Cliente" onSearch={remoteClients.onSearch} required value={formClientId} onChange={setFormClientId}
            options={(remoteClients.data ?? clients).map((client) => ({ value: client.id, label: clientDisplayName(client), description: clientLegalName(client) ?? undefined }))}
            placeholder="Buscá por nombre o empresa…" emptyLabel={remoteClients.loading || clientsLoading ? "Cargando clientes…" : "Creá un cliente desde el campo Cliente del presupuesto."} />}
      </EventQuickFields>
      {limitError ? <AdminPlanLimitNote message={limitError} /> : null}
    </form>
  </AdminDialog>;
}
