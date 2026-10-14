import { requirePlatformAdmin } from "@/lib/platform/guard";
import { formatDelta, parsePeriod, resolvePeriod, type Delta } from "@/lib/platform/periods";
import {
  demoHost,
  getDemo,
  getDispositivos,
  getHoy,
  getTopPaginas,
  getTopReferrers,
  getTraficoPorHost,
  getVistasPorDia,
} from "@/lib/platform/queries/trafico";
import { publicConfig, hostnameOf } from "@/lib/public-config";
import {
  SITE_KEYS,
  SITE_LABELS,
  formatDuration,
  formatNumber,
  formatPct,
  parseSite,
  splitHosts,
  type SiteHosts,
} from "@/lib/platform/trafico-view";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { PeriodChips } from "@/components/platform/PeriodChips";
import { ChartLine } from "@/components/platform/ChartLine";
import { FilterForm } from "@/components/platform/FilterForm";
import { SiteTrafficCard } from "@/components/platform/SiteTrafficCard";
import { ChartBarList } from "@/components/admin/charts/ChartBarList";

export const dynamic = "force-dynamic";

const BASE = "/superadmin/trafico";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const EMPTY = "sin datos todavía";

function deltaTone(delta: Delta) {
  return delta.kind === "pct" ? (delta.direction === "up" ? "up" : "down") : "flat";
}

function strings(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) out[key] = v;
  }
  return out;
}

