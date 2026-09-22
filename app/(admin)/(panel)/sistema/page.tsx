import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { SistemaModule } from "@/components/admin/modules/SistemaModule";

export const metadata: Metadata = { title: "Sistema" };

/** Estado del sistema (issue #43): respaldo, base y migraciones. Solo OWNER/ADMIN. */
export default function SistemaPage() {
  return (
    <AdminModuleGuard href="/sistema">
      <SistemaModule />
    </AdminModuleGuard>
  );
}
