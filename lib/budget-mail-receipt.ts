/** Contrato del recibo: aceptación del proveedor y etapa comercial son hechos distintos. */
export type MailCommercialState = "transitioned" | "already_sent" | "preserved_status" | "stale_revision" | "reconciliation_pending" | "not_applicable";
export type BudgetMailReply = {
  status: "sent" | "failed" | "skipped" | "pending" | "unknown";
  attemptId: string;
  to: string;
  subject: string;
  error: string | null;
  providerId?: string | null;
  logId?: string | null;
  simulated?: boolean;
  sentAt?: string;
  commercialState: MailCommercialState;
  budgetStatus?: string;
};

export function budgetMailNotice(reply: BudgetMailReply): string {
  if (reply.status !== "sent") return reply.error ?? "El resultado del correo sigue pendiente de confirmación.";
  const accepted = `El proveedor aceptó el correo para ${reply.to}.`;
  if (reply.commercialState === "reconciliation_pending") return `${accepted} Falta conciliar la etapa; consultá este intento sin reenviarlo.`;
  if (reply.commercialState === "stale_revision") return `${accepted} El borrador cambió durante el envío: conserva su etapa para que revises esa versión.`;
  return `${accepted} Esto no confirma entrega al buzón.`;
}
