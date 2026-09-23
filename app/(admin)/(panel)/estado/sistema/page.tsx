import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { EstadoModule } from "@/components/admin/modules/EstadoModule";

export const metadata: Metadata = { title: "Estado · Sistema" };

/** Estado del sistema (issue #43): respaldo, base y migraciones. Solo OWNER/ADMIN. */
export default function EstadoSistemaPage() {
  return (
    <AdminModuleGuard href="/estado/sistema">
      <EstadoModule section="sistema" />
    </AdminModuleGuard>
  );
}
