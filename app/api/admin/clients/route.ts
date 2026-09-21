import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { clientMetrics, factsByClient, type ClientMetricFacts } from "./metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/clients`: clientes de la empresa activa con sus métricas de
 * la ficha 360 (issue #34). Los hechos se traen mínimos (presupuestos, cobros y
 * eventos) y se resumen con `clientMetrics`, la misma función que usa el
 * detalle: la lista puede ordenar por monto contratado, filtrar «sin compras»,
 * marcar la deuda vencida y mostrar la última actividad sin una segunda llamada
 * a finanzas.
 *
 * `POST`: alta de cliente (`clients.write`).
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const clients = await db.client.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { events: true, budgets: true } } },
  });

  // Solo los hechos de los clientes listados: nada de otra empresa y nada de
  // un cliente que no viaja en la respuesta.
  const clientIds = clients.map((client) => client.id);
  const [budgets, payments, events] = clientIds.length
    ? await Promise.all([
        db.budget.findMany({
          where: { organizationId, clientId: { in: clientIds } },
          select: { clientId: true, status: true, total: true, createdAt: true, approvedAt: true },
        }),
        db.clientPayment.findMany({
          where: { organizationId, clientId: { in: clientIds } },
          select: { clientId: true, amount: true, status: true, dueAt: true, createdAt: true },
        }),
        db.event.findMany({
          where: { organizationId, clientId: { in: clientIds } },
          select: { clientId: true, name: true, status: true, startsAt: true, endsAt: true, createdAt: true },
        }),
      ])
    : [[], [], []];
  const budgetsByClient = factsByClient(budgets);
  const paymentsByClient = factsByClient(payments);
  const eventsByClient = factsByClient(events);

  const rows = clients.map((client) => {
    const facts: ClientMetricFacts = {
      budgets: budgetsByClient.get(client.id) ?? [],
      payments: paymentsByClient.get(client.id) ?? [],
      events: eventsByClient.get(client.id) ?? [],
    };
    return { ...client, metrics: clientMetrics(facts) };
  });

  return Response.json({ clients: rows });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.name !== "string" || body.name.trim().length < 2) return jsonError("Name is required.", 400);
  const client = await db.client.create({
    data: {
      id: randomUUID(),
      organizationId: auth.context.organizationId,
      name: body.name.trim(),
      company: typeof body.company === "string" ? body.company.trim() : undefined,
      type: body.type === "RESELLER" ? "RESELLER" : "FINAL",
      email: typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined,
      phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
      ruc: typeof body.ruc === "string" ? body.ruc.trim() : undefined,
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Client",
    entityId: client.id,
    summary: `Creó el cliente «${client.name}»`,
    detail: { fields: auditPick(client, ["name", "company", "type", "email", "phone", "ruc"]) },
  });
  return Response.json({ client }, { status: 201 });
}
