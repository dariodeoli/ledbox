import type { Metadata } from "next";
import { PlantillasModule } from "@/components/admin/modules/PlantillasModule";
export const metadata: Metadata = { title: "Mensajes de clientes" };
export default function ClientesMensajesPage() { return <PlantillasModule />; }
