import type { AdminClientDetail, AdminTimelineEntry } from "./admin-types";

type HistorySource = Pick<AdminClientDetail, "budgets" | "events" | "payments" | "leads">;

/**
 * Historial de la ficha del cliente: solo hechos que ya están en los datos de
 * la ficha (alta de lead, presupuesto, aprobación, evento y cobros recibidos),
 * ordenados del más nuevo al más viejo. No inventa hitos ni fechas: un hecho sin
 * fecha real no entra.
 */
export function clientHistory(detail: HistorySource): AdminTimelineEntry[] {
  const entries: AdminTimelineEntry[] = [];
  for (const lead of detail.leads) {
    entries.push({ id: `lead:${lead.id}`, at: lead.createdAt, kind: "request", title: "Consulta recibida", detail: lead.reason || lead.company || null, actor: null, tone: "info" });
  }
  for (const budget of detail.budgets) {
    entries.push({ id: `budget:${budget.id}`, at: budget.createdAt, kind: "created", title: `Presupuesto «${budget.title}»`, detail: null, actor: null, tone: "neutral" });
    if (budget.approvedAt) {
      entries.push({ id: `approved:${budget.id}`, at: budget.approvedAt, kind: "approved", title: `Aprobó «${budget.title}»`, detail: budget.approvalMethod === "manual" ? "Aprobación manual desde el panel" : "Aprobación desde el portal", actor: null, tone: "ok" });
    }
  }
  for (const event of detail.events) {
    entries.push({ id: `event:${event.id}`, at: event.createdAt, kind: "created", title: `Evento «${event.name}»`, detail: null, actor: null, tone: "neutral" });
  }
  for (const payment of detail.payments) {
    if (payment.status !== "RECEIVED") continue;
    const at = payment.collectedAt ?? payment.paidAt;
    if (!at) continue;
    entries.push({ id: `payment:${payment.id}`, at, kind: "payment", title: "Cobro recibido", detail: payment.budget?.title ?? payment.reference ?? null, actor: null, tone: "ok" });
  }
  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
