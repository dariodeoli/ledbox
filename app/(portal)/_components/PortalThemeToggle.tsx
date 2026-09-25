"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminIcon } from "@/components/admin/AdminIcons";
import { PORTAL_ROOT_ID, PORTAL_THEME_KEY, type PortalTheme } from "@/lib/portal-theme";

/**
 * Toggle de tema del portal (25-09-2026): mismo contrato que el del panel
 * (`admin-theme.tsx`) sobre el contenedor del portal. El script de arranque
 * (`PORTAL_BOOT_SCRIPT`) deja el atributo listo; acá solo se mantiene al día y
 * se guarda la preferencia para la próxima visita.
 */

function readStoredTheme(): PortalTheme {
  try {
    return window.localStorage.getItem(PORTAL_THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyPortalTheme(theme: PortalTheme): void {
  const root = document.getElementById(PORTAL_ROOT_ID);
  if (root) root.setAttribute("data-theme", theme);
}

export function PortalThemeToggle() {
  const [theme, setTheme] = useState<PortalTheme>("dark");

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyPortalTheme(stored);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: PortalTheme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(PORTAL_THEME_KEY, next);
      } catch {
        /* almacenamiento no disponible: el tema vale solo para esta visita */
      }
      applyPortalTheme(next);
      return next;
    });
  }, []);

  const label = theme === "dark" ? "Activar modo claro" : "Activar modo oscuro";
  return (
    <button
      type="button"
      className="portal-themebtn"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === "light"}
    >
      <AdminIcon name={theme === "dark" ? "sun" : "moon"} size={17} />
    </button>
  );
}
