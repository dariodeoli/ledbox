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

type UnitTrace = {
  unit: { id: string; code: string; status: string; inventory: { id: string; name: string; sku: string | null } };
  incidents: AdminInventoryIncident[];
  history: Array<{ incidentId: string; action: string; actorName: string | null; summary: string; occurredAt: string }>;
};

function UnitTraceDialog({ unitId, onClose }: { unitId: string; onClose: () => void }) {
  const resource = useAdminResource(
    `/api/admin/inventory/incidents?unitTrace=${encodeURIComponent(unitId)}`,
    (payload) => payload as unknown as UnitTrace,
  );
  const trace = resource.data;

  return (
    <AdminDialog
      title={trace ? `Historial · ${trace.unit.code}` : "Historial de unidad"}
      icon="inventory"
      size="lg"
      description={trace ? `${trace.unit.inventory.name}${trace.unit.inventory.sku ? ` · ${trace.unit.inventory.sku}` : ""} · Estado actual: ${trace.unit.status}` : "Trazabilidad de daños y reparaciones de esta unidad."}
      onClose={onClose}
    >
      <AdminDataState
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
        empty={!trace || trace.history.length === 0}
        emptyTitle="Sin movimientos registrados"
        emptyIcon="inventory"
        emptyHint="Los cambios futuros de esta unidad aparecerán aquí con fecha y responsable."
        rows={3}
      >
        {trace ? (
          <div className="admin-form">
            <AdminDialogSection title="Incidentes de la unidad">
              {trace.incidents.map((incident) => (
                <AdminNote key={incident.id}>
                  <strong>{KIND_LABEL[incident.kind]} · {STATUS_LABEL[incident.status]}</strong>
                  {` · ${formatDateTime(incident.openedAt)}`}
                  {incident.resolvedAt ? ` · cierre ${formatDateTime(incident.resolvedAt)}` : ""}
                  {incident.cost != null ? ` · ${formatMoney(incident.cost)}` : ""}
                  {incident.notes ? <><br />{incident.notes}</> : null}
                </AdminNote>
              ))}
            </AdminDialogSection>
            <AdminDialogSection title="Cronología auditada">
              <ol className="admin-timeline" aria-label={`Cronología de ${trace.unit.code}`}>
                {trace.history.map((entry, index) => (
                  <li className="admin-timeline-step" key={`${entry.incidentId}:${entry.action}:${entry.occurredAt}:${index}`}>
                    <span className="admin-timeline-when">{formatDateTime(entry.occurredAt)}</span>
                    <span className="admin-timeline-body">
                      <strong>{entry.summary}</strong>
                      <small>{entry.actorName || "Responsable no registrado"}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </AdminDialogSection>
          </div>
        ) : null}
      </AdminDataState>
    </AdminDialog>
  );
}

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
  const [traceUnitId, setTraceUnitId] = useState<string | null>(null);
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
                      {incident.unitId ? (
                        <AdminButton aria-label={`Ver trazabilidad: ${label}`} onClick={() => setTraceUnitId(incident.unitId)}>
                          Historial
                        </AdminButton>
                      ) : null}
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
                    incident.unitId ? (
                      <AdminButton aria-label={`Ver trazabilidad: ${label}`} onClick={() => setTraceUnitId(incident.unitId)}>
                        Historial
                      </AdminButton>
                    ) : <span className="admin-muted">—</span>
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
      {traceUnitId ? <UnitTraceDialog unitId={traceUnitId} onClose={() => setTraceUnitId(null)} /> : null}
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
