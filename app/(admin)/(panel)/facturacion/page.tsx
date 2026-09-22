import type { Metadata } from "next";
import { FacturacionModule } from "@/components/admin/modules/FacturacionModule";

export const metadata: Metadata = { title: "Facturación" };

export default function FacturacionPage() {
  return <FacturacionModule />;
}
