import type { Metadata } from "next";
import { EventosModule } from "@/components/admin/modules/EventosModule";

export const metadata: Metadata = { title: "Eventos" };

export default function EventosPage() {
  return <EventosModule />;
}
