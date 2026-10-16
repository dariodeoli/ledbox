"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

// Compatibility export: every store drawer uses the application lifecycle.
export { useModalBehavior } from "@/components/overlays/useModalBehavior";
