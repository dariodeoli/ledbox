import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Tienda web" };

/** Tienda web: encendido, precios, portada, color de marca y contacto. Solo OWNER/ADMIN. */
export default function AjustesTiendaPage() {
  return (
    <AdminModuleGuard href="/ajustes/tienda">
      <AjustesModule section="tienda" />
    </AdminModuleGuard>
  );
}
