"use client";

import { useId, useState } from "react";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/admin-format";
import type { AdminTone } from "@/lib/admin-format";
import type { AdminInventoryIncident } from "@/lib/admin-types";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { MoneyField, TextAreaField } from "../AdminFields";
import { UNIDENTIFIED_UNIT_LABEL, isUnidentifiedUnitIncident } from "@/lib/inventory-incident-label";
import { AdminBadge, AdminButton, AdminCell, AdminDataState, AdminDialog, AdminDialogSection, AdminNote, AdminRow, AdminSelect, AdminTable } from "../AdminUI";

const KIND_LABEL: Record<AdminInventoryIncident["kind"], string> = {
  DAMAGE: "Daño",
  MISSING: "Faltante",
  REPAIR: "Reparación",
  CLEANING: "Limpieza",
};

const STATUS_LABEL: Record<AdminInventoryIncident["status"], string> = {
  OPEN: "Abierto",
  IN_REPAIR: "En reparación",
  RESOLVED: "Resuelto",
  WRITTEN_OFF: "Dado de baja",
};

const STATUS_TONE: Record<AdminInventoryIncident["status"], AdminTone> = {
  OPEN: "danger",
  IN_REPAIR: "warn",
  RESOLVED: "ok",
  WRITTEN_OFF: "neutral",
};

const FILTERS = [
  { value: "open", label: "Abiertos y en reparación" },
  { value: "closed", label: "Cerrados" },
  { value: "all", label: "Todos" },
];

type Action = { incident: AdminInventoryIncident; to: "IN_REPAIR" | "RESOLVED" | "WRITTEN_OFF" };

const ACTION_COPY = {
  IN_REPAIR: { title: "Enviar a reparación", submit: "A reparación", help: "La unidad o cantidad sigue fuera de lo libre mientras se repara." },
  RESOLVED: { title: "Marcar como resuelto", submit: "Resuelto", help: "La unidad o cantidad vuelve a estar libre para alquilar." },
  WRITTEN_OFF: { title: "Dar de baja", submit: "Dar de baja", help: "No vuelve a estar libre: la unidad queda retirada (o perdida) y la cantidad sale del ítem." },
} as const;

