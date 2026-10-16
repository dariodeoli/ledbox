/** Revisión indicativa del envío: nunca acredita una reserva ni aprobación. */
export type SendAvailabilityWarning = {
  code: "dates" | "manual" | "pending_count" | "incomplete_game" | "external" | "shortage" | "no_items" | "operational";
  itemId: string | null;
  inventoryId?: string;
  name: string;
  message: string;
  requested?: number;
  /** null significa desconocido; cero sólo se usa con un conteo confirmado. */
  available?: number | null;
};
export type BudgetSendAvailabilityLine = {
  itemId: string; inventoryId: string | null; sku: string | null; name: string; requested: number;
  state: "available" | "shortage" | "unverified" | "incomplete" | "excluded";
  /** Capacidad para el grupo calculado, no stock libre adicional ni reserva guardada. */
  available: number | null;
  covered: number | null;
  groupId: string | null; groupRequested: number | null; sharedGroup: boolean;
  reason: string;
  range: { startsAt: string; endsAt: string } | null;
};
export type BudgetSendAvailability = {
  lines: BudgetSendAvailabilityLine[];
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

export const sendAvailabilityLineLabel = (state: BudgetSendAvailabilityLine["state"]): string => ({
  available: "Alcanza para el grupo", shortage: "Faltante en el grupo", unverified: "Por confirmar", incomplete: "Juego incompleto", excluded: "Excluido",
})[state];
