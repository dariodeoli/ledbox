import { getRentalSettings } from "./rental-settings";
import { requireAdminContext } from "./tenancy";
import { loadOrgPresentation } from "./org-presentation";
import { jsonError } from "./http";
import type { PublicCatalogContext } from "./catalog-public";

/** Lab is an authenticated retail preview, never a public catalogue access grant. */
export async function requireStoreLab(organizationId?: string) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") return { ok: false as const, response: jsonError("El laboratorio es sólo para propietarios y administradores.", 403) };
  if (organizationId && auth.context.organizationId !== organizationId) return { ok: false as const, response: jsonError("La empresa activa cambió. Volvé a abrir el laboratorio.", 409) };
  const [settings, presentation] = await Promise.all([getRentalSettings(auth.context.organizationId), loadOrgPresentation(auth.context.organizationId)]);
  const context: PublicCatalogContext = {
    organization: auth.context.organization,
    settings: { ...settings, publicShowPrices: settings.publicShowPrices && presentation.appearance.priceMode !== "quote" },
    demo: true,
    priceList: "RETAIL",
    access: null,
  };
  return { ok: true as const, context };
}
