/** Revisión indicativa del envío: nunca acredita una reserva ni aprobación. */
export type SendAvailabilityWarning = {
  code: "dates" | "manual" | "pending_count" | "incomplete_game" | "external" | "shortage" | "no_items";
  itemId: string | null;
  inventoryId?: string;
  name: string;
  message: string;
  requested?: number;
  /** null significa desconocido; cero sólo se usa con un conteo confirmado. */
  available?: number | null;
};
export type BudgetSendAvailability = {
  state: "available" | "shortage" | "unverified" | "incomplete" | "error";
  checkedAt: string;
  revision: string;
  range: { startsAt: string; endsAt: string } | null;
  checkedLines: number;
  unlinkedLines: number;
  warnings: SendAvailabilityWarning[];
};
export const SEND_AVAILABILITY_NOTICE = "Es una comprobación de este momento. Enviar no aprueba ni reserva inventario.";
export const SEND_AVAILABILITY_CONSENT = "Enviar como propuesta con disponibilidad por confirmar";
export const sendAvailabilityLabel = (state: BudgetSendAvailability["state"]): string => ({
  available: "Disponibilidad indicativa comprobada",
  shortage: "Hay faltantes para estas fechas",
  unverified: "Disponibilidad por confirmar",
  incomplete: "Hay juegos por completar",
  error: "No pudimos comprobar la disponibilidad",
})[state];
