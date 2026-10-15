"use client";

import { useState } from "react";
import { AdminIcon } from "@/components/admin/AdminIcons";

/** Cerrar sesión al pie del menú de plataforma: revoca la sesión y vuelve al login. */
export function PlatformLogout() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="admin-nav-link admin-sidebar-logout"
      disabled={busy}
      title="Cerrar sesión"
      aria-label="Cerrar sesión"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } finally {
          window.location.assign("/login");
        }
      }}
    >
      <AdminIcon name="logout" size={16} />
      <span className="admin-nav-text">{busy ? "Saliendo…" : "Cerrar sesión"}</span>
    </button>
  );
}
