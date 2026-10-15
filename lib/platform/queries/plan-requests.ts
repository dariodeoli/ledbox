import type { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { PAGE_SIZE, totalPages } from "@/lib/platform/tablas";

/** Cola global existente: sólo pendientes de empresas reales, sin aplicar ningún plan. */
export async function loadPendingPlanRequests(requestedPage: number) {
  const where: Prisma.PlanChangeRequestWhereInput = {
    status: "pending", organization: { isDemo: false, slug: { not: "demo" } },
  };
  const total = await db.planChangeRequest.count({ where });
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages(total));
  const rows = await db.planChangeRequest.findMany({
    where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
    select: {
      id: true, note: true, createdAt: true, requestedByName: true,
      organization: { select: { id: true, name: true } },
      plan: { select: { name: true } },
    },
  });
  return { total, page, rows };
}
