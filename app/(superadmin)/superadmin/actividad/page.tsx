import { requirePlatformAdmin } from "@/lib/platform/guard";
import { parsePeriod, resolvePeriod, formatDelta } from "@/lib/platform/periods";
import { loadActividad } from "@/lib/platform/queries/actividad";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PeriodChips } from "@/components/platform/PeriodChips";
import { ChartLine } from "@/components/platform/ChartLine";
import { ChartBars } from "@/components/admin/charts/ChartBars";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: String(hour), title: `${String(hour).padStart(2, "0")}:00 a ${String(hour).padStart(2, "0")}:59` }));
const nf = new Intl.NumberFormat("es-PY");

export default async function ActividadPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const range = resolvePeriod(parsePeriod(params.p));
  const data = await loadActividad(range);
  return (
    <PlatformShell active="actividad" title="Actividad">
      <div className="platform-page">
        <div className="platform-toolbar">
          <PeriodChips basePath="/superadmin/actividad" params={params} active={range.key} />
          <p className="platform-hint">Horas y días de Paraguay. El período anterior va punteado.</p>
        </div>
        {data.series.map((serie) => (
          <section key={serie.key} className="platform-panel" aria-label={serie.label}>
            <header className="platform-panel-head">
              <h2>{serie.label}</h2>
              {serie.empty ? (
                <p className="platform-kpi-empty">{serie.empty}</p>
              ) : (
                <p className="platform-panel-total">
                  <strong>{nf.format(serie.total)}</strong>
                  <span className="platform-delta" data-tone={serie.delta.kind === "pct" ? (serie.delta.direction === "up" ? "up" : "down") : "flat"}>{formatDelta(serie.delta)}</span>
                  <span className="platform-kpi-prev">antes: {nf.format(serie.previous)}</span>
                </p>
              )}
            </header>
            {serie.empty ? null : (
              <ChartLine days={data.days} prevDays={data.prevDays} values={serie.values} prevValues={serie.prevValues} caption={`${serie.label} por día`} />
            )}
            <p className="platform-kpi-note">{serie.note}</p>
          </section>
        ))}
        <section className="platform-panel" aria-label="Acciones por hora">
          <header className="platform-panel-head"><h2>Acciones por hora</h2></header>
          <ChartBars
            categories={HOURS}
            series={[{ key: "acciones", label: "Acciones", tone: "accent", values: data.hoursActions }]}
            unit="count"
            caption="Acciones por hora del día (hora de Paraguay)"
            height={190}
          />
          <p className="platform-kpi-note">AuditLog · acciones agrupadas por hora de Paraguay</p>
        </section>
        <section className="platform-panel" aria-label="Usuarios activos por hora">
          <header className="platform-panel-head"><h2>Usuarios activos por hora</h2></header>
          {data.hasUserData ? (
            <ChartBars
              categories={HOURS}
              series={[{ key: "usuarios", label: "Usuarios", tone: "info", values: data.hoursUsers }]}
              unit="count"
              caption="Usuarios activos por hora del día (hora de Paraguay)"
              height={190}
            />
          ) : (
            <p className="platform-kpi-empty">sin datos todavía</p>
          )}
          <p className="platform-kpi-note">AdminActivityDay · usuarios con actividad en cada hora</p>
        </section>
      </div>
    </PlatformShell>
  );
}
