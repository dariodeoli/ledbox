"use client";

import { canManageOrganization } from "@/lib/admin-policy";
import { useAdminSession } from "../AdminShell";
import { AdminNote } from "../AdminUI";
import { SANDBOX_UNAVAILABLE } from "@/lib/mail-preview";
import { AjustesTabs, type AdminAjustesSection } from "./AjustesTabs";
import { AlquileresSettings } from "./AlquileresSettings";
import { AparienciaSettings } from "./AparienciaSettings";
import { InventarioSettings } from "./InventarioSettings";
import { CorreoModule } from "./CorreoModule";
import { EliminadosModule } from "./EliminadosModule";
import { EmpresaModule } from "./EmpresaModule";
import { TiendaWebSettings } from "./TiendaWebSettings";
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

export type { AdminAjustesSection } from "./AjustesTabs";

export function AjustesModule({ section }: { section: AdminAjustesSection }) {
  const { role, sandbox } = useAdminSession();
  const canManage = canManageOrganization(role);

  return (
    <>
      <AjustesTabs active={section} />

      {section === "empresa" && canManage ? <EmpresaModule /> : null}
      {section === "apariencia" && canManage ? <AparienciaSettings /> : null}
      {section === "correo" && canManage ? <CorreoModule /> : null}
      {section === "alquileres" && canManage ? <AlquileresSettings /> : null}
      {section === "inventario" && canManage ? <InventarioSettings /> : null}
      {section === "tienda" && canManage ? (
        sandbox ? (
          // Demo: el catálogo público excluye las sandboxes; no hay tienda ni pedidos que configurar.
          <AdminNote>{SANDBOX_UNAVAILABLE}: la demo no tiene tienda web pública ni pedidos del catálogo.</AdminNote>
        ) : (
          <TiendaWebSettings />
        )
      ) : null}
      {section === "plan" ? <PlanModule /> : null}
      {section === "usuarios" && canManage ? <UsuariosModule /> : null}
      {section === "eliminados" && canManage ? <EliminadosModule /> : null}
    </>
  );
}
