import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Usuarios" };

/** Usuarios e invitaciones del equipo (issue #31). Solo OWNER/ADMIN. */
export default function AjustesUsuariosPage() {
  return (
    <AdminModuleGuard href="/ajustes/usuarios">
      <AjustesModule section="usuarios" />
    </AdminModuleGuard>
  );
}
