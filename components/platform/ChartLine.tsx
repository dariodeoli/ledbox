/**
 * Línea en SVG de servidor (sin JavaScript en el cliente): período actual en sólido y
 * período anterior punteado, eje Y desde 0 y una tabla accesible equivalente. Recibe
 * solo números y textos ya agregados.
 */
import { formatAxisCount, niceTicks } from "@/lib/chart-scale";

const W = 520;
const H = 200;
const M = { top: 14, right: 22, bottom: 28, left: 40 };

function dayLabel(key: string): string {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

function linePath(values: number[], domainMax: number, count: number): string {
  const width = W - M.left - M.right;
  const height = H - M.top - M.bottom;
  return values
    .map((value, index) => {
      const x = M.left + (count <= 1 ? width / 2 : (index / (count - 1)) * width);
      const y = M.top + height - (domainMax > 0 ? Math.min(1, value / domainMax) : 0) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ChartLine({
  days,
  values,
  prevValues,
  caption,
  prevDays,
}: Readonly<{ days: string[]; values: number[]; prevValues: number[]; prevDays: string[]; caption: string }>) {
  const count = days.length;
  const peak = Math.max(0, ...values, ...prevValues);
  // Conteos: marcas enteras (con picos chicos, una por unidad); sin decimales en el eje.
  const ticks = peak <= 4 ? Array.from({ length: Math.max(1, Math.ceil(peak)) + 1 }, (_, index) => index) : niceTicks(peak, 4);
  const domainMax = ticks[ticks.length - 1];
  const height = H - M.top - M.bottom;
  const width = W - M.left - M.right;
  const labelEvery = Math.max(1, Math.ceil(count / 6));
  const single = count === 1;
  const x = (index: number) => M.left + (count <= 1 ? width / 2 : (index / (count - 1)) * width);
  const y = (value: number) => M.top + height - (domainMax > 0 ? Math.min(1, value / domainMax) : 0) * height;
  return (
    <figure className="platform-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption} className="platform-chart-svg" preserveAspectRatio="xMidYMid meet">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} className="platform-chart-grid" />
            <text x={M.left - 6} y={y(tick) + 4} textAnchor="end" className="platform-chart-axis">{formatAxisCount(tick)}</text>
          </g>
        ))}
        {days.map((day, index) =>
          index % labelEvery === 0 || index === count - 1 ? (
            <text key={day} x={x(index)} y={H - 8} textAnchor="middle" className="platform-chart-axis">{dayLabel(day)}</text>
          ) : null,
        )}
        <path d={linePath(prevValues, domainMax, count)} className="platform-chart-prev" fill="none" />
        <path d={linePath(values, domainMax, count)} className="platform-chart-line" fill="none" />
        {single
          ? [
              <circle key="p" cx={x(0)} cy={y(prevValues[0] ?? 0)} r={4} className="platform-chart-dot platform-chart-dot--prev" />,
              <circle key="c" cx={x(0)} cy={y(values[0] ?? 0)} r={5} className="platform-chart-dot" />,
            ]
          : null}
      </svg>
      <figcaption className="platform-chart-legend">
        <span><i className="platform-swatch" /> Período actual</span>
        <span><i className="platform-swatch platform-swatch--prev" /> Período anterior</span>
      </figcaption>
      <table className="platform-sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr><th scope="col">Día</th><th scope="col">Actual</th><th scope="col">Día anterior</th><th scope="col">Anterior</th></tr>
        </thead>
        <tbody>
          {days.map((day, index) => (
            <tr key={day}>
              <th scope="row">{dayLabel(day)}</th>
              <td>{values[index] ?? 0}</td>
              <td>{prevDays[index] ? dayLabel(prevDays[index]) : ""}</td>
              <td>{prevValues[index] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
