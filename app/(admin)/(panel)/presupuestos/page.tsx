import type { Metadata } from "next";
import { PresupuestosModule } from "@/components/admin/modules/PresupuestosModule";

export const metadata: Metadata = { title: "Presupuestos" };

export default function PresupuestosPage() {
  return <PresupuestosModule />;
}