export default async function TraficoPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const range = resolvePeriod(parsePeriod(params.p));
  const siteFilter = parseSite(params.sitio);
  const demo = demoHost();
  const hosts: SiteHosts = {
    sitio: hostnameOf(publicConfig.siteUrl),
    eventos: hostnameOf(publicConfig.productUrl),
    portal: hostnameOf(publicConfig.clientUrl),
    demo,
  };
  // La demo se excluye de todo lo del negocio (`excludeHost`) y se consulta aparte.
  const business = { excludeHost: demo };
  const pagesScope = siteFilter ? { host: hosts[siteFilter] } : business;
  const [hostRows, hoy, daily, perSite, pages, referrers, devices, demoData] = await Promise.all([
    getTraficoPorHost(range),
    getHoy(new Date(), business),
    getVistasPorDia(range, business),
    Promise.all(SITE_KEYS.map((key) => getVistasPorDia(range, { host: hosts[key] }))),
    getTopPaginas(range, { ...pagesScope, limit: 10 }),
    getTopReferrers(range, { ...pagesScope, limit: 10 }),
    getDispositivos(range, pagesScope),
    getDemo(range),
  ]);
  const { sites, demo: demoRow } = splitHosts(hostRows, hosts);
  const hasAnyView = hostRows.length > 0;
  const chartHasData = [...daily.current, ...daily.previous].some((point) => point.views > 0);
  const hoyEmpty = hoy.today === 0 && hoy.yesterdaySameSlice === 0;
  const siteScopeLabel = siteFilter ? SITE_LABELS[siteFilter] : "los tres sitios";
  const deviceTotal = devices.mobile + devices.desktop;
  const refTotal = referrers.totalViews;
  const demoHasStarts = demoData.started > 0 || demoData.startedPrev > 0;

  return (
    <PlatformShell active="trafico" title="Tráfico">
      <div className="platform-page">
        <div className="platform-toolbar">
          <PeriodChips basePath={BASE} params={params} active={range.key} />
          <p className="platform-hint">
            Medición propia, sin cookies ni datos personales. Días y horas de Paraguay; el período anterior va punteado. La demo se muestra aparte, abajo.
          </p>
        </div>

        <section className="platform-panel" aria-label="Hoy">
          <header className="platform-panel-head"><h2>Hoy</h2></header>
          {hoyEmpty ? (
            <p className="platform-kpi-empty">{EMPTY}</p>
          ) : (
            <p className="platform-panel-total">
              <strong className="platform-kpi-value">{formatNumber(hoy.today)} <small>vistas</small></strong>
              <span className="platform-delta" data-tone={deltaTone(hoy.delta)}>{formatDelta(hoy.delta)}</span>
              <span className="platform-kpi-prev">ayer a esta hora: {formatNumber(hoy.yesterdaySameSlice)}</span>
            </p>
          )}
          <p className="platform-kpi-note">WebView · vistas de hoy hasta ahora contra el mismo tramo de ayer (hora de Paraguay), sin la demo.</p>
        </section>

        <section className="platform-kpis" aria-label="Indicadores por sitio">
          {sites.map((site, index) => (
            <SiteTrafficCard
              key={site.key}
              site={site}
              series={perSite[index].current.map((point) => point.views)}
              prevSeries={perSite[index].previous.map((point) => point.views)}
            />
          ))}
        </section>

        <section className="platform-panel" aria-label="Vistas por día">
          <header className="platform-panel-head"><h2>Vistas por día</h2></header>
          {chartHasData ? (
            <ChartLine
              days={daily.current.map((point) => point.day)}
              prevDays={daily.previous.map((point) => point.day)}
              values={daily.current.map((point) => point.views)}
              prevValues={daily.previous.map((point) => point.views)}
              caption="Vistas por día de los tres sitios (sin la demo)"
            />
          ) : (
            <p className="platform-kpi-empty">{EMPTY}</p>
          )}
          <p className="platform-kpi-note">WebView · vistas por día de Paraguay sumando Sitio, Landing EventOS y Portal (sin la demo).</p>
        </section>

        <div className="platform-grid">
          <section className="platform-panel" aria-label="Páginas más vistas">
            <header className="platform-panel-head"><h2>Top 10 páginas</h2></header>
            <FilterForm
              basePath={BASE}
              current={strings(params)}
              q={null}
              submitLabel="Filtrar"
              filters={[
                {
                  name: "sitio",
                  label: "Sitio",
                  value: siteFilter ?? "",
                  options: [{ value: "", label: "Sitio: todos" }, ...SITE_KEYS.map((key) => ({ value: key, label: SITE_LABELS[key] }))],
                },
              ]}
            />
            {pages.length === 0 ? (
              <p className="platform-kpi-empty">{EMPTY}</p>
            ) : (
              <div className="platform-table-wrap">
                <table className="platform-table">
                  <caption className="platform-sr-only">Páginas más vistas de {siteScopeLabel}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Página</th>
                      <th scope="col" className="platform-num">Vistas</th>
                      <th scope="col" className="platform-num">Tiempo</th>
                      <th scope="col" className="platform-num">Scroll</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((page) => (
                      <tr key={`${page.host}${page.path}`}>
                        <th scope="row">{page.path}<small>{page.host}</small></th>
                        <td className="platform-num">{formatNumber(page.views)}</td>
                        <td className="platform-num">{formatDuration(page.avgSec)}</td>
                        <td className="platform-num">{formatPct(page.avgScrollPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="platform-kpi-note">WebView · vistas por página (path sin query ni ids) de {siteScopeLabel}, sin la demo. Tiempo = duración visible promedio; solo cuenta vistas que alcanzaron a reportarla.</p>
          </section>

          <section className="platform-panel" aria-label="Orígenes">
            <header className="platform-panel-head"><h2>De dónde llegan</h2></header>
            {refTotal === 0 ? (
              <p className="platform-kpi-empty">{EMPTY}</p>
            ) : (
              <ChartBarList
                label="Orígenes de las visitas"
                max={refTotal}
                items={[
                  { key: "directo", label: "directo", value: referrers.directViews, valueLabel: formatNumber(referrers.directViews), detail: formatPct(Math.round((referrers.directViews / refTotal) * 1000) / 10) },
                  ...referrers.top.map((ref) => ({
                    key: ref.referrerHost,
                    label: ref.referrerHost,
                    value: ref.views,
                    valueLabel: formatNumber(ref.views),
                    detail: formatPct(Math.round((ref.views / refTotal) * 1000) / 10),
                  })),
                ]}
              />
            )}
            <p className="platform-kpi-note">WebView · dominio del referrer. «directo» = sin referrer o venido de la misma web. Porcentaje sobre las vistas de {siteScopeLabel}.</p>
          </section>

          <section className="platform-panel" aria-label="Dispositivos">
            <header className="platform-panel-head"><h2>Celular contra computadora</h2></header>
            {deviceTotal === 0 ? (
              <p className="platform-kpi-empty">{EMPTY}</p>
            ) : (
              <ChartBarList
                label="Vistas por tipo de dispositivo"
                max={deviceTotal}
                items={[
                  { key: "mobile", label: "Celular", value: devices.mobile, valueLabel: formatNumber(devices.mobile), detail: formatPct(devices.mobilePct), tone: "info" },
                  { key: "desktop", label: "Computadora", value: devices.desktop, valueLabel: formatNumber(devices.desktop), detail: formatPct(deviceTotal > 0 ? Math.round((devices.desktop / deviceTotal) * 1000) / 10 : null) },
                ]}
              />
            )}
            <p className="platform-kpi-note">WebView · tipo de dispositivo según el navegador, sobre las vistas de {siteScopeLabel}, sin la demo.</p>
          </section>
        </div>

        <section className="platform-demo-section" aria-label="Demo">
          <header className="platform-panel-head">
            <h2>Demo</h2>
            <p className="platform-hint">Aparte del negocio: nada de esto suma a los totales de arriba.</p>
          </header>
          {!demoHasStarts && !demoRow ? (
            <p className="platform-kpi-empty">{EMPTY}</p>
          ) : (
            <div className="platform-kpis">
              <article className="platform-kpi" aria-label="Demos iniciadas">
                <p className="platform-kpi-label">Demos iniciadas</p>
                <p className="platform-kpi-value">{formatNumber(demoData.started)}</p>
                <div className="platform-kpi-row">
                  <span className="platform-delta" data-tone={deltaTone(demoData.startedDelta)}>{formatDelta(demoData.startedDelta)}</span>
                  <span className="platform-kpi-prev">antes: {formatNumber(demoData.startedPrev)}</span>
                </div>
                <p className="platform-kpi-note">DemoSession · una por visitante cada 30 min; «Reiniciar la demo», bots y «No rastrear» no cuentan.</p>
              </article>
              <article className="platform-kpi" aria-label="Duración de la demo">
                <p className="platform-kpi-label">Duración</p>
                <p className="platform-kpi-value">{formatDuration(demoData.avgDurationSec)}</p>
                <p className="platform-kpi-prev">mediana: {formatDuration(demoData.medianDurationSec)}</p>
                <p className="platform-kpi-note">DemoSession · promedio y mediana de {formatNumber(demoData.measuredSessions)} sesiones medidas (solo las que alcanzaron a reportar el cierre).</p>
              </article>
              <article className="platform-kpi" aria-label="Módulos por sesión">
                <p className="platform-kpi-label">Módulos por sesión</p>
                <p className="platform-kpi-value">{formatNumber(demoData.avgModulesPerSession, 1)}</p>
                <p className="platform-kpi-note">DemoSession · promedio de módulos del panel distintos que visitó cada sesión medida.</p>
              </article>
              <article className="platform-kpi" aria-label="Vistas de la demo">
                <p className="platform-kpi-label">Vistas de la demo</p>
                {demoRow ? (
                  <>
                    <p className="platform-kpi-value">{formatNumber(demoRow.views)}</p>
                    <p className="platform-kpi-prev">{formatNumber(demoRow.sessions)} sesiones · antes: {formatNumber(demoRow.viewsPrev)}</p>
                  </>
                ) : (
                  <p className="platform-kpi-empty">{EMPTY}</p>
                )}
                <p className="platform-kpi-note">WebView · host {demo}. Es la única parte del sitio donde se muestran estas vistas.</p>
              </article>
              <article className="platform-kpi" aria-label="Conversión demo a lead">
                <p className="platform-kpi-label">Conversión demo → lead</p>
                <p className="platform-kpi-empty">{EMPTY}</p>
                <p className="platform-kpi-note">{demoData.conversion.reason}</p>
              </article>
            </div>
          )}
          {demoHasStarts ? (
            <section className="platform-panel" aria-label="Demos iniciadas por día">
              <header className="platform-panel-head"><h2>Demos iniciadas por día</h2></header>
              <ChartLine
                days={demoData.startedByDay.map((point) => point.day)}
                prevDays={demoData.startedByDayPrev.map((point) => point.day)}
                values={demoData.startedByDay.map((point) => point.started)}
                prevValues={demoData.startedByDayPrev.map((point) => point.started)}
                caption="Demos iniciadas por día"
              />
              <p className="platform-kpi-note">DemoSession · demos iniciadas por día de Paraguay.</p>
            </section>
          ) : null}
          <section className="platform-panel" aria-label="Módulos más usados">
            <header className="platform-panel-head"><h2>Módulos más usados</h2></header>
            {demoData.topModules.length === 0 ? (
              <p className="platform-kpi-empty">{EMPTY}</p>
            ) : (
              <ChartBarList
                label="Módulos más visitados de la demo"
                items={demoData.topModules.map((item) => ({
                  key: item.module,
                  label: item.module,
                  value: item.views,
                  valueLabel: formatNumber(item.views),
                  detail: `${formatNumber(item.sessions)} sesiones`,
                }))}
              />
            )}
            <p className="platform-kpi-note">WebView del host de la demo · primer segmento del path = módulo; «entrada» es la pantalla de inicio. Hay una sola demo, sin variantes.</p>
          </section>
        </section>
        {!hasAnyView ? <p className="platform-hint">Todavía no se registró ninguna vista en este período.</p> : null}
      </div>
    </PlatformShell>
  );
}
