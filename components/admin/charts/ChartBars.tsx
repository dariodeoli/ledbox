"use client";

import { useEffect, useRef, useState } from "react";
import { formatAxisCount, formatAxisMoney, niceTicks, scaleLinear } from "@/lib/chart-scale";

/**
 * Barras en SVG propio (sin librerías): verticales, apiladas o agrupadas, con eje Y
 * desde 0, marcas «lindas», etiquetas legibles y un mes/semana resaltado. El SVG es
 * decorativo (`aria-hidden`): la información accesible es la tabla equivalente que
 * lee un lector de pantalla, y cada columna lleva un `<title>` con sus valores como
 * tooltip. Se mide el ancho real del contenedor para que el texto nunca se encoja.
 */

export type ChartTone = "ok" | "warn" | "danger" | "accent" | "info";

export type ChartCategory = {
  key: string;
  /** Etiqueta corta del eje X. */
  label: string;
  /** Etiqueta completa para el tooltip y la tabla. */
  title?: string;
  /** Resalta la columna (mes actual). */
  current?: boolean;
};

export type ChartSeries = { key: string; label: string; tone: ChartTone; values: number[] };

type Props = {
  categories: ChartCategory[];
  series: ChartSeries[];
  mode?: "stacked" | "grouped";
  /** Formato de los valores en tooltip, tabla y etiquetas. */
  unit?: "money" | "count";
  /** Texto del `caption` de la tabla accesible y descripción del gráfico. */
  caption: string;
  height?: number;
  /** Muestra el total sobre cada columna apilada cuando entra. */
  showTotals?: boolean;
};

const FONT = 11;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 26;
const CHAR_PX = 6.4;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(Math.floor(node.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ChartBars({ categories, series, mode = "stacked", unit = "money", caption, height = 210, showTotals = false }: Props) {
  const [ref, width] = useWidth();
  const money = unit === "money";
  const axisFormat = money ? formatAxisMoney : formatAxisCount;
  const fullFormat = (value: number) => (money ? `Gs ${new Intl.NumberFormat("es-PY").format(Math.round(value))}` : formatAxisCount(value));

  const totals = categories.map((_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0));
  const peak = mode === "stacked" ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((item) => item.values));
  const ticks = niceTicks(peak, 4);
  const domainMax = ticks[ticks.length - 1];

  const axisWidth = Math.max(...ticks.map((tick) => axisFormat(tick).length)) * CHAR_PX + 10;
  const left = Math.ceil(axisWidth);
  const plotW = Math.max(0, width - left - 6);
  const plotH = height - MARGIN_TOP - MARGIN_BOTTOM;
  const slot = categories.length ? plotW / categories.length : 0;
  const y = (value: number) => MARGIN_TOP + plotH * (1 - scaleLinear(value, domainMax));

  const longestLabel = Math.max(1, ...categories.map((category) => category.label.length));
  const labelEvery = Math.max(1, Math.ceil((longestLabel * CHAR_PX + 6) / Math.max(1, slot)));

  const barW = mode === "stacked" ? Math.min(slot * 0.62, 40) : Math.min((slot * 0.78) / Math.max(1, series.length), 24);
  const tipFor = (index: number) => {
    const category = categories[index];
    const lines = series.map((item) => `${item.label}: ${fullFormat(item.values[index] ?? 0)}`);
    if (mode === "stacked" && series.length > 1) lines.push(`Total: ${fullFormat(totals[index])}`);
    return `${category.title ?? category.label}\n${lines.join("\n")}`;
  };

  return (
    <figure className="admin-chart">
      <div className="admin-chart-box" ref={ref} style={{ minHeight: height }}>
        {width > 0 ? (
          <svg className="admin-chart-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="admin-chart-grid" x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} />
                <text className="admin-chart-tick" x={left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={FONT}>
                  {axisFormat(tick)}
                </text>
              </g>
            ))}
            {categories.map((category, index) => {
              const x0 = left + slot * index;
              const cx = x0 + slot / 2;
              let stackTop = 0;
              return (
                <g className="admin-chart-col" data-current={category.current ? "true" : undefined} key={category.key}>
                  <title>{tipFor(index)}</title>
                  <rect className="admin-chart-hit" x={x0} y={MARGIN_TOP - 4} width={slot} height={plotH + 4} rx={4} />
                  {mode === "stacked"
                    ? series.map((item) => {
                        const value = item.values[index] ?? 0;
                        if (!(value > 0)) return null;
                        const top = y(stackTop + value);
                        const bottom = y(stackTop);
                        stackTop += value;
                        return (
                          <rect
                            className={`admin-chart-bar admin-chart-bar--${item.tone}`}
                            key={item.key}
                            x={cx - barW / 2}
                            y={top}
                            width={barW}
                            height={Math.max(1, bottom - top - (stackTop > value ? 1 : 0))}
                          />
                        );
                      })
                    : series.map((item, seriesIndex) => {
                        const value = item.values[index] ?? 0;
                        if (!(value > 0)) return null;
                        const groupW = barW * series.length + (series.length - 1) * 2;
                        const x = cx - groupW / 2 + seriesIndex * (barW + 2);
                        return <rect className={`admin-chart-bar admin-chart-bar--${item.tone}`} key={item.key} x={x} y={y(value)} width={barW} height={Math.max(1, y(0) - y(value))} rx={2} />;
                      })}
                  {showTotals && mode === "stacked" && totals[index] > 0 && slot >= 46 ? (
                    <text className="admin-chart-value" x={cx} y={y(totals[index]) - 4} textAnchor="middle" fontSize={FONT}>
                      {axisFormat(totals[index])}
                    </text>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text className="admin-chart-label" x={cx} y={height - 8} textAnchor="middle" fontSize={FONT} data-current={category.current ? "true" : undefined}>
                      {category.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line className="admin-chart-axis" x1={left} x2={width - 4} y1={y(0)} y2={y(0)} />
          </svg>
        ) : null}
      </div>
      {series.length > 1 ? (
        <ul className="admin-chart-legend" aria-hidden="true">
          {series.map((item) => (
            <li key={item.key}>
              <span className={`admin-chart-swatch admin-chart-bar--${item.tone}`} />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Período</th>
            {series.map((item) => (
              <th scope="col" key={item.key}>{item.label}</th>
            ))}
            {mode === "stacked" && series.length > 1 ? <th scope="col">Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={category.key}>
              <th scope="row">{category.title ?? category.label}</th>
              {series.map((item) => (
                <td key={item.key}>{fullFormat(item.values[index] ?? 0)}</td>
              ))}
              {mode === "stacked" && series.length > 1 ? <td>{fullFormat(totals[index])}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
