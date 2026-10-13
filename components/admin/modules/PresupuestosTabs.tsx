"use client";

import { AdminSubtabs } from "../AdminUI";

/**
 * Pestañas de Presupuestos: la lista y las solicitudes de firma (`/firmas`, issue
 * #81). Firmas dejó de ser un ítem del menú y vive acá; la misma barra se dibuja en
 * las dos pantallas para que el acceso sea siempre visible.
 */
export function PresupuestosTabs({ active }: { active: "presupuestos" | "firmas" }) {
  return (
    <div className="admin-subtabs-bar">
      <AdminSubtabs
        label="Secciones de Presupuestos"
        items={[
          { href: "/presupuestos", label: "Presupuestos", icon: "budgets", active: active === "presupuestos" },
          { href: "/firmas", label: "Firmas", icon: "pen", active: active === "firmas" },
        ]}
      />
    </div>
  );
}
