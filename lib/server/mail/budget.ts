import { formatDate, formatMoney, formatNumber } from "@/lib/admin-format";
import { normalizeBudgetCode, portalBudgetUrl, publicConfig } from "@/lib/public-config";
import { parsePaymentDetails, paymentPlanOf, type PortalBudgetPaymentDetails } from "../budget-portal";
import { renderMail, renderMailText, type MailContent, type MailRow } from "./template";

/**
 * Correo «Presupuesto» (issue #30): el que el panel manda al cliente desde
 * Presupuestos. Usa la plantilla única y arma **todo** lo que el cliente
 * necesita para decidir sin abrir el panel:
 *
 * - el link del portal y el código del presupuesto (la única credencial del
 *   link, tal como se dicta por teléfono);
 * - el resumen de ítems con cantidades, días y subtotales, más subtotal,
 *   descuento y total;
 * - la validez de la oferta y el evento, cuando existen;
 * - los datos de pago de la empresa **solo con el presupuesto aprobado**
 *   (misma regla que el portal: antes no viajan);
 * - la hoja imprimible del panel, enlazada.
 */

/** Tope de ítems listados en el correo: el resto se resume (no se inventan datos). */
const MAX_ITEM_ROWS = 12;
const MAX_CUSTOM_MESSAGE = 600;

export type BudgetMailItem = {
  name: string;
  quantity: number;
  days: number;
  subtotal: number;
};

export type BudgetMailBudget = {
  id: string;
  title: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  /** Plan de pagos (issue #14): anticipo y cuotas del presupuesto. */
  advanceAmount: number;
  paymentTerms: string | null;
  installmentsJson: unknown;
  validUntil: Date | null;
  publicToken: string | null;
  approvedAt: Date | null;
  client: { name: string; company: string | null };
  event: { name: string | null } | null;
  items: BudgetMailItem[];
};

export type BudgetMailInput = {
  organizationName: string;
  /** Datos de pago de la empresa (`Organization.paymentDetails`); se filtran por aprobación. */
  paymentDetails: unknown;
  budget: BudgetMailBudget;
  /** Mensaje corto escrito por el equipo en el diálogo de envío (opcional). */
  message?: string | null;
};

export type BudgetMailContent = {
  subject: string;
  html: string;
  text: string;
  /** Código canónico agrupado del portal (el que viaja en el correo). */
  code: string | null;
  portalUrl: string | null;
};

/** Hoja imprimible del presupuesto (documento del panel, en el host admin). */
export function budgetPrintSheetUrl(budgetId: string): string {
  return `${publicConfig.adminUrl}/imprimir/presupuesto/${budgetId}`;
}

function clientLabel(client: { name: string; company: string | null }): string {
  return client.company?.trim() || client.name;
}

/** Motivo del correo para el pie, con el cliente y el total (una línea honesta). */
function mailReason(input: BudgetMailInput): string {
  return `te enviamos el presupuesto «${input.budget.title}» de ${input.organizationName}`;
}

/**
 * Contenido del correo del presupuesto. Devuelve `null` cuando el presupuesto
 * no tiene link público: sin link no hay portal ni código que enviar.
 */
export function buildBudgetMail(input: BudgetMailInput): BudgetMailContent | null {
  const { budget } = input;
  // El token guardado ya es el código canónico; `normalizeBudgetCode` lo deja igual
  // (y tolera un valor viejo sin guiones) sin reformatear dos veces.
  const code = budget.publicToken ? (normalizeBudgetCode(budget.publicToken) ?? budget.publicToken) : null;
  const portalUrl = budget.publicToken ? portalBudgetUrl(budget.publicToken) : null;
  if (!code || !portalUrl) return null;

  const approved = Boolean(budget.approvedAt);
  const rows: MailRow[] = [{ label: "Código del presupuesto", value: code, strong: true }];

  const items = budget.items.slice(0, MAX_ITEM_ROWS);
  for (const item of items) {
    rows.push({
      label: `${item.name} · ${formatNumber(item.quantity)} × ${formatNumber(item.days)} d`,
      value: formatMoney(item.subtotal),
    });
  }
  if (budget.items.length > items.length) {
    rows.push({ label: `Y ${formatNumber(budget.items.length - items.length)} ítem(s) más`, value: "Ver detalle en el portal" });
  }
  if (budget.discount > 0) rows.push({ label: "Descuento", value: `− ${formatMoney(budget.discount)}` });
  rows.push({ label: "Total", value: formatMoney(budget.total), strong: true });
  rows.push({
    label: "Validez",
    value: budget.validUntil ? `hasta el ${formatDate(budget.validUntil)}` : "sin vencimiento informado",
  });
  if (budget.event?.name) rows.push({ label: "Evento", value: budget.event.name });
  rows.push({ label: "Hoja imprimible", value: "Abrir en el panel", href: budgetPrintSheetUrl(budget.id) });

  // Los datos de pago son de la empresa y recién con la aprobación registrada el
  // cliente tiene motivo (y permiso) para verlos: misma regla que el portal.
  const details: PortalBudgetPaymentDetails | null = approved ? parsePaymentDetails(input.paymentDetails) : null;
  if (details) {
    if (details.bank) rows.push({ label: "Banco", value: details.bank });
    if (details.holder) rows.push({ label: "Titular", value: details.holder });
    if (details.ruc) rows.push({ label: "RUC", value: details.ruc });
    if (details.account) rows.push({ label: "Cuenta", value: details.account });
    if (details.alias) rows.push({ label: "Alias", value: details.alias });
  }

  // Con plan de pagos y presupuesto aprobado, el correo muestra qué transferir ahora.
  const plan = approved ? paymentPlanOf(budget) : null;
  const hasPlan = Boolean(plan && (plan.advanceAmount > 0 || plan.installments.length > 0));
  if (plan?.dueNow && hasPlan && plan.dueNow.amount > 0) {
    rows.push({ label: `A transferir ahora (${plan.dueNow.label.toLowerCase()})`, value: formatMoney(plan.dueNow.amount), strong: true });
  }

  const message = (input.message ?? "").trim().slice(0, MAX_CUSTOM_MESSAGE);
  const subject = `Presupuesto «${budget.title}» · ${formatMoney(budget.total)}${
    budget.validUntil ? ` · válido hasta el ${formatDate(budget.validUntil)}` : ""
  }`;

  const content: MailContent = {
    title: approved
      ? `Presupuesto aprobado · ${budget.title}`
      : `Presupuesto · ${budget.title}`,
    intro: [
      `Hola ${clientLabel(budget.client)}:`,
      `Te enviamos el presupuesto «${budget.title}» de ${input.organizationName}.`,
      ...(message ? [message] : []),
    ],
    rows,
    cta: { label: "Ver el presupuesto en el portal", url: portalUrl },
    note: approved
      ? "El presupuesto ya está aprobado: los datos de pago están arriba y el detalle completo, en el portal."
      : "Desde el portal podés aprobar el presupuesto, ajustar cantidades y días o pedir cambios. El código de arriba es tu acceso.",
    preheader: `${formatMoney(budget.total)} · ${budget.items.length} ítem${budget.items.length === 1 ? "" : "s"} · código ${code}`,
    organization: input.organizationName,
    reason: mailReason(input),
  };

  return { subject, html: renderMail(content), text: renderMailText(content), code, portalUrl };
}
