"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_ROOT_ID, ADMIN_THEME_KEY, type AdminTheme } from "@/lib/admin-theme";
import { AdminIcon } from "./AdminIcons";

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
