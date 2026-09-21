import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { UsuariosModule } from "@/components/admin/modules/UsuariosModule";

export const metadata: Metadata = { title: "Usuarios" };

export default function UsuariosPage() {
  return (
    <AdminModuleGuard href="/usuarios">
      <UsuariosModule />
    </AdminModuleGuard>
  );
}
