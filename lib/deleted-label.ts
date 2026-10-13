/**
 * Rótulo «(eliminado)» (docs/PAPELERA.md): cobros, por cobrar y gastos siguen mostrando el
 * cliente o proveedor de una fila aunque esté en la papelera, pero lo marcan. Se usa sobre
 * lo que ya se lee con `include` anidado (que no filtra lo eliminado): incluir `deletedAt` en el `select`.
 */
export const DELETED_SUFFIX = " (eliminado)";

type Labelable = { name: string; deletedAt?: Date | string | null };

export function deletedLabel(name: string, deletedAt: Date | string | null | undefined): string {
  return deletedAt ? `${name}${DELETED_SUFFIX}` : name;
}

/** Copia la fila con el nombre rotulado si está eliminada; `null` y `undefined` pasan tal cual. */
export function withDeletedLabel<T extends Labelable>(row: T): T;
export function withDeletedLabel<T extends Labelable>(row: T | null | undefined): T | null | undefined;
export function withDeletedLabel<T extends Labelable>(row: T | null | undefined): T | null | undefined {
  if (!row) return row;
  return row.deletedAt ? { ...row, name: deletedLabel(row.name, row.deletedAt) } : row;
}
