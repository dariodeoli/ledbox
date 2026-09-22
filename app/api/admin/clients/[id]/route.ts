import { isOverdue } from "@/lib/admin-format";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { clientMetrics } from "../metrics";
import { parseClientFields } from "../client-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/clients/[id]`: ficha 360 del cliente (issue #34) de la empresa
 * activa. Devuelve el cliente con sus métricas reales y los tres hechos que las
 * explican: presupuestos con lo cobrado y lo vencido por presupuesto, eventos
 * con su checklist y cobros con su estado y vencimiento.
 *
 * Es lectura para cualquier rol (VIEWER incluido) y el aislamiento es el de
 * siempre: un id de otra empresa no existe para esta consulta (404). La
 * cronología (issue #33) se enchufa después sobre estos mismos hechos.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { events: true, budgets: true } }, logo: { select: { updatedAt: true } } },
  });
  if (!client) return jsonError("No encontramos ese cliente en la empresa activa.", 404);
  const { logo, ...clientRow } = client;

  const [budgets, events, payments] = await Promise.all([
    db.budget.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        total: true,
        createdAt: true,
        validUntil: true,
        approvedAt: true,
        approvalMethod: true,
        event: { select: { id: true, name: true, startsAt: true, status: true } },
      },
    }),
    db.event.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        name: true,
        location: true,
        startsAt: true,
        endsAt: true,
        status: true,
        createdAt: true,
        tasks: {
          select: { id: true, title: true, type: true, dueAt: true, completedAt: true },
          orderBy: { dueAt: "asc" },
        },
      },
    }),
    db.clientPayment.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        status: true,
        paidAt: true,
        collectedAt: true,
        method: true,
        reference: true,
        budgetId: true,
        invoiceNumber: true,
        invoiceIssuedAt: true,
        dueAt: true,
        chequeDate: true,
        createdAt: true,
        budget: { select: { id: true, title: true } },
      },
    }),
  ]);

  // Cobrado y vencido por presupuesto: mismos cobros que alimentan las métricas
  // del cliente, imputados a su presupuesto cuando lo tienen.
  const byBudget = new Map<string, { collected: number; overdue: number }>();
  for (const payment of payments) {
    if (!payment.budgetId) continue;
    const current = byBudget.get(payment.budgetId) ?? { collected: 0, overdue: 0 };
    if (payment.status === "RECEIVED") current.collected += payment.amount;
    if (payment.status === "PENDING" && isOverdue(payment.dueAt)) current.overdue += payment.amount;
    byBudget.set(payment.budgetId, current);
  }

  const metrics = clientMetrics({ budgets, payments, events });

  return Response.json({
    clientDetail: {
      client: { ...clientRow, logoUpdatedAt: logo?.updatedAt.toISOString() ?? null },
      metrics,
      budgets: budgets.map((budget) => ({
        ...budget,
        collected: byBudget.get(budget.id)?.collected ?? 0,
        overdue: byBudget.get(budget.id)?.overdue ?? 0,
      })),
      events,
      payments,
    },
  });
}

/** Campos que se auditan al editar un cliente (sin el binario del logo). */
const CLIENT_AUDIT_FIELDS = [
  "name",
  "company",
  "type",
  "ruc",
  "email",
  "phone",
  "contactName",
  "contactRole",
  "contactPhone",
  "contactEmail",
  "website",
  "instagram",
  "whatsapp",
  "notes",
] as const;

/**
 * `PATCH /api/admin/clients/[id]`: edita los datos del cliente de la empresa
 * activa (`clients.write`), incluidos los de contacto y los links directos del
 * issue #36. Es parcial: un campo ausente no se toca y vacío lo limpia. Un id de
 * otra empresa responde 404 sin revelar nada; el logo se sube por su endpoint.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;

  const before = await db.client.findFirst({ where: { id, organizationId } });
  if (!before) return jsonError("No encontramos ese cliente en la empresa activa.", 404);

  const parsed = parseClientFields(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const updated = await db.client.update({
    where: { id: before.id },
    data: parsed.data,
    include: { logo: { select: { updatedAt: true } } },
  });
  const { logo, ...clientRow } = updated;

  const changes = auditChanges(before, updated, CLIENT_AUDIT_FIELDS);
  if (changes) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Client",
      entityId: updated.id,
      summary: `Editó el cliente «${updated.name}»`,
      detail: { changes },
    });
  }

  return Response.json({
    client: { ...clientRow, logoUpdatedAt: logo?.updatedAt.toISOString() ?? null },
    unchanged: !changes,
  });
}
