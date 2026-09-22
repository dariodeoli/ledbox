import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { clientMetrics, factsByClient, type ClientMetricFacts } from "./metrics";
import { parseClientFields } from "./client-fields";

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
 * Cada fila trae además la versión de su logo (issue #36), sin el binario: la
 * identidad de la lista lo pide con sesión a `/clients/[id]/logo`.
 *
 * `POST`: alta de cliente (`clients.write`) con los datos de contacto y links.
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const clients = await db.client.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { events: true, budgets: true } }, logo: { select: { updatedAt: true } } },
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
    const { logo, ...rest } = client;
    const facts: ClientMetricFacts = {
      budgets: budgetsByClient.get(client.id) ?? [],
      payments: paymentsByClient.get(client.id) ?? [],
      events: eventsByClient.get(client.id) ?? [],
    };
    return { ...rest, logoUpdatedAt: logo?.updatedAt.toISOString() ?? null, metrics: clientMetrics(facts) };
  });

  return Response.json({ clients: rows });
}

/** Campos que se auditan al crear un cliente (sin el binario del logo). */
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
] as const;

export async function POST(request: Request) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const parsed = parseClientFields(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  if (parsed.data.name === undefined) return jsonError("Ingresá el nombre del cliente.", 400);

  const client = await db.client.create({
    data: {
      id: randomUUID(),
      organizationId: auth.context.organizationId,
      ...parsed.data,
      name: parsed.data.name,
      type: parsed.data.type ?? "FINAL",
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Client",
    entityId: client.id,
    summary: `Creó el cliente «${client.name}»`,
    detail: { fields: auditPick(client, CLIENT_AUDIT_FIELDS) },
  });
  return Response.json({ client: { ...client, logoUpdatedAt: null } }, { status: 201 });
}
