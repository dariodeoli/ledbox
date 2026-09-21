import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const events = await db.event.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: { client: true, assignments: { include: { inventory: true } }, tasks: true },
  });
  return Response.json({ events });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.clientId !== "string" || typeof body.name !== "string") return jsonError("Client and event name are required.", 400);
  const client = await db.client.findFirst({
    where: { id: body.clientId, organizationId: auth.context.organizationId },
    select: { id: true, name: true },
  });
  if (!client) return jsonError("Client not found.", 404);
  const event = await db.event.create({
    data: {
      id: randomUUID(),
      organizationId: auth.context.organizationId,
      clientId: client.id,
      name: body.name.trim(),
      location: typeof body.location === "string" ? body.location.trim() : undefined,
      startsAt: typeof body.startsAt === "string" ? new Date(body.startsAt) : undefined,
      endsAt: typeof body.endsAt === "string" ? new Date(body.endsAt) : undefined,
      setupAt: typeof body.setupAt === "string" ? new Date(body.setupAt) : undefined,
      status: "DRAFT",
      tasks: {
        create: [
          { id: randomUUID(), type: "SETUP", title: "Confirmar montaje y acceso al lugar" },
          { id: randomUUID(), type: "EVENT", title: "Verificar equipos y operación del evento" },
          { id: randomUUID(), type: "STRIKE", title: "Coordinar desmontaje y devolución" },
          { id: randomUUID(), type: "COLLECTION", title: "Confirmar cobro / saldo" },
        ],
      },
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Event",
    entityId: event.id,
    summary: `Creó el evento «${event.name}» del cliente «${client.name}»`,
    detail: { fields: auditPick(event, ["name", "location", "startsAt", "endsAt", "setupAt", "status"]) },
  });
  return Response.json({ event }, { status: 201 });
}
