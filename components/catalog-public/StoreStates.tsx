"use client";

import { XIcon, type XIconName } from "./StoreIcons";

/** Estados de la tienda: sin resultados / vacío (con salida) y error (con reintento). Los skeletons están en `StoreSkeletons`. */
export function EmptyState({ icon, title, text, action }: { icon: XIconName; title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="cp-state" role="status" data-testid="empty-state">
      <XIcon name={icon} size={36} />
      <p className="cp-state-title">{title}</p>
      <p>{text}</p>
      {action ? <button type="button" className="cp-btn" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  );
}

export function ErrorState({ title = "No pudimos cargar la tienda", text, onRetry }: { title?: string; text: string; onRetry?: () => void }) {
  return (
    <div className="cp-state" role="alert" data-testid="error-state">
      <XIcon name="alert" size={36} />
      <p className="cp-state-title">{title}</p>
      <p>{text}</p>
      {onRetry ? <button type="button" className="cp-btn cp-btn--primary" onClick={onRetry}>Reintentar</button> : null}
    </div>
  );
}
