import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { beginBulkOperationRun, idempotencyForBulkRun, type BulkRowOutcome } from "@/lib/server/bulk-operation-run";
import type { AdminCapability } from "@/lib/server/permissions";
import { isTrashEntityType, type TrashEntityType } from "@/lib/trash-shared";
import { readStoredTrashOutcomes } from "@/lib/bulk-trash-run";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const capabilities: Record<TrashEntityType, AdminCapability> = {
  InventoryItem: "inventory.write", InventoryFamily: "inventory.write", Event: "events.write",
  Client: "clients.write", Lead: "clients.write", Supplier: "suppliers.write",
  Promoter: "promoters.write", Budget: "budgets.write",
};
const ACTIONS = ["archive", "trash", "restore"] as const;
type Action = typeof ACTIONS[number];
/** Reports persist in BulkOperationRun, isolated by the active organization. */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (type && !isTrashEntityType(type)) return jsonError("Tipo de papelera inválido.", 400);
  const rows = await db.bulkOperationRun.findMany({
    where: { organizationId, operation: { startsWith: type ? `trash:${type}:` : "trash:" }, ...(auth.context.role === "OWNER" || auth.context.role === "ADMIN" ? {} : { actorId: auth.context.user.id }) },
    orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, operation: true, actorName: true, actorRole: true, requestedIds: true, outcomes: true, status: true, createdAt: true, updatedAt: true, completedAt: true },
  });
  return Response.json({ runs: rows });
}

/** Start a durable record before the first mutation. Replays with the same key return the same run. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action as Action;
  const validType = body?.type === "ALL" && action === "restore" || typeof body?.type === "string" && isTrashEntityType(body.type);
  if (!body || !validType || !ACTIONS.includes(action) || !Array.isArray(body.ids) || body.ids.length > 2000 ||
      !body.ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 128)) return jsonError("Informe tipo, acción e IDs válidos para registrar el lote.", 400);
  const type = body.type as TrashEntityType | "ALL";
  const auth = await requireAdminContext(action === "restore" ? "trash.manage" : capabilities[type as TrashEntityType]);
  if (!auth.ok) return auth.response;
  const idempotency = idempotencyForBulkRun(request, body);
  if (!idempotency) return jsonError("Falta la clave de idempotencia del lote.", 400);
  const ids = body.ids as string[];
  if (new Set(ids).size !== ids.length) return jsonError("El lote contiene IDs duplicados.", 400);
  const begun = await beginBulkOperationRun({ context: auth.context, operation: `trash:${type}:${action}`, ids, ...idempotency });
  if (begun.kind === "conflict") return jsonError("La clave ya se usó con otro lote.", 409);
  return Response.json({ run: { id: begun.run.id, status: begun.run.status } }, { status: begun.kind === "created" ? 201 : 200 });
}

/** Replace the known outcome snapshot; idempotent retries cannot duplicate report rows. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.runId !== "string" || body.runId.length > 128) return jsonError("Operación no válida.", 400);
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const run = await db.bulkOperationRun.findFirst({ where: { id: body.runId, organizationId: auth.context.organizationId, operation: { startsWith: "trash:" } } });
  if (!run) return jsonError("El informe de lote no existe en esta empresa.", 404);
  const [, type, action] = run.operation.split(":");
  if (!(isTrashEntityType(type) || type === "ALL" && action === "restore") || !ACTIONS.includes(action as Action)) return jsonError("Operación no válida.", 400);
  const permission = action === "restore" ? "trash.manage" : capabilities[type as TrashEntityType];
  const authorized = await requireAdminContext(permission);
  if (!authorized.ok) return authorized.response;
  if (authorized.context.user.id !== run.actorId && authorized.context.role !== "OWNER" && authorized.context.role !== "ADMIN") return jsonError("Solo quien inició el lote o un administrador puede actualizar este informe.", 403);
  const outcomes = readStoredTrashOutcomes(body.outcomes);
  if (!outcomes) return jsonError("El informe contiene resultados no válidos.", 400);
  const allowedIds = new Set(Array.isArray(run.requestedIds) ? run.requestedIds.filter((id): id is string => typeof id === "string") : []);
  if (outcomes.some(outcome => !allowedIds.has(outcome.id))) return jsonError("El resultado incluye filas fuera del lote original.", 409);
  const final = body.complete === true;
  const mapped: BulkRowOutcome[] = outcomes.map(row => ({ id: row.id, name: row.name, status: row.status === "success" ? "succeeded" : row.status, message: row.message }));
  let conflict = false;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bulk-operation-report:${auth.context.organizationId}:${run.id}`}, 0))::text AS locked`;
    const latest = await tx.bulkOperationRun.findFirst({ where: { id: run.id, organizationId: auth.context.organizationId } });
    if (!latest) return;
    if (latest.status !== "IN_PROGRESS") {
      if (JSON.stringify(latest.outcomes) !== JSON.stringify(mapped)) conflict = true;
      return;
    }
    await tx.bulkOperationRun.update({ where: { id: run.id }, data: { outcomes: mapped as unknown as Prisma.InputJsonValue, status: final ? outcomes.some(row => row.status === "failed" || row.status === "blocked" || row.status === "unknown") ? "FAILED" : "COMPLETED" : "IN_PROGRESS", ...(final ? { completedAt: new Date() } : {}) } });
  });
  if (conflict) return jsonError("El informe ya se cerró y no se puede modificar.", 409);
  return Response.json({ ok: true, status: final ? "completed" : "in_progress" });
}
