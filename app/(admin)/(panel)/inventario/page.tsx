import type { Metadata } from "next";
import { InventarioModule } from "@/components/admin/modules/InventarioModule";

export const metadata: Metadata = { title: "Inventario" };

export default function InventarioPage() {
  return <InventarioModule />;
}
