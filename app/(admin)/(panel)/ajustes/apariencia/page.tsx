import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Apariencia" };

/** Apariencia: plantilla, color de marca, tipografía, portada y fondo de las superficies del cliente. Solo OWNER/ADMIN. */
export default function AjustesAparienciaPage() {
  return (
    <AdminModuleGuard href="/ajustes/apariencia">
      <AjustesModule section="apariencia" />
    </AdminModuleGuard>
  );
}
