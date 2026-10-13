import Link from "next/link";
import type { ChartTone } from "./ChartBars";

/**
 * Barras horizontales como lista: cada fila es texto real (etiqueta, valor, detalle)
 * con una barra SVG proporcional, por lo que un lector de pantalla la lee tal cual
 * y cada fila puede ser un enlace (tamaño táctil de 44 px).
 */

export type ChartBarItem = {
  key: string;
  label: string;
  /** Valor que define el largo de la barra. */
  value: number;
  /** Texto del valor (ya formateado). */
  valueLabel: string;
  detail?: string;
  tone?: ChartTone;
  href?: string;
  title?: string;
};

export function ChartBarList({ items, max, label }: { items: ChartBarItem[]; max?: number; label: string }) {
  const domain = max ?? Math.max(0, ...items.map((item) => item.value));
  return (
    <ul className="admin-barlist" aria-label={label}>
      {items.map((item) => {
        const ratio = domain > 0 ? Math.min(1, Math.max(0, item.value / domain)) : 0;
        const body = (
          <>
            <span className="admin-barlist-text">
              <span className="admin-barlist-label">{item.label}</span>
              {item.detail ? <span className="admin-barlist-detail">{item.detail}</span> : null}
            </span>
            <span className="admin-barlist-value">{item.valueLabel}</span>
            <svg className="admin-barlist-meter" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <rect className="admin-barlist-track" x="0" y="0" width="100" height="8" rx="2" />
              {ratio > 0 ? <rect className={`admin-chart-bar admin-chart-bar--${item.tone ?? "accent"}`} x="0" y="0" width={Math.max(2, ratio * 100)} height="8" rx="2" /> : null}
            </svg>
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link className="admin-barlist-row" href={item.href} title={item.title}>
                {body}
              </Link>
            ) : (
              <div className="admin-barlist-row" title={item.title}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
