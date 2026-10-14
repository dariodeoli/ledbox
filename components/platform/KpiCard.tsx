import { formatDelta, type Delta } from "@/lib/platform/periods";
import type { PlatformKpi } from "@/lib/platform/queries/resumen";

const money = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });

export function formatKpiValue(value: number, format: "count" | "money"): string {
  return format === "money" ? `Gs ${money.format(Math.round(value))}` : count.format(Math.round(value));
}

export function Sparkline({ values, prev }: { values: number[]; prev: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const peak = Math.max(0, ...values, ...prev);
  const pts = (list: number[]) =>
    list
      .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (list.length - 1)) * w).toFixed(1)} ${(h - 2 - (peak > 0 ? (v / peak) * (h - 4) : 0)).toFixed(1)}`)
      .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="platform-spark" aria-hidden="true" focusable="false" preserveAspectRatio="none">
      <path d={pts(prev)} className="platform-chart-prev" fill="none" vectorEffect="non-scaling-stroke" />
      <path d={pts(values)} className="platform-chart-line" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DeltaBadge({ delta }: { delta: Delta }) {
  const tone = delta.kind === "pct" ? (delta.direction === "up" ? "up" : "down") : "flat";
  return (
    <span className="platform-delta" data-tone={tone}>
      {delta.kind === "pct" ? (delta.direction === "up" ? "▲ " : "▼ ") : ""}
      {formatDelta(delta)}
    </span>
  );
}

/** KPI con delta contra el período anterior, sparkline diaria y nota «fuente · cálculo». */
export function KpiCard({ kpi }: Readonly<{ kpi: PlatformKpi }>) {
  return (
    <article className="platform-kpi" aria-label={kpi.label}>
      <p className="platform-kpi-label">{kpi.label}</p>
      {kpi.empty ? (
        <p className="platform-kpi-empty">{kpi.empty}</p>
      ) : (
        <>
          <p className="platform-kpi-value">{formatKpiValue(kpi.value, kpi.format)}</p>
          <div className="platform-kpi-row">
            {kpi.delta ? <DeltaBadge delta={kpi.delta} /> : <span className="platform-delta" data-tone="flat">al día de hoy</span>}
            {kpi.delta && kpi.previous !== null ? (
              <span className="platform-kpi-prev">antes: {formatKpiValue(kpi.previous, kpi.format)}</span>
            ) : null}
          </div>
          <Sparkline values={kpi.series} prev={kpi.prevSeries} />
          {kpi.papelera !== null ? <p className="platform-kpi-trash">en papelera: {count.format(kpi.papelera)}</p> : null}
          {kpi.deleted !== null ? <p className="platform-kpi-trash">de esto, eliminado: {formatKpiValue(kpi.deleted, "money")}</p> : null}
        </>
      )}
      <p className="platform-kpi-note">{kpi.note}</p>
    </article>
  );
}
