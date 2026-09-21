import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { recordAudit, portalAuditContext } from "@/lib/server/audit";
import { loadPublicBudget, portalProofUpload, PORTAL_MAX_NAME } from "@/lib/server/budget-portal";
import { jsonError } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { normalizeBudgetCode } from "@/lib/public-config";
import { detectPaymentProofMime, PAYMENT_PROOF_MAX_BYTES } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/portal/budget/[token]/proof` (issue #17): el cliente sube el
 * comprobante de pago desde el portal, sin sesión: el código del link es la
 * única credencial y el pedido va con rate limit por IP.
 *
 * Recibe `multipart/form-data` con `file` (JPG, PNG, WebP o PDF, hasta 2 MB ya
 * comprimido en el navegador) y `name` (quién lo sube). El tipo se decide por
 * **magic bytes**: ni el MIME declarado ni la extensión cuentan, así un
 * ejecutable renombrado a .jpg se rechaza (400).
 *
 * Ventana (documentada en `portalProofUpload`): presupuesto abierto y aprobado o
 * con un cobro a plazo pendiente; fuera de eso responde 409 y el portal ni
 * dibuja el formulario.
 *
 * Vinculación: si el presupuesto tiene exactamente un cobro pendiente, el
 * comprobante se asocia a ese cobro —así Finanzas lo ve en la fila del cobro—;
 * con cero o varios pendientes queda a nivel del presupuesto. El binario nunca
 * se devuelve: la respuesta trae la vista pública actualizada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:proof:${getClientIp(request)}`, 20);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const { token } = await params;
  const code = normalizeBudgetCode(token);
  const budget = code
    ? await db.budget.findUnique({
        where: { publicToken: code },
        select: {
          id: true,
          title: true,
          status: true,
          approvedAt: true,
          organizationId: true,
          client: { select: { name: true, company: true, email: true } },
          payments: { where: { status: "PENDING" }, select: { id: true } },
        },
      })
    : null;
  if (!budget) return jsonError("No encontramos ese presupuesto.", 404);

  const upload = portalProofUpload({
    status: budget.status,
    approvedAt: budget.approvedAt,
    pendingPayments: budget.payments.length,
  });
  if (!upload.allowed) return jsonError(upload.reason ?? "Este presupuesto no recibe comprobantes.", 409);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer el archivo enviado.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Adjuntá el comprobante (JPG, PNG, WebP o PDF).", 400);
  if (file.size === 0) return jsonError("El archivo está vacío; probá de nuevo.", 400);
  if (file.size > PAYMENT_PROOF_MAX_BYTES) {
    return jsonError("El archivo supera los 2 MB; comprimilo o sacá la foto de nuevo.", 400);
  }

  const name = typeof form.get("name") === "string" ? String(form.get("name")).trim() : "";
  if (name.length < 3) return jsonError("Ingresá tu nombre y apellido.", 400);
  if (name.length > PORTAL_MAX_NAME) return jsonError(`El nombre no puede superar los ${PORTAL_MAX_NAME} caracteres.`, 400);

  const data = new Uint8Array(await file.arrayBuffer());
  const mime = detectPaymentProofMime(data);
  if (!mime) {
    return jsonError("El archivo no es un JPG, PNG, WebP o PDF real. Revisá que no esté renombrado.", 400);
  }

  const linkedPaymentId = budget.payments.length === 1 ? budget.payments[0].id : null;
  const proof = await db.budgetPaymentProof.create({
    data: {
      id: randomUUID(),
      organizationId: budget.organizationId,
      budgetId: budget.id,
      paymentId: linkedPaymentId,
      uploadedByName: name,
      mime,
      size: data.byteLength,
      data,
    },
    select: { id: true },
  });

  const payload = await loadPublicBudget(code);
  if (!payload) return jsonError("No encontramos ese presupuesto.", 404);

  await recordAudit({
    context: portalAuditContext(budget.organizationId, name, budget.client?.email),
    action: "create",
    entity: "BudgetPaymentProof",
    entityId: proof.id,
    summary: `El cliente «${name}» subió el comprobante de pago del presupuesto «${budget.title}» desde el portal`,
    detail: {
      fields: {
        budgetId: budget.id,
        mime,
        size: data.byteLength,
        ...(linkedPaymentId ? { paymentId: linkedPaymentId } : {}),
      },
    },
  });

  return Response.json({ budget: payload, proof: { id: proof.id } }, { status: 201 });
}
