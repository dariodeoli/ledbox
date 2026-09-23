import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { budgetReference } from "@/lib/admin-format";
import { budgetAttachmentFileName } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/budgets/attachments/[id]` (issue #65): sirve el archivo del
 * adjunto **con sesión** (cualquier rol de la empresa activa, VIEWER incluido:
 * es lectura). Se entrega `inline` con el `Content-Type` real validado al
 * subirlo, un nombre de archivo estable y `no-store`: un documento de trabajo no
 * se cachea en intermediarios. Un id de otra empresa no existe para esta consulta
 * (404), igual que uno inexistente.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const attachment = await db.budgetAttachment.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true, budgetId: true, name: true, mime: true, size: true, data: true },
  });
  if (!attachment) return jsonError("No encontramos ese adjunto.", 404);

  const filename = budgetAttachmentFileName(attachment.name, attachment.mime, budgetReference(attachment.budgetId));
  return new Response(new Uint8Array(attachment.data), {
    status: 200,
    headers: {
      "Content-Type": attachment.mime,
      "Content-Length": String(attachment.size),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * `DELETE /api/admin/budgets/attachments/[id]` (issue #65): borra el adjunto de
 * la empresa activa. Es explícito —el borrado no se deshace— y queda auditado
 * con el nombre del archivo.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const attachment = await db.budgetAttachment.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: {
      id: true,
      budgetId: true,
      name: true,
      budget: { select: { title: true, client: { select: { name: true, company: true } } } },
    },
  });
  if (!attachment) return jsonError("No encontramos ese adjunto.", 404);

  await db.budgetAttachment.delete({ where: { id: attachment.id } });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Budget",
    entityId: attachment.budgetId,
    summary: `Borró el adjunto «${attachment.name}» del presupuesto «${attachment.budget.title}» del cliente «${attachment.budget.client.company?.trim() || attachment.budget.client.name}»`,
    detail: { fields: { adjunto: attachment.name } },
  });
  return Response.json({ attachment: { id: attachment.id, deleted: true } });
}
