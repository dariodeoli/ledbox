/** Identidad comercial explícita; no convierte datos históricos ni fiscales. */
export type ClientIdentity = {
  name: string;
  tradeName?: string | null;
  legalName?: string | null;
  company?: string | null;
};

export function clientDisplayName(client: ClientIdentity): string {
  return client.tradeName?.trim() || client.name;
}

/** company mantiene su semántica histórica: no es una razón social inferida. */
export function clientLegalName(client: ClientIdentity): string | null {
  return client.legalName?.trim() || null;
}
