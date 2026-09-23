import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Correo" };

/** Correo (issue #30): remitente, prueba e historial de envíos. Solo OWNER/ADMIN. */
export default function AjustesCorreoPage() {
  return (
    <AdminModuleGuard href="/ajustes/correo">
      <AjustesModule section="correo" />
    </AdminModuleGuard>
  );
}
