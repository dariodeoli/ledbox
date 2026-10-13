/** Etiqueta del incidente retenido por cantidad en un ítem que sí tiene unidades. */
export const UNIDENTIFIED_UNIT_LABEL = "Unidad sin identificar";

export function isUnidentifiedUnitIncident(incident: {
  heldByQuantity?: boolean;
  unitId?: string | null;
  inventory: { _count?: { units: number } };
}): boolean {
  return incident.heldByQuantity === true && !incident.unitId && (incident.inventory._count?.units ?? 0) > 0;
}
