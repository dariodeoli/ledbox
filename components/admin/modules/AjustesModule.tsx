"use client";

import { canManageOrganization } from "@/lib/admin-policy";
import type { AdminIconName } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminSubtabs } from "../AdminUI";
import { CorreoModule } from "./CorreoModule";
import { EmpresaModule } from "./EmpresaModule";
import { PlanModule } from "./PlanModule";
import { UsuariosModule } from "./UsuariosModule";

/**
 * Ajustes (issue #56): el área de configuración del panel, consolidada en una
 * sola entrada del nav con cuatro secciones —Empresa, Correo, Plan y Usuarios—.
 * Antes eran cuatro destinos sueltos (`/empresa`, `/configuracion`, `/plan`,
 * `/usuarios`) y quedaban accesos duplicados (Empresa también como subtab de
 * Configuración, PIN en Perfil y en Configuración → Seguridad).
 *
 * La barra dibuja solo las secciones que el rol puede ver (Empresa, Correo y
 * Usuarios son OWNER/ADMIN; Plan se ve siempre); el API revalida igual. Las
 * rutas viejas siguen entrando con redirect.
 */

export type AdminAjustesSection = "empresa" | "correo" | "plan" | "usuarios";

const SECTIONS: ReadonlyArray<{
  key: AdminAjustesSection;
  href: string;
  label: string;
  icon: AdminIconName;
  restricted: boolean;
}> = [
  { key: "empresa", href: "/ajustes/empresa", label: "Empresa", icon: "building", restricted: true },
  { key: "correo", href: "/ajustes/correo", label: "Correo", icon: "mail", restricted: true },
  { key: "plan", href: "/ajustes/plan", label: "Plan", icon: "plan", restricted: false },
  { key: "usuarios", href: "/ajustes/usuarios", label: "Usuarios", icon: "users", restricted: true },
];

export function AjustesModule({ section }: { section: AdminAjustesSection }) {
  const { role } = useAdminSession();
  const canManage = canManageOrganization(role);

  return (
    <>
      <div className="admin-subtabs-bar">
        <AdminSubtabs
          label="Secciones de Ajustes"
          items={SECTIONS.filter((item) => canManage || !item.restricted).map((item) => ({
            href: item.href,
            label: item.label,
            icon: item.icon,
            active: item.key === section,
          }))}
        />
      </div>

      {section === "empresa" && canManage ? <EmpresaModule /> : null}
      {section === "correo" && canManage ? <CorreoModule /> : null}
      {section === "plan" ? <PlanModule /> : null}
      {section === "usuarios" && canManage ? <UsuariosModule /> : null}
    </>
  );
}
