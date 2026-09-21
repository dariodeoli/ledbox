import type { Metadata } from "next";
import { CalendarioModule } from "@/components/admin/modules/CalendarioModule";

export const metadata: Metadata = { title: "Calendario" };

export default function CalendarioPage() {
  return <CalendarioModule />;
}
