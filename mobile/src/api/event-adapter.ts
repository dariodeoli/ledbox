import type { MobileEvent, WireEvent } from "./contract";

const labels: Record<string, string> = { DRAFT: "Borrador", CONFIRMED: "Confirmado", IN_PROGRESS: "En curso", COMPLETED: "Finalizado", CANCELLED: "Cancelado" };
export function eventView(event: WireEvent): MobileEvent {
  return { id: event.id, eventId: event.id, kind: "event", name: event.name, statusLabel: labels[event.status] ?? event.status,
    startsAt: event.startsAt, endsAt: event.endsAt, location: event.location, clientName: null };
}
