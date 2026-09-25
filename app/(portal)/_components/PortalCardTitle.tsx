import type { ReactNode } from "react";
import { AdminIcon } from "@/components/admin/AdminIcons";
import type { AdminIconName } from "@/lib/admin-types";

/**
 * Título de tarjeta del portal con su ícono (25-09-2026): el mismo lenguaje
 * visual del panel —ícono lineal a la izquierda— para que cada sección se
 * reconozca de un vistazo. Un solo objeto para todos los títulos del portal.
 */
export function PortalCardTitle({ id, icon, children }: { id?: string; icon: AdminIconName; children: ReactNode }) {
  return (
    <h2 className="portal-card-title" id={id}>
      <AdminIcon name={icon} size={15} />
      <span>{children}</span>
    </h2>
  );
}
