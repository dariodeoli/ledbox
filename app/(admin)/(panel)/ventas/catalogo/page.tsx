import type { Metadata } from "next";
import { CatalogoVentaModule } from "@/components/admin/modules/CatalogoVentaModule";

export const metadata: Metadata = { title: "Catálogo de venta" };

export default function CatalogoVentaPage() {
  return <CatalogoVentaModule />;
}
