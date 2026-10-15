"use client";

import Link from "next/link";
import { formatDateTime, formatNumber } from "@/lib/admin-format";
import { useAdminResource } from "@/lib/admin-api";
import type { AdminApiResponse } from "@/lib/admin-types";
import type { ExpiringHold, OverdueReturn } from "@/lib/server/rental-alerts";
import { AdminBadge, AdminNote } from "../AdminUI";

type OverduePayload = { overdue: OverdueReturn[]; holds: ExpiringHold[] };

const pickOverdue = (payload: AdminApiResponse): OverduePayload => {
  const data = payload as unknown as Partial<OverduePayload>;
  return { overdue: data.overdue ?? [], holds: data.holds ?? [] };
};

/** Atraso legible: «26 h» o «2 d 3 h». */
const lateText = (hours: number) => (hours >= 48 ? `${formatNumber(Math.floor(hours / 24))} d ${formatNumber(hours % 24)} h` : `${formatNumber(hours)} h`);

/**
 * Lo que salió y venció sin volver («Devoluciones vencidas») y las retenciones de la
 * tienda que vencen en menos de 6 h. Datos reales de `/api/admin/inventory/overdue-returns`;
 * sin nada pendiente no dibuja nada (no hay estado inventado).
 */
export function OverdueReturnsPanel() {
  const resource = useAdminResource("/api/admin/inventory/overdue-returns", pickOverdue);
  if (resource.error) return <AdminNote tone="error">No pudimos leer las devoluciones vencidas: {resource.error}</AdminNote>;
  const data = resource.data;
  if (!data || (data.overdue.length === 0 && data.holds.length === 0)) return null;
  return (
    <section className="admin-overdue" aria-label="Devoluciones vencidas y retenciones por vencer">
      {data.overdue.length > 0 ? (
        <div className="admin-overdue-block">
          <h3 className="admin-overdue-title">
            Devoluciones vencidas <AdminBadge tone="danger">{formatNumber(data.overdue.length)}</AdminBadge>
          </h3>
          <p className="admin-note">Salieron y no volvieron: siguen ocupadas hasta que se devuelvan, aunque el evento ya terminó.</p>
          <ul className="admin-overdue-list">
            {data.overdue.map((row) => (
              <li key={row.assignmentId}>
                <strong>{row.inventoryName}</strong> × {formatNumber(row.pending)}
                <span className="admin-nowrap"> · {lateText(row.hoursLate)} de atraso</span>
                <span> · {row.eventName}{row.clientName ? ` (${row.clientName})` : ""}</span>
                <span className="admin-nowrap"> · debía volver {formatDateTime(row.dueAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.holds.length > 0 ? (
        <div className="admin-overdue-block">
          <h3 className="admin-overdue-title">
            Retenciones por vencer <AdminBadge tone="warn">{formatNumber(data.holds.length)}</AdminBadge>
          </h3>
          <p className="admin-note">Pedidos de la tienda con el stock retenido que vence en menos de 6 h: confirmalos o se liberan solos.</p>
          <ul className="admin-overdue-list">
            {data.holds.map((hold) => (
              <li key={hold.budgetId}>
                <Link href="/presupuestos">{hold.clientName ?? hold.budgetTitle}</Link>
                <span> · {hold.budgetTitle}</span>
                <span className="admin-nowrap"> · vence {formatDateTime(hold.expiresAt)} (en {formatNumber(hold.hoursLeft)} h)</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Indicador corto para Inventario: cuántas devoluciones vencidas hay, con enlace a Eventos. */
export function OverdueReturnsIndicator() {
  const resource = useAdminResource("/api/admin/inventory/overdue-returns", pickOverdue);
  const count = resource.data?.overdue.length ?? 0;
  if (count === 0) return null;
  return (
    <AdminNote tone="warn">
      {formatNumber(count)} {count === 1 ? "devolución vencida" : "devoluciones vencidas"}: equipos que salieron y no volvieron siguen ocupados. <Link href="/eventos">Ver en Eventos</Link>
    </AdminNote>
  );
}
