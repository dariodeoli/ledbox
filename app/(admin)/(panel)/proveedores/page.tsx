import type { Metadata } from "next";
import { ProveedoresModule } from "@/components/admin/modules/ProveedoresModule";

export const metadata: Metadata = { title: "Proveedores" };

export default function ProveedoresPage() {
  return <ProveedoresModule />;
}
