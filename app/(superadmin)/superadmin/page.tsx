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
  const data = await loadResumen(range);
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
