"use client";

import { canManageOrganization } from "@/lib/admin-policy";
import type { AdminIconName } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminSubtabs } from "../AdminUI";

export type AdminAjustesSection = "empresa" | "apariencia" | "correo" | "alquileres" | "tienda" | "plan" | "usuarios" | "eliminados";

const SECTIONS: ReadonlyArray<{
  key: AdminAjustesSection;
  href: string;
  label: string;
  icon: AdminIconName;
  restricted: boolean;
}> = [
  { key: "empresa", href: "/ajustes/empresa", label: "Empresa", icon: "building", restricted: true },
  { key: "apariencia", href: "/ajustes/apariencia", label: "Apariencia", icon: "image", restricted: true },
  { key: "correo", href: "/ajustes/correo", label: "Correo", icon: "mail", restricted: true },
  { key: "alquileres", href: "/ajustes/alquileres", label: "Alquileres", icon: "calendar", restricted: true },
  { key: "tienda", href: "/ajustes/tienda", label: "Tienda web", icon: "globe", restricted: true },
  { key: "plan", href: "/ajustes/plan", label: "Plan", icon: "plan", restricted: false },
  { key: "usuarios", href: "/ajustes/usuarios", label: "Usuarios", icon: "users", restricted: true },
  { key: "eliminados", href: "/ajustes/eliminados", label: "Eliminados", icon: "trash", restricted: true },
];

/**
 * Barra de secciones de Ajustes. Plantillas (issue #35) es una sección más pero
 * vive en su propia ruta (`/plantillas`), así que la barra es la misma en las dos
 * pantallas y Plantillas se ve para todos los roles (el API gatea por categoría).
 */
export function AjustesTabs({ active }: { active: AdminAjustesSection | "plantillas" }) {
  const { role } = useAdminSession();
  const canManage = canManageOrganization(role);
  return (
    <div className="admin-subtabs-bar">
      <AdminSubtabs
        label="Secciones de Ajustes"
        items={[
          ...SECTIONS.filter((item) => canManage || !item.restricted).map((item) => ({
            href: item.href,
            label: item.label,
            icon: item.icon,
            active: item.key === active,
          })),
          { href: "/plantillas", label: "Plantillas", icon: "mail" as AdminIconName, active: active === "plantillas" },
        ]}
      />
    </div>
  );
}
