/**
 * Reglas de los movimientos de inventario del calendario (entregas y devoluciones
 * previstas). Un movimiento previsto solo "vence" si el evento sigue vivo: uno
 * cancelado o completado, o una asignación que nunca salió de un evento ya pasado,
 * no es una alerta, así que no se muestra.
 */
export type PlannedMovementInput = {
  eventStatus: string;
  /** Unidades ya despachadas de la asignación. */
  sent: number;
  /** Último momento del evento (desmontaje, fin o inicio), si lo tiene. */
  eventEnd: Date | null;
  now: Date;
};

export function plannedMovementVisible({ eventStatus, sent, eventEnd, now }: PlannedMovementInput): boolean {
  if (eventStatus === "CANCELLED" || eventStatus === "COMPLETED") return false;
  if (sent === 0 && eventEnd && eventEnd.getTime() < now.getTime()) return false;
  return true;
}

export const CALENDAR_MOVEMENTS_LIMIT = 600;

/** El `take` pidió uno de más: si llegó, el rango tiene más movimientos de los que se muestran. */
export function truncateMovements<T>(rows: readonly T[], limit = CALENDAR_MOVEMENTS_LIMIT): { rows: T[]; truncated: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), truncated: true } : { rows: [...rows], truncated: false };
}
