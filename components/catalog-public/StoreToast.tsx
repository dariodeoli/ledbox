"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Aviso breve abajo al centro (2,5 s): «Agregado al pedido» con un enlace opcional a «Ver pedido». Vive dentro del
 * contenedor del tema (por eso hereda sus tokens). `role="status"`: lo anuncian los lectores de pantalla.
 */
export function useStoreToast(): { toast: ReactNode; show: (message: string, action?: { label: string; onClick: () => void }) => void } {
  const [state, setState] = useState<{ message: string; action?: { label: string; onClick: () => void }; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, action?: { label: string; onClick: () => void }) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ message, action, key: Date.now() });
    timer.current = setTimeout(() => setState(null), 2500);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const toast = state ? (
    <div key={state.key} className="cp-toast" role="status" data-testid="store-toast">
      <span>{state.message}</span>
      {state.action ? <button type="button" onClick={state.action.onClick}>{state.action.label}</button> : null}
    </div>
  ) : null;
  return { toast, show };
}
