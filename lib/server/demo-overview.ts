import { unstable_cache } from "next/cache";
import { db } from "./db";
import { dayKeyOf, dayStart, listAdminNotifications } from "./notifications";

/**
 * Lectura pesada de la demo (issue #64): las ~30 consultas del índice público,
 * que no dependen del usuario ni de la sesión. Se cachea en la Data Cache de
 * Next por organización y por «bucket» de 2 minutos —las fechas de la demo se
 * derivan de `now`, así que el bucket evita congelar los conteos relativos al
 * día— y se invalida con `revalidateTag("demo")` al reiniciar la demo (issue #58).
 *
 * Nunca se cachea entre empresas: la organización entra en la clave. El resto del
 * panel queda dinámico (sesión y permisos siempre frescos).
 */
export const DEMO_OVERVIEW_BUCKET_MS = 2 * 60_000;

export const readDemoOverview = unstable_cache(
  async (organizationId: string, bucket: number) => {
    const now = new Date(bucket * DEMO_OVERVIEW_BUCKET_MS);
    const todayStart = dayStart(dayKeyOf(now));

    const [
      clientCount,
      eventCount,
      budgetCount,
      supplierCount,
      inventoryCount,
      promoterCount,
      newLeadCount,
      openJobCount,
      upcomingEvents,
      feed,
      audits,
      portalBudget,
      openBudgetRow,
      overduePayments,
      rejectedCheques,
      riskEventCount,
      unavailablePromoters,
      toDefinePromoters,
      damagedUnits,
      cancelledEventCount,
      treasuryAccounts,
      treasuryMovements,
      treasuryGrouped,
      treasuryTransfersIn,
      expenseRows,
      toDefineExpenses,
      expenseCount,
      expectedRows,
      invitationRows,
      mailRows,
    ] = await Promise.all([
    db.client.count({ where: { organizationId, active: true } }),
    db.event.count({ where: { organizationId, status: { not: "CANCELLED" } } }),
    db.budget.count({ where: { organizationId, status: { notIn: ["LOST", "CANCELLED"] } } }),
    db.supplier.count({ where: { organizationId, active: true } }),
    db.inventoryItem.count({ where: { organizationId, status: { not: "RETIRED" } } }),
    db.promoter.count({ where: { organizationId, active: true } }),
    db.lead.count({ where: { organizationId, status: "NEW" } }),
    db.supplierJob.count({ where: { organizationId, status: { notIn: ["PAID", "CANCELLED"] } } }),
    db.event.findMany({
      where: { organizationId, startsAt: { gte: now }, status: { not: "CANCELLED" } },
      orderBy: { startsAt: "asc" },
      take: 3,
      include: { client: { select: { name: true, company: true } }, tasks: { select: { completedAt: true, dueAt: true } } },
    }),
    listAdminNotifications(organizationId, now),
    db.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    db.budget.findFirst({
      where: { organizationId, approvedAt: { not: null }, publicToken: { not: null } },
      orderBy: { approvedAt: "desc" },
      select: { id: true, title: true, publicToken: true, approvedAt: true, approvedByName: true, advanceAmount: true, installmentsJson: true },
    }),
    // Presupuesto abierto para recorrer la autogestión: link/QR activos y sin
    // aprobación ni cambios pedidos todavía.
    db.budget.findFirst({
      where: {
        organizationId,
        publicToken: { not: null },
        approvedAt: null,
        revisionRequestedAt: null,
        status: { in: ["SENT", "NEGOTIATING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, publicToken: true, status: true, client: { select: { company: true, name: true } } },
    }),
    // Casos difíciles de la demo (issue #24): derivados del dato real, sin
    // campos nuevos. Mora = cobros pendientes con vencimiento pasado.
    db.clientPayment.aggregate({
      where: { organizationId, status: "PENDING", dueAt: { lt: todayStart } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.clientPayment.count({ where: { organizationId, status: "CANCELLED", method: "Cheque" } }),
    db.event.count({
      where: {
        organizationId,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        startsAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
        tasks: { some: {}, none: { completedAt: { not: null } } },
      },
    }),
    db.promoter.count({ where: { organizationId, active: true, availability: "UNAVAILABLE" } }),
    db.promoter.count({ where: { organizationId, active: true, availability: "TO_DEFINE" } }),
    db.eventInventory.aggregate({
      where: { event: { organizationId } },
      _sum: { damagedQuantity: true, missingQuantity: true },
    }),
    db.event.count({ where: { organizationId, status: "CANCELLED" } }),
    // Tesorería (issue #27): las cuentas con su saldo derivado, como las lee el
    // panel (saldo inicial + entradas − salidas ± transferencias).
    db.treasuryAccount.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.treasuryMovement.findMany({
      where: { organizationId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 6,
      include: {
        account: { select: { id: true, name: true, type: true } },
        counterAccount: { select: { id: true, name: true, type: true } },
      },
    }),
    // Saldo por cuenta sobre TODOS los movimientos (no solo los últimos): es el
    // mismo cálculo del API de tesorería.
    db.treasuryMovement.groupBy({
      by: ["accountId", "direction"],
      where: { organizationId },
      _sum: { amount: true },
    }),
    db.treasuryMovement.groupBy({
      by: ["counterAccountId"],
      where: { organizationId, direction: "TRANSFER", counterAccountId: { not: null } },
      _sum: { amount: true },
    }),
    // Gastos (issue #27): los últimos, con su proyecto (o «A definir»).
    db.expense.findMany({
      where: { organizationId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 6,
      include: { event: { select: { name: true } }, account: { select: { name: true } } },
    }),
    db.expense.count({ where: { organizationId, eventId: null } }),
    db.expense.count({ where: { organizationId } }),
    // Pagos esperados del plan (issue #28): comprobante en revisión, vencidos y
    // confirmados. Lo esperado no es plata cobrada.
    db.expectedPayment.findMany({
      where: { organizationId },
      orderBy: [{ dueAt: "asc" }],
      include: {
        budget: { select: { title: true, client: { select: { name: true, company: true } } } },
        proof: { select: { id: true } },
        expectedAccount: { select: { name: true } },
      },
    }),
    // Invitaciones al equipo (issue #31) e historial de correos (issue #30): los
    // módulos son de OWNER/ADMIN, así que la demo los muestra acá en resumen.
    db.teamInvitation.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }], take: 4 }),
    db.mailLog.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }], take: 5 }),
    ]);

    return {
      clientCount,
      eventCount,
      budgetCount,
      supplierCount,
      inventoryCount,
      promoterCount,
      newLeadCount,
      openJobCount,
      upcomingEvents,
      feed,
      audits,
      portalBudget,
      openBudgetRow,
      overduePayments,
      rejectedCheques,
      riskEventCount,
      unavailablePromoters,
      toDefinePromoters,
      damagedUnits,
      cancelledEventCount,
      treasuryAccounts,
      treasuryMovements,
      treasuryGrouped,
      treasuryTransfersIn,
      expenseRows,
      toDefineExpenses,
      expenseCount,
      expectedRows,
      invitationRows,
      mailRows,
    };
  },
  ["demo-overview"],
  { revalidate: 120, tags: ["demo"] },
);
