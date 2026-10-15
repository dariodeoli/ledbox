import { sandboxHiddenHere } from "@/lib/server/demo-host";
import { withQuoteApproval, QuoteComparisonError } from "@/lib/server/quote-comparison";
import { quotePortalAvailable } from "@/lib/quote-sharing";
import { db } from "@/lib/server/db";
import { recordAudit, portalAuditContext } from "@/lib/server/audit";
import { approvalEvidence, loadPublicBudget, portalBudgetOpen } from "@/lib/server/budget-portal";
import { isDemoOrganizationId } from "@/lib/server/demo-data";
import { jsonError, readJson } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { normalizeBudgetCode } from "@/lib/public-config";
import { reserveBudgetInventory } from "@/lib/server/inventory-availability";
import { ensureEventForApprovedBudget } from "@/lib/server/budget-event";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 120;
const MAX_NOTE = 600;

/**
 * `POST /api/portal/budget/[token]/approve`: aprobación digital del cliente
 * (issue #12). Registra nombre, consentimiento explícito, fecha/hora, IP y
 * user-agent como evidencia y deja el presupuesto en `APPROVED`.
 *
 * Es idempotente: una sola aprobación por presupuesto. Si ya estaba aprobado
 * (por el portal o por el panel) el reintento devuelve la aprobación original
 * sin pisarla.
 *
 * Con la primera aprobación se reserva el stock de los ítems vinculados al
 * inventario usando el rango del evento (issue #18). El conflicto de
 * disponibilidad no bloquea la aprobación: queda auditado con el actor real y
 * el equipo lo ve en los avisos del panel (nunca en la respuesta pública).
 *
 * Al aprobar también se generan los pagos esperados del plan (issue #28):
 * anticipo, cuotas y saldo quedan como `ExpectedPayment` en `AWAITING` para que
 * el portal muestre el estado real de cada concepto y Finanzas los confirme
 * cuando el cliente transfiera.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:approve:${getClientIp(request)}`, 20);
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
          validUntil: true,
          organizationId: true,
          client: { select: { name: true, company: true, email: true } },
        },
      })
    : null;
  if (!budget || !quotePortalAvailable(budget)) return jsonError("No encontramos ese presupuesto.", 404);
  if (await sandboxHiddenHere(budget.organizationId)) return jsonError("No encontramos ese presupuesto.", 404);
  // Issue #52: la empresa demo no escribe. El portal simula la aprobación en el
  // navegador; un POST viejo o de un cliente suelto también queda rechazado.
  if (await isDemoOrganizationId(budget.organizationId)) return jsonError("Modo demo: solo lectura", 403);
  if (!portalBudgetOpen(budget.status)) return jsonError("Este presupuesto ya no está disponible para aprobar.", 409);

  const body = (await readJson(request)) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!body.consent || body.consent !== true) return jsonError("Necesitamos tu consentimiento para registrar la aprobación.", 400);
  if (name.length < 3) return jsonError("Ingresá tu nombre y apellido.", 400);
  if (name.length > MAX_NAME) return jsonError(`El nombre no puede superar los ${MAX_NAME} caracteres.`, 400);
  if (note.length > MAX_NOTE) return jsonError(`El comentario no puede superar los ${MAX_NOTE} caracteres.`, 400);

  // Solo la primera aprobación escribe: el `where` con `approvedAt: null` evita
  // que dos pedidos simultáneos se pisen (el segundo recibe la ya registrada).
  const evidence = approvalEvidence(request);
  let updated: { count: number };
  try { updated = await withQuoteApproval(budget.id, budget.organizationId, (tx) => tx.budget.updateMany({
    where: { id: budget.id, publicToken: code, approvedAt: null, status: { notIn: ["LOST", "CANCELLED"] } },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByName: name,
      approvalMethod: "digital",
      approvalIp: evidence.ip,
      approvalUserAgent: evidence.userAgent,
      approvalNote: note || null,
    },
  }), code!);

  } catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    throw error;
  }
  const payload = await loadPublicBudget(code);
  if (!payload) return jsonError("No encontramos ese presupuesto.", 404);
  if (updated.count > 0) {
    await recordAudit({
      context: portalAuditContext(budget.organizationId, name, budget.client?.email),
      action: "status",
      entity: "Budget",
      entityId: budget.id,
      summary: `El cliente «${name}» aprobó el presupuesto «${budget.title}» desde el portal`,
      detail: { fields: { approvalMethod: "digital" } },
    });
    // Reserva automática del stock comprometido (issue #18). No bloquea la
    // aprobación: los conflictos se auditan y salen en los avisos del panel.
    // Evento automático (CONFIRMED) y su reserva; si falla, la aprobación sigue y queda auditado.
    const auto = await ensureEventForApprovedBudget({
      organizationId: budget.organizationId,
      budgetId: budget.id,
      actor: portalAuditContext(budget.organizationId, name, budget.client?.email),
    });
    if (!auto.reservations) {
      // La aprobación ya está aplicada: una reserva que falla queda pendiente, nunca un 500.
      try {
        await reserveBudgetInventory({
          organizationId: budget.organizationId,
          budgetId: budget.id,
          context: portalAuditContext(budget.organizationId, name, budget.client?.email),
        });
      } catch (error) {
        console.error("[portal/approve] la reserva quedó pendiente", { budgetId: budget.id, error });
      }
    }
    // Pagos esperados del plan (issue #28): el cliente ya puede ver el estado
    // real de cada concepto en el portal y el equipo los confirma en Finanzas.
    await syncBudgetExpectedPayments({
      organizationId: budget.organizationId,
      budgetId: budget.id,
      actor: portalAuditContext(budget.organizationId, name, budget.client?.email),
      reason: "aprobación del cliente",
    });
  }
  return Response.json({ budget: payload, alreadyApproved: updated.count === 0 });
}
