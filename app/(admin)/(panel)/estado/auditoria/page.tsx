import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { EstadoModule } from "@/components/admin/modules/EstadoModule";

export const metadata: Metadata = { title: "Estado · Auditoría" };

/** Auditoría (issue #43): historial de cambios de la empresa. Solo OWNER/ADMIN. */
export default function EstadoAuditoriaPage() {
  return (
    <AdminModuleGuard href="/estado/auditoria">
      <EstadoModule section="auditoria" />
    </AdminModuleGuard>
  );
}