function ActionDialog({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: (message: string) => void }) {
  const formId = useId();
  const copy = ACTION_COPY[action.to];
  const [cost, setCost] = useState(action.incident.cost == null ? "" : String(action.incident.cost));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await adminSend("/api/admin/inventory/incidents", {
      kind: "transition",
      id: action.incident.id,
      to: action.to,
      cost: cost === "" ? undefined : Number(cost.replace(/\D/g, "")),
      notes: notes || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(`${copy.title}: ${action.incident.inventory.name}${action.incident.unit ? ` (${action.incident.unit.code})` : ""}.`);
  }

  return (
    <AdminDialog
      title={`${copy.title} · ${action.incident.inventory.name}`}
      icon="inventory"
      description={copy.help}
      size="sm"
      dirty={notes !== ""}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" onClick={requestClose}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Guardando…">
            {copy.submit}
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={submit} aria-busy={busy || undefined}>
        <AdminDialogSection title="Resolución">
          <MoneyField label="Costo de reparación o reposición" hint="Opcional. En guaraníes." value={cost} onChange={setCost} />
          <TextAreaField label="Notas" wide rows={2} maxLength={400} value={notes} onChange={setNotes} hint="Qué se hizo o por qué (opcional)" />
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}

/**
 * Lista de incidentes de inventario con sus acciones (A reparación, Resuelto, Dar de
 * baja). La usan la ficha del evento (`eventId`), la ficha del producto (`inventoryId`) y el diálogo del módulo de inventario (todos).
 */
export function InventoryIncidentsPanel({
  eventId,
  inventoryId,
  writable,
  reloadKey = 0,
  onChanged,
}: {
  eventId?: string;
  /** Solo los incidentes de este producto (ficha del inventario). */
  inventoryId?: string;
  writable: boolean;
  reloadKey?: number;
  onChanged?: () => void;
}) {
  const [filter, setFilter] = useState("open");
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState("");
  const query = `status=${filter}${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ""}${inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : ""}&r=${reloadKey}`;
  const resource = useAdminResource(
    `/api/admin/inventory/incidents?${query}`,
    (payload) => (payload as { incidents?: AdminInventoryIncident[] }).incidents ?? [],
  );
  const incidents = resource.data ?? [];

  return (
    <div className="admin-incidents">
      <div className="admin-toolbar">
        <AdminSelect value={filter} onChange={setFilter} label="Filtrar incidentes" options={FILTERS} />
      </div>
      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      <AdminDataState
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
        empty={incidents.length === 0}
        emptyTitle={filter === "open" ? "Sin incidentes abiertos" : "Sin incidentes"}
        emptyIcon="inventory"
        emptyHint="Los daños y faltantes se registran al devolver los equipos del evento."
        rows={3}
      >
        <AdminTable
          view="inventario-incidentes"
          label="Incidentes de inventario"
          columns={[
            { label: "Artículo" },
            { label: "Tipo" },
            { label: "Cant.", end: true },
            { label: "Estado" },
            { label: "Costo", end: true },
            { label: "Evento" },
            { label: "Abierto" },
            { label: "Acciones", end: true },
          ]}
        >
          {incidents.map((incident) => {
            const open = incident.status === "OPEN" || incident.status === "IN_REPAIR";
            const label = `${incident.inventory.name}${incident.unit ? ` (${incident.unit.code})` : ""}`;
            return (
              <AdminRow key={incident.id}>
                <AdminCell title={label}>
                  <strong>{incident.inventory.name}</strong>
                  {incident.unit ? <span className="admin-code"> · {incident.unit.code}</span> : null}
                  {isUnidentifiedUnitIncident(incident) ? (
                    <>
                      {" "}
                      <AdminBadge tone="warn" title="El incidente se registró por cantidad: falta identificar qué unidad es.">{UNIDENTIFIED_UNIT_LABEL}</AdminBadge>
                    </>
                  ) : null}
                </AdminCell>
                <AdminCell>{KIND_LABEL[incident.kind]}</AdminCell>
                <AdminCell end>{formatNumber(incident.quantity)}</AdminCell>
                <AdminCell title={incident.notes ?? undefined}>
                  <AdminBadge tone={STATUS_TONE[incident.status]}>{STATUS_LABEL[incident.status]}</AdminBadge>
                </AdminCell>
                <AdminCell end>{incident.cost == null ? "—" : formatMoney(incident.cost)}</AdminCell>
                <AdminCell>{incident.event?.name ?? "—"}</AdminCell>
                <AdminCell title={incident.resolvedAt ? `Cerrado: ${formatDateTime(incident.resolvedAt)}` : undefined}>{formatDateTime(incident.openedAt)}</AdminCell>
                <AdminCell end className="admin-cell--actions">
                  {writable && open ? (
                    <span className="admin-actions">
                      {incident.status === "OPEN" && incident.kind !== "MISSING" ? (
                        <AdminButton aria-label={`Enviar a reparación: ${label}`} onClick={() => setAction({ incident, to: "IN_REPAIR" })}>
                          A reparación
                        </AdminButton>
                      ) : null}
                      <AdminButton aria-label={`Marcar como resuelto: ${label}`} onClick={() => setAction({ incident, to: "RESOLVED" })}>
                        Resuelto
                      </AdminButton>
                      <AdminButton aria-label={`Dar de baja: ${label}`} onClick={() => setAction({ incident, to: "WRITTEN_OFF" })}>
                        Dar de baja
                      </AdminButton>
                    </span>
                  ) : (
                    <span className="admin-muted">—</span>
                  )}
                </AdminCell>
              </AdminRow>
            );
          })}
        </AdminTable>
      </AdminDataState>
      {action ? (
        <ActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null);
            setNotice(message);
            resource.reload();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}

/** Diálogo con todos los incidentes de la empresa (módulo de inventario). */
export function InventoryIncidentsDialog({ writable, onClose, onChanged }: { writable: boolean; onClose: () => void; onChanged?: () => void }) {
  return (
    <AdminDialog title="Incidentes de inventario" size="wide" icon="inventory" description="Daños, faltantes y reparaciones. Lo dañado no vuelve a estar libre hasta resolver el incidente." onClose={onClose}>
      <InventoryIncidentsPanel writable={writable} onChanged={onChanged} />
    </AdminDialog>
  );
}
