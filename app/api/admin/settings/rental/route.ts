import { auditChanges, recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import {
  RENTAL_SETTINGS_FIELDS,
  getRentalSettings,
  parseRentalSettingsPatch,
  saveRentalSettings,
} from "@/lib/server/rental-settings";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PATCH /api/admin/settings/rental`: ajustes de alquiler de la empresa
 * activa (seña, vigencia de la retención, tiempos de preparación, catálogo
 * público y WhatsApp). Solo OWNER y ADMIN; el resto responde 403. Siempre se
 * lee y se escribe la fila de la empresa de la sesión: un `organizationId` ajeno
 * en la consulta o el cuerpo responde 404, nunca toca otra empresa.
 */

function ownerOrAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  if (!ownerOrAdmin(auth.context.role)) return jsonError("Forbidden", 403);
  const requested = new URL(request.url).searchParams.get("organizationId");
  if (requested && requested !== auth.context.organizationId) return jsonError("La empresa no existe.", 404);
  return Response.json({ settings: await getRentalSettings(auth.context.organizationId) });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  if (!ownerOrAdmin(auth.context.role)) return jsonError("Forbidden", 403);
  const { organizationId } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (body && body.organizationId !== undefined && body.organizationId !== organizationId) {
    return jsonError("La empresa no existe.", 404);
  }
  const parsed = parseRentalSettingsPatch(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  if (parsed.data.trashPurgeDays !== undefined) {
    const trashAuth = await requireAdminContext("trash.manage");
    if (!trashAuth.ok) return trashAuth.response;
  }

  const before = await getRentalSettings(organizationId);
  const settings = await saveRentalSettings(organizationId, parsed.data);
  const changes = auditChanges({ ...before }, { ...settings }, RENTAL_SETTINGS_FIELDS);
  if (changes) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: changes.trashPurgeDays
        ? `Cambió el vaciado automático de la papelera: ${changes.trashPurgeDays.to ? `a ${changes.trashPurgeDays.to} días` : "desactivado"}`
        : "Actualizó los ajustes de alquiler de la empresa",
      detail: { changes },
    });
  }
  return Response.json({ settings });
}
