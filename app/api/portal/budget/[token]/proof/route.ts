import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { recordAudit, portalAuditContext } from "@/lib/server/audit";
import { loadPublicBudget, portalProofUpload, PORTAL_MAX_NAME } from "@/lib/server/budget-portal";
import { isDemoOrganizationId } from "@/lib/server/demo-data";
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
 * comprimido en el navegador), `name` (quién lo sube) y, opcionalmente,
 * `expectedPaymentId` (el concepto del plan que está pagando, issue #28).
 *
 * El tipo se decide por **magic bytes**: ni el MIME declarado ni la extensión
 * cuentan, así un ejecutable renombrado a .jpg se rechaza (400).
 *
 * Ventana (documentada en `portalProofUpload`): presupuesto abierto y aprobado o
 * con un cobro a plazo pendiente; fuera de eso responde 409 y el portal ni
 * dibuja el formulario.
 *
 * Vinculación (issue #28): si el cliente elige el concepto, el comprobante se
 * ata a ese pago esperado y lo deja en `PROOF`; sin elección explícita se usa el
 * único pago esperado abierto (si hay uno solo). Si el presupuesto tiene
 * exactamente un cobro pendiente, el comprobante también se asocia a ese cobro
 * —así Finanzas lo ve en la fila del cobro y confirmar cobra ese pago en vez de
 * duplicarlo—. El binario nunca se devuelve: la respuesta trae la vista pública
 * actualizada.
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
          expectedPayments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, label: true, status: true },
          },
        },
      })
    : null;
  if (!budget) return jsonError("No encontramos ese presupuesto.", 404);
  // Issue #52: la empresa demo no escribe; el portal simula el comprobante en el navegador.
  if (await isDemoOrganizationId(budget.organizationId)) return jsonError("Modo demo: solo lectura", 403);

  const openExpected = budget.expectedPayments.filter(
    (expected) => expected.status === "AWAITING" || expected.status === "PROOF",
  );
  const upload = portalProofUpload({
    status: budget.status,
    approvedAt: budget.approvedAt,
    pendingPayments: budget.payments.length,
    expectedPayments: budget.expectedPayments.length,
    openExpectedPayments: openExpected.length,
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

  // Concepto elegido en el portal: tiene que ser un pago esperado abierto de
  // este presupuesto (nunca de otro).
  const requestedExpectedId = typeof form.get("expectedPaymentId") === "string" ? String(form.get("expectedPaymentId")).trim() : "";
  const expectedPayment = requestedExpectedId
    ? openExpected.find((expected) => expected.id === requestedExpectedId) ?? null
    : openExpected.length === 1
      ? openExpected[0] ?? null
      : null;
  if (requestedExpectedId && !expectedPayment) {
    return jsonError("Ese pago ya no está pendiente: actualizá la página y elegí de nuevo.", 409);
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const mime = detectPaymentProofMime(data);
  if (!mime) {
    return jsonError("El archivo no es un JPG, PNG, WebP o PDF real. Revisá que no esté renombrado.", 400);
  }

  // Un solo cobro pendiente: el comprobante también se cuelga de él para que
  // Finanzas cobre ese pago (y no cree uno nuevo) al confirmar el esperado.
  const linkedPaymentId = budget.payments.length === 1 ? budget.payments[0].id : null;
  const proofId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.budgetPaymentProof.create({
      data: {
        id: proofId,
        organizationId: budget.organizationId,
        budgetId: budget.id,
        paymentId: linkedPaymentId,
        uploadedByName: name,
        mime,
        size: data.byteLength,
        data,
      },
    });
    if (expectedPayment) {
      await tx.expectedPayment.update({
        where: { id: expectedPayment.id },
        data: {
          status: "PROOF",
          proofId,
          // La observación anterior ya fue respondida con este comprobante: el
          // motivo queda en la auditoría y en el historial del comprobante viejo.
          reviewNote: null,
          reviewedAt: null,
          reviewedByName: null,
        },
      });
    }
  });

  const payload = await loadPublicBudget(code);
  if (!payload) return jsonError("No encontramos ese presupuesto.", 404);

  await recordAudit({
    context: portalAuditContext(budget.organizationId, name, budget.client?.email),
    action: "create",
    entity: "BudgetPaymentProof",
    entityId: proofId,
    summary: expectedPayment
      ? `El cliente «${name}» subió el comprobante de «${expectedPayment.label}» del presupuesto «${budget.title}» desde el portal`
      : `El cliente «${name}» subió el comprobante de pago del presupuesto «${budget.title}» desde el portal`,
    detail: {
      fields: {
        budgetId: budget.id,
        mime,
        size: data.byteLength,
        ...(linkedPaymentId ? { paymentId: linkedPaymentId } : {}),
        ...(expectedPayment ? { expectedPaymentId: expectedPayment.id, concepto: expectedPayment.label } : {}),
      },
    },
  });

  return Response.json({ budget: payload, proof: { id: proofId } }, { status: 201 });
}
