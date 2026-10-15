import { CLIENT_IDENTITY_SELECT, clientIdentityDTO } from "./client-identity";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { withDeletedLabel } from "../deleted-label";
import { parseAgingParam } from "../resumen-board";
import { dayKeyOf, dayStart } from "./notifications";

const PAGE_SIZE = 50;
const paymentInclude = {
  client: { select: { ...CLIENT_IDENTITY_SELECT, email: true, phone: true, deletedAt: true } },
  budget: { select: { id: true, title: true, publicToken: true } },
  reminders: { orderBy: { sentAt: "desc" as const }, take: 20 },
  treasuryAccount: { select: { id: true, name: true, type: true } },
} satisfies Prisma.ClientPaymentInclude;

function pageOf(value: string | null) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** Listas acotadas y agregados completos comparten filtros y empresa. */
export async function readFinanceListing(organizationId: string, params: URLSearchParams) {
  const collections = params.get("view") === "collections";
  const query = collections ? (params.get("q") ?? "").trim().slice(0, 200) : "";
  const clientId = collections ? (params.get("clientId") ?? "").trim() : "";
  const aging = collections ? parseAgingParam(params.get("vence")) : null;
  const today = dayStart(dayKeyOf(new Date()));
  const daysBefore = (days: number) => new Date(today.getTime() - days * 86400000);
  const filters: Prisma.ClientPaymentWhereInput = {
    organizationId,
    ...(clientId ? { clientId } : {}),
    ...(query ? { AND: query.split(/\s+/).map(term => ({ OR: [
      { client: { name: { contains: term, mode: "insensitive" } } },
      { client: { company: { contains: term, mode: "insensitive" } } },
      { budget: { title: { contains: term, mode: "insensitive" } } },
      { method: { contains: term, mode: "insensitive" } },
      { reference: { contains: term, mode: "insensitive" } },
      { invoiceNumber: { contains: term, mode: "insensitive" } },
      ...(["cobrado", "anulado", "pendiente"].filter(label => label.includes(term.toLowerCase())).map(label => ({ status: label === "cobrado" ? "RECEIVED" as const : label === "anulado" ? "CANCELLED" as const : "PENDING" as const }))),
    ] })) } : {}),
  };
  const pendingWhere: Prisma.ClientPaymentWhereInput = {
    ...filters, status: "PENDING",
    ...(aging === "current" ? { OR: [{ dueAt: null }, { dueAt: { gte: today } }] }
      : aging === "d1_30" ? { dueAt: { gte: daysBefore(30), lt: today } }
      : aging === "d31_60" ? { dueAt: { gte: daysBefore(60), lt: daysBefore(30) } }
      : aging === "d60plus" ? { dueAt: { lt: daysBefore(60) } } : {}),
  };
  const settledWhere: Prisma.ClientPaymentWhereInput = { ...filters, status: { not: "PENDING" } };
  return db.$transaction(async tx => {
    const [pending, settled, collected, overdue, jobs, payable, filterClient] = await Promise.all([
      tx.clientPayment.aggregate({ where: pendingWhere, _sum: { amount: true }, _count: true }),
      tx.clientPayment.aggregate({ where: settledWhere, _sum: { amount: true }, _count: true }),
      tx.clientPayment.aggregate({ where: { ...filters, status: "RECEIVED" }, _sum: { amount: true }, _count: true }),
      tx.clientPayment.count({ where: { AND: [pendingWhere, { dueAt: { lt: today } }] } }),
      tx.supplierJob.aggregate({ where: { organizationId }, _sum: { advance: true }, _count: true }),
      tx.$queryRaw<Array<{ amount: bigint }>>`SELECT COALESCE(SUM(GREATEST("total" - "advance", 0)), 0)::bigint AS amount FROM "SupplierJob" WHERE "organizationId" = ${organizationId} AND "status" NOT IN ('PAID', 'CANCELLED')`,
      clientId ? tx.$queryRaw<Array<{ id: string; name: string; company: string | null; deletedAt: Date | null }>>`SELECT id, name, company, "deletedAt" FROM "Client" WHERE id = ${clientId} AND "organizationId" = ${organizationId}`.then(rows => rows[0] ?? null) : null,
    ]);
    const pagination = (requested: string | null, total: number, amount: number) => ({
      page: Math.min(pageOf(requested), Math.max(1, Math.ceil(total / PAGE_SIZE))),
      pageSize: PAGE_SIZE, total, amount,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
    const pendingPage = pagination(params.get("pendingPage"), pending._count, pending._sum.amount ?? 0);
    const settledPage = pagination(params.get("settledPage"), settled._count, collected._sum.amount ?? 0);
    const [clientPayments, supplierJobs] = await Promise.all([
      collections ? Promise.all([
        tx.clientPayment.findMany({ where: pendingWhere, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }], skip: (pendingPage.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: paymentInclude }),
        tx.clientPayment.findMany({ where: settledWhere, orderBy: [{ collectedAt: { sort: "desc", nulls: "last" } }, { paidAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }], skip: (settledPage.page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: paymentInclude }),
      ]).then(([a, b]) => [...a, ...b]) : tx.clientPayment.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200, include: paymentInclude }),
      tx.supplierJob.findMany({ where: { organizationId }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 200, include: {
        supplier: { select: { id: true, name: true, phone: true, category: true, deletedAt: true } },
        event: { select: { id: true, name: true, startsAt: true, status: true } },
      } }),
    ]);
    return {
      clientPayments: clientPayments.map(payment => ({ ...payment, client: withDeletedLabel(clientIdentityDTO(payment.client)) })),
      supplierJobs: supplierJobs.map(job => ({ ...job, supplier: withDeletedLabel(job.supplier) })),
      financeSummary: { collected: collected._sum.amount ?? 0, collectedCount: collected._count, pendingTotal: pending._sum.amount ?? 0, pendingCount: pending._count, overdue, advances: jobs._sum.advance ?? 0, payable: Number(payable[0]?.amount ?? 0), jobsCount: jobs._count },
      ...(collections ? { paymentsPagination: { pending: pendingPage, settled: settledPage }, filterClient: withDeletedLabel(filterClient) } : {}),
    };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
