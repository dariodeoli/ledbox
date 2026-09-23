import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import {
  BUDGET_ATTACHMENT_MAX_BYTES,
  BUDGET_ATTACHMENT_MAX_NAME,
  detectPaymentProofMime,
  PAYMENT_PROOF_MIMES,
} from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/budgets/attachments` (issue #65): guarda el archivo original
 * del presupuesto (el PDF del cliente u otro documento de trabajo).
 *
 * Es un adjunto **interno**: el binario vive en la base —mismo patrón que los
 * comprobantes de pago (issue #17), compatible con los backups— y se sirve solo
 * con sesión (`/api/admin/budgets/attachments/[id]`). Nunca se publica en el
 * portal ni en el imprimible. Se valida el contenido real por magic bytes
 * (JPG/PNG/WebP/PDF hasta 5 MiB) y el presupuesto tiene que ser de la empresa
 * activa. La carga queda auditada.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer el archivo enviado.", 400);
  }

  const budgetId = typeof form.get("budgetId") === "string" ? String(form.get("budgetId")).trim() : "";
  if (!budgetId) return jsonError("Elegí el presupuesto del adjunto.", 400);
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { id: true, title: true, client: { select: { name: true, company: true } } },
  });
  if (!budget) return jsonError("No encontramos ese presupuesto.", 404);

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(`Adjuntá un archivo (${PAYMENT_PROOF_MIMES.map((mime) => mime.split("/")[1]).join(", ")}).`, 400);
  if (file.size === 0) return jsonError("El archivo está vacío; probá de nuevo.", 400);
  if (file.size > BUDGET_ATTACHMENT_MAX_BYTES) return jsonError("El adjunto supera los 5 MB.", 400);

  const data = new Uint8Array(await file.arrayBuffer());
  const mime = detectPaymentProofMime(data);
  if (!mime) return jsonError("El archivo no es un JPG, PNG, WebP o PDF real: revisá que no esté renombrado.", 400);

  const requestedName = typeof form.get("name") === "string" ? String(form.get("name")).trim() : "";
  const name = (requestedName || file.name || "adjunto").slice(0, BUDGET_ATTACHMENT_MAX_NAME);

  const attachment = await db.budgetAttachment.create({
    data: {
      id: randomUUID(),
      organizationId,
      budgetId: budget.id,
      uploadedByName: auth.context.user.name,
      name,
      mime,
      size: data.byteLength,
      data,
    },
    select: { id: true, budgetId: true, name: true, mime: true, size: true, uploadedByName: true, createdAt: true },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Budget",
    entityId: budget.id,
    summary: `Adjuntó «${attachment.name}» al presupuesto «${budget.title}» del cliente «${budget.client.company?.trim() || budget.client.name}»`,
    detail: { fields: { adjunto: attachment.name, tipo: mime, tamaño: attachment.size } },
  });
  return Response.json({ attachment }, { status: 201 });
}
