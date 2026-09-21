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
  const clients = await db.client.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { events: true, budgets: true } } },
  });
  return Response.json({ clients });
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
