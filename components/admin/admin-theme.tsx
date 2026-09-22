"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_ROOT_ID,
  ADMIN_SIDEBAR_KEY,
  ADMIN_THEME_KEY,
  type AdminSidebarMode,
  type AdminTheme,
} from "@/lib/admin-theme";
import { AdminIcon } from "./AdminIcons";

/**
 * Preferencias persistidas del panel (solo cliente): tema y sidebar de
 * escritorio. Las dos se guardan en localStorage y se aplican como atributos de
 * `.admin-root`, así el arranque (`ADMIN_BOOT_SCRIPT`) las pinta antes del
 * primer render y el toggle solo las mantiene sincronizadas.
 */

function readStoredTheme(): AdminTheme {
  try {
    return window.localStorage.getItem(ADMIN_THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyAdminTheme(theme: AdminTheme): void {
  const root = document.getElementById(ADMIN_ROOT_ID);
  if (root) root.setAttribute("data-theme", theme);
}

/** Modo del sidebar de escritorio guardado por el usuario (default: expandido). */
export function readStoredSidebarMode(): AdminSidebarMode {
  try {
    return window.localStorage.getItem(ADMIN_SIDEBAR_KEY) === "collapsed" ? "collapsed" : "expanded";
  } catch {
    return "expanded";
  }
}

export function applyAdminSidebarMode(mode: AdminSidebarMode): void {
  const root = document.getElementById(ADMIN_ROOT_ID);
  if (!root) return;
  if (mode === "collapsed") root.setAttribute("data-sidebar", "collapsed");
  else root.removeAttribute("data-sidebar");
}

export function AdminThemeToggle() {
  const [theme, setTheme] = useState<AdminTheme>("dark");

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyAdminTheme(stored);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: AdminTheme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(ADMIN_THEME_KEY, next);
      } catch {
        /* almacenamiento no disponible: el tema vale solo para esta vista */
      }
      applyAdminTheme(next);
      return next;
    });
  }, []);

  const label = theme === "dark" ? "Activar modo claro" : "Activar modo oscuro";
  return (
    <button type="button" className="admin-iconbtn" onClick={toggle} title={label} aria-label={label} aria-pressed={theme === "light"}>
      <AdminIcon name={theme === "dark" ? "sun" : "moon"} size={16} />
    </button>
  );
}

/**
 * Toggle del sidebar de escritorio (solo íconos ↔ completo). En mobile no se
 * dibuja: ahí el sidebar sigue siendo el drawer con su barra inferior.
 */
export function AdminSidebarToggle() {
  const [mode, setMode] = useState<AdminSidebarMode>("expanded");

  useEffect(() => {
    setMode(readStoredSidebarMode());
  }, []);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: AdminSidebarMode = current === "collapsed" ? "expanded" : "collapsed";
      try {
        window.localStorage.setItem(ADMIN_SIDEBAR_KEY, next);
      } catch {
        /* almacenamiento no disponible: el modo vale solo para esta vista */
      }
      applyAdminSidebarMode(next);
      return next;
    });
  }, []);

  const collapsed = mode === "collapsed";
  const label = collapsed ? "Expandir el menú lateral" : "Colapsar el menú lateral (solo íconos)";
  return (
    <button
      type="button"
      className="admin-iconbtn admin-sidebar-collapse"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls="admin-sidebar"
    >
      <AdminIcon name="panel-left" size={16} />
    </button>
  );
}
