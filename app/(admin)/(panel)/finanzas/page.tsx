import type { Metadata } from "next";
import { FinanzasModule } from "@/components/admin/modules/FinanzasModule";

export const metadata: Metadata = { title: "Finanzas" };

export default function FinanzasPage() {
  return <FinanzasModule />;
}
