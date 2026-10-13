import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Eliminados" };

/** Papelera: lo eliminado, restaurar y borrado definitivo o anonimizado. Solo OWNER/ADMIN (`trash.manage`). */
export default function AjustesEliminadosPage() {
  return (
    <AdminModuleGuard href="/ajustes/eliminados">
      <AjustesModule section="eliminados" />
    </AdminModuleGuard>
  );
}
