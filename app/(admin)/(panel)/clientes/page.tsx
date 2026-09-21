import type { Metadata } from "next";
import { ClientesModule } from "@/components/admin/modules/ClientesModule";

export const metadata: Metadata = { title: "Clientes" };

export default function ClientesPage() {
  return <ClientesModule />;
}
