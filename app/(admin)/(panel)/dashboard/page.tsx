import type { Metadata } from "next";
import { ResumenModule } from "@/components/admin/modules/ResumenModule";

export const metadata: Metadata = { title: "Inicio" };

export default function ResumenPage() {
  return <ResumenModule />;
}
