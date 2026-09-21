import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AuditoriaModule } from "@/components/admin/modules/AuditoriaModule";

export const metadata: Metadata = { title: "Auditoría" };

export default function AuditoriaPage() {
  return (
    <AdminModuleGuard href="/auditoria">
      <AuditoriaModule />
    </AdminModuleGuard>
  );
}
