import Link from "next/link";
import { loadPendingPlanRequests } from "@/lib/platform/queries/plan-requests";
import { parsePage, PAGE_SIZE } from "@/lib/platform/tablas";
import { TablePager } from "@/components/platform/TablePager";
import { PlatformRefresh } from "@/components/platform/PlatformRefresh";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { parsePeriod, resolvePeriod } from "@/lib/platform/periods";
import { loadResumen } from "@/lib/platform/queries/resumen";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PeriodChips } from "@/components/platform/PeriodChips";
import { KpiCard } from "@/components/platform/KpiCard";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResumenPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const range = resolvePeriod(parsePeriod(params.p));
  const [data, requests] = await Promise.all([loadResumen(range), loadPendingPlanRequests(parsePage(params.pag))]);
  return (
    <PlatformShell active="resumen" title="Resumen">
      <div className="platform-page">
        <div className="platform-toolbar">
          <PeriodChips basePath="/superadmin" params={params} active={range.key} />
          <p className="platform-hint">Comparado con el período anterior de igual duración. Sin la empresa demo.</p>
        </div>
        <section className="platform-kpis" aria-label="Indicadores">
          {data.kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </section>
        <section className="platform-panel" aria-labelledby="solicitudes-plan">
          <div className="platform-toolbar">
            <h2 id="solicitudes-plan">Solicitudes de plan pendientes ({requests.total})</h2>
            <PlatformRefresh />
            <p className="platform-hint">Todas las fechas, sin demo. Se actualiza al volver a esta pestaña. Registrar una solicitud no cambia el plan ni genera un cobro.</p>
          </div>
          {requests.rows.length === 0 ? <p className="platform-hint">No hay solicitudes pendientes.</p> : (
            <div className="platform-table-wrap">
              <table className="platform-table">
                <thead><tr><th scope="col">Empresa</th><th scope="col">Plan solicitado</th><th scope="col">Solicitado por</th><th scope="col">Fecha</th></tr></thead>
                <tbody>{requests.rows.map((request) => <tr key={request.id}>
                  <td><Link href={`/superadmin/empresas?detalle=${encodeURIComponent(request.organization.id)}`}>{request.organization.name}</Link></td>
                  <td>{request.plan.name}{request.note ? <p className="platform-hint">{request.note}</p> : null}</td>
                  <td>{request.requestedByName}</td>
                  <td>{new Intl.DateTimeFormat("es-PY", { dateStyle: "short", timeStyle: "short", timeZone: "America/Asuncion" }).format(request.createdAt)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          <TablePager basePath="/superadmin" params={params} page={requests.page} total={requests.total} pageSize={PAGE_SIZE} />
        </section>
        <aside className="platform-demo" aria-label="Empresa demo">
          <strong>Demo</strong>
          <span>
            {data.demo.eventos} eventos y {data.demo.presupuestos} presupuestos de prueba. No suman a ningún indicador.
          </span>
        </aside>
      </div>
    </PlatformShell>
  );
}
