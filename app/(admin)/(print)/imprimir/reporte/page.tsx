import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  formatCalendarMonth,
  formatDate,
  formatDateTime,
  jobStatusLabel,
} from "@/lib/admin-format";
import { csvDay } from "@/lib/admin-export";
import type { AdminMonthlyReport } from "@/lib/admin-types";
import { supplierJobBalance } from "@/lib/admin-types";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { ReporteView } from "../../_components/ReporteView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reporte mensual", robots: { index: false, follow: false } };

/**
 * Paraguay usa UTC-3 todo el año (sin horario de verano desde 2024): los límites
 * del mes se calculan con ese offset fijo, así el período no se corre de día.
 */
const ASUNCION_OFFSET = "-03:00";

/** Presupuestos que cuentan como venta del evento: fuera perdidos y cancelados. */
const LOST_BUDGET_STATUSES = ["LOST", "CANCELLED"] as const;

function parseMonth(value: string | undefined): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return csvDay(new Date()).slice(0, 7);
}

function monthBounds(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(`${month}-01T00:00:00${ASUNCION_OFFSET}`);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const next = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
  return { start, end: new Date(`${next}-01T00:00:00${ASUNCION_OFFSET}`) };
}

/**
 * Reporte mensual del período elegido (`?mes=YYYY-MM`, por defecto el mes en
 * curso de Asunción). Todo sale de datos reales de la empresa activa: eventos
 * con inicio en el período, cobros, pagos y compromisos con proveedores, y la
 * rentabilidad simple por evento (venta − costos estimados).
 */
export default async function ReporteMensualPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) redirect("/login");

  const { mes } = await searchParams;
  const month = parseMonth(mes);
  const { start, end } = monthBounds(month);
  const organizationId = auth.context.organizationId;

  const [events, collections, supplierPayments, supplierPending] = await Promise.all([
    db.event.findMany({
      where: { organizationId, startsAt: { gte: start, lt: end } },
      orderBy: { startsAt: "asc" },
      include: {
        client: true,
        budgets: { where: { status: { notIn: [...LOST_BUDGET_STATUSES] } } },
        supplierJobs: { select: { id: true, total: true } },
      },
    }),
    db.clientPayment.findMany({
      where: { organizationId, paidAt: { gte: start, lt: end } },
      orderBy: { paidAt: "asc" },
      include: { client: true, budget: { select: { title: true } } },
    }),
    db.supplierJob.findMany({
      where: { organizationId, paidAt: { gte: start, lt: end } },
      orderBy: { paidAt: "asc" },
      include: { supplier: true, event: { select: { name: true } } },
    }),
    db.supplierJob.findMany({
      where: {
        organizationId,
        dueAt: { gte: start, lt: end },
        status: { notIn: ["PAID", "CANCELLED"] },
      },
      orderBy: { dueAt: "asc" },
      include: { supplier: true, event: { select: { name: true } } },
    }),
  ]);

  const eventRows = events.map((event) => {
    const sale = event.budgets.reduce((sum, budget) => sum + budget.total, 0);
    const costEstimate = event.budgets.reduce((sum, budget) => sum + budget.costEstimate, 0);
    // Sin costos cargados no hay margen que mostrar (nada inventado).
    const hasCosts = event.budgets.some((budget) => budget.costEstimate > 0);
    return {
      id: event.id,
      date: event.startsAt ? formatDate(event.startsAt) : "A confirmar",
      name: event.name,
      client: event.client.company || event.client.name,
      location: event.location,
      sale,
      costEstimate,
      margin: hasCosts ? sale - costEstimate : null,
      supplierJobs: event.supplierJobs.length,
      supplierTotal: event.supplierJobs.reduce((sum, job) => sum + job.total, 0),
    };
  });

  const collectionRows = collections.map((payment) => ({
    id: payment.id,
    date: formatDateTime(payment.paidAt),
    client: payment.client.company || payment.client.name,
    budget: payment.budget?.title ?? null,
    method: payment.method,
    reference: payment.reference,
    amount: payment.amount,
  }));

  const supplierPaymentRows = supplierPayments.map((job) => ({
    id: job.id,
    date: job.paidAt ? formatDate(job.paidAt) : "—",
    supplier: job.supplier.name,
    description: job.description,
    event: job.event?.name ?? null,
    method: job.paymentMethod,
    receipt: job.receipt,
    amount: job.total,
  }));

  const supplierPendingRows = supplierPending.map((job) => ({
    id: job.id,
    dueDate: job.dueAt ? formatDate(job.dueAt) : "—",
    supplier: job.supplier.name,
    description: job.description,
    event: job.event?.name ?? null,
    status: jobStatusLabel(job.status),
    total: job.total,
    advance: job.advance,
    balance: supplierJobBalance(job),
  }));

  const marginRows = eventRows.filter((row) => row.margin !== null);
  const report: AdminMonthlyReport = {
    month,
    monthLabel: formatCalendarMonth(`${month}-01`),
    issuedAt: formatDateTime(new Date()),
    organization: auth.context.organization.name,
    totals: {
      events: eventRows.length,
      sale: eventRows.reduce((sum, row) => sum + row.sale, 0),
      costEstimate: eventRows.reduce((sum, row) => sum + row.costEstimate, 0),
      margin: marginRows.length > 0 ? marginRows.reduce((sum, row) => sum + (row.margin ?? 0), 0) : null,
      collected: collectionRows.reduce((sum, row) => sum + row.amount, 0),
      paidToSuppliers: supplierPaymentRows.reduce((sum, row) => sum + row.amount, 0),
      committedBalance: supplierPendingRows.reduce((sum, row) => sum + row.balance, 0),
    },
    events: eventRows,
    collections: collectionRows,
    supplierPayments: supplierPaymentRows,
    supplierPending: supplierPendingRows,
  };

  return <ReporteView report={report} />;
}
