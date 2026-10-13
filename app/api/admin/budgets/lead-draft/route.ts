import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { findMatchingClient } from "@/lib/server/lead-client";
import { leadBudgetDraft } from "@/lib/lead-budget-draft";
import { roleCan } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/budgets/lead-draft?leadId=…` (Lead → Presupuesto).
 *
 * Datos para precargar el alta de presupuesto desde un lead: título, notas del
 * pedido, cliente ya existente (sin crearlo) y presupuestos previos del lead.
 * Exige `budgets.write` y acota el lead a la empresa activa (404 si es de otra).
 * No devuelve datos personales más allá del cliente que el panel ya muestra.
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;
  const leadId = new URL(request.url).searchParams.get("leadId")?.trim() ?? "";
  if (!leadId) return jsonError("Falta el lead.", 400);
  const lead = await db.lead.findFirst({
    where: { id: leadId, organizationId },
    include: { quoteRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { eventDate: true, location: true, createdAt: true } } },
  });
  if (!lead) return jsonError("El lead no existe en esta empresa.", 404);
  const [candidates, existingBudgets] = await Promise.all([
    db.client.findMany({
      where: { organizationId, OR: [{ email: { not: null } }, { phone: { not: null } }] },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, name: true, company: true, email: true, phone: true },
    }),
    db.budget.findMany({ where: { organizationId, leadId: lead.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, createdAt: true } }),
  ]);
  const match = findMatchingClient(candidates, lead);
  const draft = leadBudgetDraft({
    name: lead.name,
    company: lead.company,
    reason: lead.reason,
    message: lead.message,
    eventDate: lead.eventDate ?? lead.quoteRequests[0]?.eventDate ?? null,
    location: lead.location ?? lead.quoteRequests[0]?.location ?? null,
  });
  return Response.json({
    lead: { id: lead.id, name: lead.name, company: lead.company, status: lead.status, createdAt: lead.createdAt },
    title: draft.title,
    notes: draft.notes,
    eventDate: draft.eventDate,
    client: match ? { id: match.id, name: match.name, company: match.company } : null,
    canCreateClient: roleCan(user.role, "clients.write"),
    existingBudgets,
  });
}
