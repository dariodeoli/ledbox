"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/admin-format";
import { useAdminResource } from "@/lib/admin-api";
import { AdminButton, AdminDataState, AdminDialog, AdminNote, AdminTable, AdminRow, AdminCell } from "@/components/ui";

type CountLine = { id: string; productName: string; warehouseName: string; warehouseCode: string; expectedQuantity: number; countedQuantity: number; discrepancy: number };
type CountSession = { id: string; countedAt: string; actorName: string; actorEmail: string; notes: string | null; lines: CountLine[] };

function dateTime(value: string) {
  return new Intl.DateTimeFormat("es-PY", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(new Date(value));
}

export function InventoryCountHistory() {
  const [open, setOpen] = useState(false);
  const resource = useAdminResource("/api/admin/inventory/counts?take=100", (payload) => ((payload as unknown as { sessions?: CountSession[] }).sessions ?? []), { enabled: open });

  return <>
    <AdminButton icon="clock" onClick={() => setOpen(true)} title="Consultar sesiones publicadas de conteo físico">Conteos físicos</AdminButton>
    {open ? <AdminDialog title="Conteos físicos publicados" onClose={() => setOpen(false)}>
      <div className="admin-stack">
        <AdminNote>Registro de referencia de los conteos físicos. Las cantidades contadas y las discrepancias son una fotografía del momento; consultar este historial no modifica el inventario.</AdminNote>
        <AdminDataState loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={Boolean(resource.data && resource.data.length === 0)} emptyTitle="Todavía no hay conteos físicos" emptyHint="Las sesiones publicadas aparecerán acá." emptyIcon="clock">
          <div className="admin-stack">
            {(resource.data ?? []).map((session) => <section className="admin-panel" key={session.id}>
              <header className="admin-panel-head">
                <div><h3>{dateTime(session.countedAt)}</h3><p>{session.actorName} · {session.actorEmail} · {formatNumber(session.lines.length)} {session.lines.length === 1 ? "producto" : "productos"}</p></div>
              </header>
              {session.notes ? <p className="admin-panel-body">{session.notes}</p> : null}
              <AdminTable view="conteos-fisicos" label={`Detalle de conteo ${dateTime(session.countedAt)}`} columns={[{ label: "Producto" }, { label: "Depósito" }, { label: "Registrado", end: true }, { label: "Contado", end: true }, { label: "Diferencia", end: true }]}>
                {session.lines.map((line) => <AdminRow key={line.id} tone={line.discrepancy === 0 ? undefined : "warn"}>
                  <AdminCell>{line.productName}</AdminCell><AdminCell>{line.warehouseName} · {line.warehouseCode}</AdminCell>
                  <AdminCell end>{formatNumber(line.expectedQuantity)}</AdminCell><AdminCell end>{formatNumber(line.countedQuantity)}</AdminCell>
                  <AdminCell end>{line.discrepancy > 0 ? "+" : ""}{formatNumber(line.discrepancy)}</AdminCell>
                </AdminRow>)}
              </AdminTable>
            </section>)}
          </div>
        </AdminDataState>
      </div>
    </AdminDialog> : null}
  </>;
}
