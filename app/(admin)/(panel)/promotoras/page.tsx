import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { PromotorasModule } from "@/components/admin/modules/PromotorasModule";

export const metadata: Metadata = { title: "Promotoras" };

export default function PromotorasPage() {
  return (
    <AdminModuleGuard href="/promotoras">
      <PromotorasModule />
    </AdminModuleGuard>
  );
}
