"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Dibuja cajones y ventanas de la tienda fuera de las secciones de la página, pero DENTRO del contenedor de la plantilla
 * (`.cp-theme`, que trae los colores de la empresa). Las secciones crean su propio nivel de apilado: un cajón que viva
 * adentro queda por debajo del encabezado fijo y lo deja tapando su título. Así el cajón siempre queda por encima de
 * todo (encabezado, barra del pedido, botón de WhatsApp).
 */
export function ThemePortal({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setTarget(anchor.current?.closest(".cp-theme") ?? document.body);
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {target ? createPortal(children, target) : null}
    </>
  );
}

const FOCUSABLE = "a[href],button:not([disabled]),input:not([tabindex='-1']):not([type=hidden]),textarea,select,[tabindex]:not([tabindex='-1'])";

/**
 * Ventana accesible: foco adentro al abrir, foco atrapado con Tab, Esc cierra y el foco vuelve a donde estaba.
 * Mientras está abierta, la página de atrás no se desplaza (conserva su posición al cerrar).
 */
export function useModalBehavior(panel: RefObject<HTMLElement | null>, onClose: () => void, options: { initialFocus?: RefObject<HTMLElement | null>; lockScroll?: boolean } = {}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (options.initialFocus?.current) options.initialFocus.current.focus();
    else if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const lock = options.lockScroll !== false;
    const before = document.body.style.overflow;
    if (lock) document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      // Con dos ventanas abiertas (vista rápida + «guardar carrito») solo responde la de arriba.
      const stack = document.querySelectorAll("[role=dialog][aria-modal=true]");
      if (stack.length > 0 && stack[stack.length - 1] !== panel.current) return;
      if (event.key === "Escape") { event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (nodes.length === 0) { event.preventDefault(); return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (lock) document.body.style.overflow = before;
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
