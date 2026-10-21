import { randomUUID } from "node:crypto";
import type { AdminRole, BulkOperationRunStatus, Prisma } from "@prisma/client";
import { db } from "./db";
import type { AdminContext } from "./tenancy";
import { readIdempotencyKey, requestHashOf } from "./idempotency";

export type BulkRowOutcome = { id: string; name?: string; status: "succeeded" | "blocked" | "failed" | "unknown"; message?: string };

export function idempotencyForBulkRun(request: Request, body: Record<string, unknown>) {
  const key = readIdempotencyKey(request, body);
  if (!key) return null;
  return { key, requestHash: requestHashOf(body) };
}

export async function beginBulkOperationRun(options: {
  context: AdminContext;
  operation: string;
  ids: string[];
  key: string;
  requestHash: string;
}) {
  const { context, operation, ids, key, requestHash } = options;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bulk-operation:${context.organizationId}:${key}`}, 0))::text AS locked`;
    const existing = await tx.bulkOperationRun.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey: key } },
    });
    if (existing) return { kind: existing.requestHash === requestHash ? "existing" as const : "conflict" as const, run: existing };
    const run = await tx.bulkOperationRun.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        operation,
        actorId: context.user.id,
        actorName: context.user.name,
        actorEmail: context.user.email,
        actorRole: context.role as AdminRole,
        idempotencyKey: key,
        requestHash,
        requestedIds: ids as unknown as Prisma.InputJsonValue,
      },
    });
    return { kind: "created" as const, run };
  });
}

export async function finishBulkOperationRun(options: {
  id: string;
  status: Exclude<BulkOperationRunStatus, "IN_PROGRESS">;
  outcomes: BulkRowOutcome[];
  response: Record<string, unknown>;
}) {
  await db.bulkOperationRun.update({
    where: { id: options.id },
    data: {
      status: options.status,
      outcomes: options.outcomes as unknown as Prisma.InputJsonValue,
      response: options.response as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}
