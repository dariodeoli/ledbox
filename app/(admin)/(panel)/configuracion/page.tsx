import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { ConfiguracionModule } from "@/components/admin/modules/ConfiguracionModule";

export const metadata: Metadata = { title: "Configuración" };

/** Configuración (issue #31): Correo de la empresa, junto a Empresa. Solo OWNER/ADMIN. */
export default function ConfiguracionPage() {
  return (
    <AdminModuleGuard href="/configuracion">
      <ConfiguracionModule />
    </AdminModuleGuard>
  );
}
