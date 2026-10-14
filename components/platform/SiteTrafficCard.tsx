import { DeltaBadge, Sparkline } from "@/components/platform/KpiCard";
import { formatDuration, formatNumber, formatPct, type SiteCardData } from "@/lib/platform/trafico-view";

/** KPIs de un sitio: vistas con delta y sparkline, y el resto de métricas con «sin datos» honesto. */
export function SiteTrafficCard({
  site,
  series,
  prevSeries,
}: Readonly<{ site: SiteCardData; series: number[]; prevSeries: number[] }>) {
  const row = site.row;
  return (
    <article className="platform-kpi platform-site" aria-label={site.label}>
      <p className="platform-kpi-label">{site.label}</p>
      {row ? (
        <>
          <p className="platform-kpi-value">{formatNumber(row.views)} <small>vistas</small></p>
          <div className="platform-kpi-row">
            <DeltaBadge delta={row.viewsDelta} />
            <span className="platform-kpi-prev">antes: {formatNumber(row.viewsPrev)}</span>
          </div>
          <Sparkline values={series} prev={prevSeries} />
          <dl className="platform-metrics">
            <div><dt>Visitantes (suma diaria)</dt><dd>{formatNumber(row.visitors)}</dd></div>
            <div><dt>Sesiones</dt><dd>{formatNumber(row.sessions)}</dd></div>
            <div><dt>Tiempo promedio</dt><dd>{formatDuration(row.avgSec)}</dd></div>
            <div><dt>Tiempo mediana</dt><dd>{formatDuration(row.medianSec)}</dd></div>
            <div><dt>Scroll promedio</dt><dd>{formatPct(row.avgScrollPct)}</dd></div>
            <div><dt>Rebote</dt><dd>{formatPct(row.bounceRate)}</dd></div>
          </dl>
          <p className="platform-kpi-note">
            El código del visitante cambia cada día: quien vuelve otro día cuenta otra vez. No son personas únicas.
          </p>
        </>
      ) : (
        <p className="platform-kpi-empty">sin datos todavía</p>
      )}
      <p className="platform-kpi-note">
        WebView · host {site.host}. Vistas por sitio; sesiones = ids de navegación distintos; rebote = sesión de una vista con menos de 10 s.
      </p>
    </article>
  );
}
