import { formatDateTime } from "@/lib/admin-format";
import { publicConfig } from "@/lib/public-config";
import { recordAudit } from "@/lib/server/audit";
import { appEmailSender, emailConfigured, missingApiKeyMessage, renderMail, renderMailText, sendMail } from "@/lib/server/mail";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Envíos de prueba por usuario y ventana (evita ráfagas desde el panel). */
const TEST_LIMIT = 5;

/**
 * `POST /api/admin/mail/test` (issue #30): manda el correo de prueba al usuario
 * logueado y devuelve el **resultado real** del proveedor.
 *
 * - Sin `RESEND_API_KEY` responde `skipped` con qué configurar (no rompe nada y
 *   no intenta el envío).
 * - Con clave, el estado es `sent` o `failed` con el error del proveedor tal
 *   cual; todo queda en el historial (`MailLog`) y en la auditoría.
 * - Capacidad `org.manage`: OWNER/ADMIN. La demo (solo lectura) recibe 403.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, user, organization } = auth.context;

  const limited = await rateLimit(`mail:test:${getClientIp(request)}:${user.id}`, TEST_LIMIT);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  if (!emailConfigured()) {
    return Response.json({
      status: "skipped",
      error: missingApiKeyMessage(),
      to: user.email,
      configured: false,
    });
  }

  const content = {
    title: "Correo de prueba",
    intro: [
      `Hola ${user.name}:`,
      `Este es un correo de prueba enviado desde Configuración → Correo de ${organization.name}.`,
    ],
    rows: [
      { label: "Empresa", value: organization.name },
      { label: "Remitente", value: appEmailSender() },
      { label: "Enviado", value: formatDateTime(new Date()), strong: true },
    ],
    cta: { label: "Abrir EventOS", url: publicConfig.adminUrl },
    note: "Si estás leyendo esto, el envío de correo del panel está funcionando. El intento queda en el historial de Configuración → Correo.",
    preheader: "Prueba de envío del panel · LedBox",
    eyebrow: "Configuración · correo",
    status: { label: "Prueba de envío" },
    organization: organization.name,
    reason: `pediste una prueba de la configuración de correo de ${organization.name}`,
  };

  const result = await sendMail({
    to: user.email,
    subject: `Correo de prueba · ${organization.name}`,
    category: "test",
    html: renderMail(content),
    text: renderMailText(content),
    organizationId,
    entity: "Organization",
    entityId: organizationId,
    actor: user,
  });

  await recordAudit({
    context: auth.context,
    action: "send",
    entity: "Organization",
    entityId: organizationId,
    summary:
      result.status === "sent"
        ? `Envió un correo de prueba a ${user.email}`
        : `Falló el correo de prueba a ${user.email}: ${result.error ?? "sin detalle"}`,
    detail: { fields: { to: user.email, category: "test", status: result.status, ...(result.error ? { error: result.error } : {}) } },
  });

  return Response.json({
    status: result.status,
    error: result.error ?? null,
    to: user.email,
    subject: `Correo de prueba · ${organization.name}`,
    sentAt: new Date().toISOString(),
    logId: result.logId ?? null,
  });
}
