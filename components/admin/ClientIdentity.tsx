"use client";

import { clientPresentation, type ClientPresentationInput } from "@/lib/client-identity";
import { clientLogoUrl } from "@/lib/admin-types";
import { AdminAvatar } from "./AdminAvatar";
import type { ComboboxOption } from "./AdminFields";

export type ClientVisualIdentity = ClientPresentationInput & { id: string; logoUpdatedAt?: string | null };

/** Único avatar de cliente: logo privado → iniciales; el fallback vive en AdminAvatar. */
export function ClientAvatar({ client, size = 22, title }: { client: ClientVisualIdentity; size?: 22 | 40 | 64; title?: string }) {
  const { primary } = clientPresentation(client);
  return <AdminAvatar name={primary} src={client.logoUpdatedAt ? clientLogoUrl(client.id, client.logoUpdatedAt) : null} size={size} title={title ?? primary} className="admin-avatar--logo" />;
}

/** Identidad comercial + responsable + segmento, sin repetir el mismo nombre. */
export function ClientIdentityView({ client, size = 22 }: { client: ClientVisualIdentity; size?: 22 | 40 | 64 }) {
  const identity = clientPresentation(client);
  return <span className="admin-client-identity" title={[identity.primary, identity.description].filter(Boolean).join(" · ")}>
    <ClientAvatar client={client} size={size} />
    <span className="admin-client-identity-copy"><strong>{identity.primary}</strong>{identity.description ? <small>{identity.responsible}{identity.responsible && identity.category ? " · " : ""}{identity.category ? <span className="admin-client-identity-type">{identity.category}</span> : null}</small> : null}</span>
  </span>;
}

/** El valor sigue siendo ID; label/description/keywords siguen siendo texto accesible y buscable. */
export function clientComboboxOption(client: ClientVisualIdentity): ComboboxOption {
  const identity = clientPresentation(client);
  return { value: client.id, label: identity.primary, description: identity.description,
    keywords: [client.name, client.company, client.tradeName, client.legalName, client.contactName].filter(Boolean).join(" "),
    content: <ClientIdentityView client={client} /> };
}
