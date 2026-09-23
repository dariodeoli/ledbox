"use client";

import type { AdminTone } from "@/lib/admin-format";
import { AdminBadge } from "./AdminUI";

/**
 * Vista cuadrícula del panel (issue #57).
 *
 * Es el hermano de `AdminBoard` para los módulos que no son un pipeline por
 * estados: en lugar de columnas, tarjetas con los datos clave de la fila y el
 * pie anclado abajo (misma altura por fila). El módulo describe las tarjetas;
 * la grilla no conoce ningún endpoint ni decide acciones.
 *
 * El estado de la vista (lista ⇄ cuadrícula) lo recuerda `useAdminModuleView`
 * de `AdminBoard`: una sola mecánica para todo el panel.
 */

export type AdminCardField = {
  /** Etiqueta del dato («Cantidad», «Teléfono», «Deuda vencida»). */
  label: string;
  /** Valor ya formateado por el módulo (moneda, fecha, texto, badge). */
  value: React.ReactNode;
  /** Explicación completa del dato para el `title`. */
  title?: string;
};

export type AdminCardData = {
  id: string;
  /** Identidad de la tarjeta (ítem, cliente, proveedor). */
  title: React.ReactNode;
  /** Texto completo del encabezado para el `title`. */
  titleTooltip?: string;
  /** Línea secundaria: empresa, contacto, SKU. */
  subtitle?: string | null;
  /** Etiquetas propias de la fila (estado, tipo, avisos). */
  badges?: Array<{ label: string; tone?: AdminTone; title?: string }>;
  /** Datos clave en pares etiqueta/valor. */
  fields?: AdminCardField[];
  /** Acciones de la tarjeta; el pie queda anclado abajo. */
  footer?: React.ReactNode;
};

/** Grilla de tarjetas con pie anclado: `repeat(auto-fill, minmax(15rem, 1fr))`. */
export function AdminCardGrid({ label, cards }: { label: string; cards: AdminCardData[] }) {
  return (
    <ul className="admin-cards" aria-label={label}>
      {cards.map((card) => (
        <li key={card.id} className="admin-cards-item">
          <div className="admin-cards-head">
            <span className="admin-cards-title" title={card.titleTooltip}>
              {card.title}
            </span>
            {card.badges && card.badges.length > 0 ? (
              <span className="admin-cards-badges">
                {card.badges.map((badge) => (
                  <AdminBadge key={badge.label} tone={badge.tone} title={badge.title} label={badge.title}>
                    {badge.label}
                  </AdminBadge>
                ))}
              </span>
            ) : null}
          </div>
          {card.subtitle ? <p className="admin-cards-sub">{card.subtitle}</p> : null}
          {card.fields && card.fields.length > 0 ? (
            <dl className="admin-cards-fields">
              {card.fields.map((field) => (
                <div key={field.label} className="admin-cards-field">
                  <dt>{field.label}</dt>
                  <dd title={field.title}>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {card.footer ? <div className="admin-cards-foot">{card.footer}</div> : null}
        </li>
      ))}
    </ul>
  );
}
