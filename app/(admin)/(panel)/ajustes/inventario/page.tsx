import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Inventario" };

/** Inventario: categorías, subcategorías y depósitos. Solo OWNER/ADMIN. */
export default function AjustesInventarioPage() {
  return (
    <AdminModuleGuard href="/ajustes/inventario">
      <AjustesModule section="inventario" />
    </AdminModuleGuard>
  );
}
