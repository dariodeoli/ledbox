/** Proyección comercial común: nunca se seleccionan bytes de imagen ni notas. */
export const CLIENT_IDENTITY_SELECT = {
  id: true, name: true, company: true, tradeName: true, legalName: true,
  contactName: true, type: true, logo: { select: { updatedAt: true } },
} as const;

export function clientIdentityDTO<T extends { logo?: { updatedAt: Date } | null }>(row: T) {
  const { logo, ...client } = row;
  return { ...client, logoUpdatedAt: logo?.updatedAt.toISOString() ?? null };
}
