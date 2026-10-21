"use client";

import { formatDateTime, formatNumber } from "@/lib/admin-format";
import { useAdminResource } from "@/lib/admin-api";
import { AdminBadge, AdminButton, AdminCell, AdminCollection, AdminEmpty, AdminNote, AdminRow, AdminTable } from "../AdminUI";

type CountLine = { id: string; productName: string; warehouseName: string; warehouseCode: string; expectedQuantity: number; countedQuantity: number; discrepancy: number };
type History = {
  entries: Array<{ id: string; at: string; kind: "event" | "activity" | "incident" | "count"; title: string; description: string; actor?: string }>;
  verification: { countedAt: string; actorName: string; lines: CountLine[] } | null;
};

function useHistory(inventoryId: string) {
  return useAdminResource(`/api/admin/inventory/${encodeURIComponent(inventoryId)}/history?take=100`, (payload) => payload as unknown as History);
}

export function InventoryProductVerification({ inventoryId }: { inventoryId: string }) {
  const resource = useHistory(inventoryId);
  const verification = resource.data?.verification;
  return <div className="admin-stack">
    {resource.loading ? <AdminNote>Cargando la última verificación…</AdminNote> : null}
    {resource.error ? <div className="admin-stack"><AdminNote tone="error">{resource.error}</AdminNote><AdminButton onClick={resource.reload}>Reintentar</AdminButton></div> : null}
    {!resource.loading && !resource.error && !verification ? <AdminEmpty icon="check" title="Sin conteos registrados" hint="Cuando registres un conteo físico, acá vas a ver la fecha, quién lo realizó y las diferencias por depósito." /> : null}
    {verification ? <>
      <AdminNote tone="ok">Último conteo · {formatDateTime(verification.countedAt)} · {verification.actorName}</AdminNote>
      <AdminTable view="verificacion-fisica" label="Último conteo físico por depósito" columns={[{ label: "Depósito" }, { label: "Registrado", end: true }, { label: "Contado", end: true }, { label: "Diferencia", end: true }]}>
        {verification.lines.map((line) => <AdminRow key={line.id} tone={line.discrepancy === 0 ? undefined : "warn"}>
          <AdminCell>{line.warehouseName} · {line.warehouseCode}</AdminCell>
          <AdminCell end>{formatNumber(line.expectedQuantity)}</AdminCell>
          <AdminCell end>{formatNumber(line.countedQuantity)}</AdminCell>
          <AdminCell end><AdminBadge tone={line.discrepancy === 0 ? "ok" : "warn"}>{line.discrepancy > 0 ? "+" : ""}{formatNumber(line.discrepancy)}</AdminBadge></AdminCell>
        </AdminRow>)}
      </AdminTable>
      <AdminNote>La verificación registra lo contado y no ajusta unidades ni disponibilidad.</AdminNote>
    </> : null}
  </div>;
}

export function InventoryProductTimeline({ inventoryId }: { inventoryId: string }) {
  const resource = useHistory(inventoryId);
  const entries = resource.data?.entries ?? [];
  return <AdminCollection label="Cronología del producto" view="list" density="compact" loading={resource.loading} error={resource.error} onRetry={resource.reload} empty={!resource.loading && !resource.error && entries.length === 0} emptyTitle="Todavía no hay movimientos registrados" emptyHint="Las asignaciones, salidas, devoluciones, incidentes y conteos aparecerán acá cuando existan." emptyIcon="clock">
    <ol className="admin-stack" aria-label="Cronología del producto">
      {entries.map((entry) => <li className="admin-panel" key={entry.id}>
        <header className="admin-panel-head">
          <div><h3>{entry.title}</h3><p>{formatDateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ""}</p></div>
          <AdminBadge tone={entry.kind === "count" ? "ok" : entry.kind === "incident" ? "warn" : "neutral"}>{entry.kind === "count" ? "Conteo" : entry.kind === "incident" ? "Incidente" : entry.kind === "event" ? "Evento" : "Actividad"}</AdminBadge>
        </header>
        <p className="admin-panel-body">{entry.description}</p>
      </li>)}
    </ol>
  </AdminCollection>;
}
