import type { Metadata } from "next";
import { AdminModuleGuard } from "@/components/admin/AdminShell";
import { AjustesModule } from "@/components/admin/modules/AjustesModule";

export const metadata: Metadata = { title: "Ajustes · Alquileres" };

/** Alquileres: seña, retenciones, tiempos de preparación y catálogo público. Solo OWNER/ADMIN. */
export default function AjustesAlquileresPage() {
  return (
    <AdminModuleGuard href="/ajustes/alquileres">
      <AjustesModule section="alquileres" />
    </AdminModuleGuard>
  );
}
