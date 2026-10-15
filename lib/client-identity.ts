import { DELETED_SUFFIX } from "./deleted-label";

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

/** Presentación del panel. No cambia nombres históricos, fiscales ni snapshots. */
export type ClientPresentationInput = ClientIdentity & {
  contactName?: string | null;
  type?: string | null;
  deletedAt?: string | Date | null;
};

export function clientPresentation(client: ClientPresentationInput) {
  const normalized = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ") || "";
  const sourceName = normalized(client.tradeName) || normalized(client.company) || normalized(client.name);
  // DTOs históricos marcan sólo name; la presentación comercial debe conservar esa marca.
  const deleted = Boolean(client.deletedAt) || normalized(client.name).endsWith(DELETED_SUFFIX);
  const primary = deleted && !sourceName.endsWith(DELETED_SUFFIX) ? `${sourceName}${DELETED_SUFFIX}` : sourceName;
  const baseName = sourceName.endsWith(DELETED_SUFFIX) ? sourceName.slice(0, -DELETED_SUFFIX.length) : sourceName;
  const same = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" }) === 0;
  // name es histórico y puede ser otra empresa: no inferir una persona encargada.
  const contact = normalized(client.contactName);
  const responsible = contact && !same(contact, baseName) ? contact : null;
  const category = client.type === "RESELLER" ? "Mayorista" : client.type === "FINAL" ? "Cliente final" : null;
  return { primary, responsible, category, description: [responsible, category].filter(Boolean).join(" · ") };
}
