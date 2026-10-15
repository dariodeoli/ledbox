/**
 * Quién puede ver la foto de una categoría: la tienda pública solo si la empresa
 * está activa y la categoría no está archivada; con la empresa inactiva, solo una
 * sesión del panel de esa misma empresa.
 */
export function categoryImageServable(input: {
  organizationActive: boolean;
  archived: boolean;
  organizationId: string;
  /** Empresa de la sesión del panel, si hay una. */
  sessionOrganizationId?: string | null;
}): boolean {
  if (input.archived) return false;
  if (input.organizationActive) return true;
  return Boolean(input.sessionOrganizationId) && input.sessionOrganizationId === input.organizationId;
}
