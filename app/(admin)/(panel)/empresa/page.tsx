import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { EmpresaModule } from "@/components/admin/modules/EmpresaModule";

export const metadata: Metadata = { title: "Empresa" };

/** Empresa (issue #22): nombre y logos de la empresa activa. Solo OWNER/ADMIN. */
export default function EmpresaPage() {
  return (
    <AdminModuleGuard href="/empresa">
      <EmpresaModule />
    </AdminModuleGuard>
  );
}
