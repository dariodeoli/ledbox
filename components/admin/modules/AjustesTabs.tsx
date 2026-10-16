"use client";

import { canManageOrganization } from "@/lib/admin-policy";
import type { AdminIconName } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminTabs } from "../AdminUI";

export type AdminAjustesSection = "empresa" | "apariencia" | "correo" | "alquileres" | "inventario" | "tienda" | "plan" | "usuarios" | "eliminados";

const SECTIONS: ReadonlyArray<{
  key: AdminAjustesSection | "estado";
  href: string;
  label: string;
  icon: AdminIconName;
  restricted: boolean;
}> = [
  { key: "empresa", href: "/ajustes/empresa", label: "Empresa", icon: "building", restricted: true },
  { key: "apariencia", href: "/ajustes/apariencia", label: "Apariencia", icon: "image", restricted: true },
  { key: "correo", href: "/ajustes/correo", label: "Correo", icon: "mail", restricted: true },
  { key: "alquileres", href: "/ajustes/alquileres", label: "Alquileres", icon: "calendar", restricted: true },
  { key: "inventario", href: "/ajustes/inventario", label: "Inventario", icon: "inventory", restricted: true },
  { key: "tienda", href: "/ajustes/tienda", label: "Tienda web", icon: "globe", restricted: true },
  { key: "plan", href: "/ajustes/plan", label: "Plan", icon: "plan", restricted: false },
  { key: "usuarios", href: "/ajustes/usuarios", label: "Usuarios", icon: "users", restricted: true },
  { key: "estado", href: "/estado", label: "Estado", icon: "database", restricted: true },
  { key: "eliminados", href: "/ajustes/eliminados", label: "Eliminados", icon: "trash", restricted: true },
];

/** Navegación de Ajustes; los mensajes se administran desde Clientes. */
export function AjustesTabs({ active }: { active: AdminAjustesSection | "estado" }) {
  const { role } = useAdminSession();
  const canManage = canManageOrganization(role);
  return (
    <div className="admin-subtabs-bar admin-settings-nav">
      <AdminTabs
        label="Secciones de Ajustes"
        compact
        items={[
          ...SECTIONS.filter((item) => canManage || !item.restricted).map((item) => ({
            href: item.href,
            label: item.label,
            icon: item.icon,
            active: item.key === active,
          })),
        ]}
      />
    </div>
  );
}
