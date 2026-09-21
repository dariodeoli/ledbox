import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { ConfiguracionModule } from "@/components/admin/modules/ConfiguracionModule";

export const metadata: Metadata = { title: "Configuración · Seguridad" };

/** Seguridad (issue #21): PIN y auto-bloqueo por usuario, dentro del área de Configuración. */
export default function ConfiguracionSeguridadPage() {
  return (
    <AdminModuleGuard href="/configuracion">
      <ConfiguracionModule section="seguridad" />
    </AdminModuleGuard>
  );
}
