"use client";

import { AdminSubtabs } from "../AdminUI";

/**
 * Pestañas de Presupuestos: la lista, las firmas (`/firmas`, issue #81) y, si el
 * portal recibió pedidos, las solicitudes del portal. La misma barra se dibuja en
 * las pantallas hermanas para que el acceso sea siempre visible.
 */
export function PresupuestosTabs({
  active,
  requests,
  pendingRequests = 0,
}: {
  active: "presupuestos" | "firmas" | "solicitudes";
  /** Cantidad de solicitudes del portal; sin ellas la pestaña no existe. */
  requests?: number;
  pendingRequests?: number;
}) {
  return (
    <div className="admin-subtabs-bar">
      <AdminSubtabs
        label="Secciones de Presupuestos"
        items={[
          { href: "/presupuestos", label: "Presupuestos", icon: "budgets", active: active === "presupuestos" },
          { href: "/firmas", label: "Firmas", icon: "pen", active: active === "firmas" },
          ...(requests ? [{ href: "/presupuestos?vista=solicitudes", label: "Solicitudes del portal", icon: "globe" as const, active: active === "solicitudes", count: pendingRequests }] : []),
        ]}
      />
    </div>
  );
}
