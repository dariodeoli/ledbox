import type { Metadata } from "next";
import { PlantillasModule } from "@/components/admin/modules/PlantillasModule";

export const metadata: Metadata = { title: "Plantillas" };

export default function PlantillasPage() {
  return <PlantillasModule />;
}
