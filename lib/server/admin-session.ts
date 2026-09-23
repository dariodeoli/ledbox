import { db } from "@/lib/server/db";
import { loadOrganizationLogos, logoVersions } from "@/lib/server/branding";
import { loadAdminSecurity } from "@/lib/server/pin";
import { listAdminOrganizations, type AdminContext } from "@/lib/server/tenancy";
import type { AdminSessionPayload } from "@/lib/admin-types";

/**
 * Payload de la sesión del panel (issue #21), en un solo lugar: lo devuelve
 * `GET /api/admin/session` y lo embebe el layout del panel para que el shell
 * arranque con la sesión ya resuelta (issue #61: sin esqueleto ni pedido fijo).
 *
 * El shape es JSON puro (sin `Date`): el shell lo lee con el mismo parser que la
 * respuesta del API (`pickSessionData`), así no hay dos contratos.
 */
export async function buildAdminSessionPayload(context: AdminContext): Promise<AdminSessionPayload> {
  const { user, organization, role, demo } = context;
  const [organizations, avatar, logos, security] = await Promise.all([
    listAdminOrganizations(user.id),
    db.adminUserAvatar.findUnique({ where: { userId: user.id }, select: { updatedAt: true } }),
    loadOrganizationLogos(organization.id),
    loadAdminSecurity(user.id),
  ]);
  return {
    // El avatar (issue #22) viaja con la fecha de subida: el chip arma la URL con
    // esa versión y refresca la foto cuando el usuario la cambia.
    user: { ...user, avatarUpdatedAt: avatar?.updatedAt.toISOString() ?? null },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role,
      // Logos de la empresa por tema: el shell elige la variante según el tema.
      logos: logoVersions(logos),
    },
    organizations,
    // La sesión demo se marca para que el shell muestre el aviso de solo lectura.
    demo,
    // Bloqueo por PIN (issue #21): estado de la sesión + preferencia del usuario.
    // La demo no usa PIN ni bloqueo (no tiene preferencia que aplicar). El motivo
    // solo viaja con un bloqueo vigente; desbloqueada, la pantalla no aplica.
    locked: context.session.lockedAt !== null,
    lockReason: context.session.lockedAt ? (context.session.lockReason === "manual" ? "manual" : "inactivity") : null,
    lock: security,
  };
}
