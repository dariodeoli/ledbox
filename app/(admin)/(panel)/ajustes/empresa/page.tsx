import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Empresa" };

/** Empresa (issue #22): nombre y logos de la empresa activa, única edición canónica (issue #56). */
export default function AjustesEmpresaPage() {
  return (
    <AdminModuleGuard href="/ajustes/empresa">
      <AjustesModule section="empresa" />
    </AdminModuleGuard>
  );
}
