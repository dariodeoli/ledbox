import { appEmailSender, emailConfigured, MAIL_CATEGORIES, missingApiKeyMessage } from "@/lib/server/mail";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuántos envíos muestra el historial de Configuración → Correo. */
const HISTORY_LIMIT = 30;

/**
 * `GET /api/admin/mail` (issue #31): estado del correo de la empresa activa.
 *
 * Devuelve el remitente configurado, si `RESEND_API_KEY` está presente (con el
 * texto de qué configurar cuando falta) y los últimos envíos de la empresa
 * desde el historial `MailLog` (fecha, destinatario, categoría, estado, asunto
 * y motivo del fallo). Los correos de plataforma sin empresa no aparecen.
 *
 * Capacidad `org.manage`: Configuración → Correo es OWNER/ADMIN, igual que
 * Empresa; el resto de los roles recibe 403.
 */
export async function GET() {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const configured = emailConfigured();

  const history = await db.mailLog.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      category: true,
      status: true,
      to: true,
      subject: true,
      error: true,
      providerId: true,
      entity: true,
      entityId: true,
      actorName: true,
      actorEmail: true,
      sentAt: true,
      createdAt: true,
    },
  });

  return Response.json({
    mail: {
      provider: "Resend",
      sender: appEmailSender(),
      configured,
      envVar: "RESEND_API_KEY",
      hint: configured
        ? null
        : `${missingApiKeyMessage()} El remitente se define con EMAIL_FROM (default: ${appEmailSender()}).`,
      categories: MAIL_CATEGORIES,
    },
    history,
  });
}
