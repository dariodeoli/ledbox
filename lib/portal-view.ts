import type { AdminTone } from "./admin-format";
import { countdownDays, formatCountdown, formatDate, formatDateTime } from "./admin-format";
import type { PortalBudgetPaymentDetails } from "./server/budget-portal";

/**
 * Reglas de presentación del presupuesto en el portal del cliente. Son puras
 * (sin React ni base) para poder probarlas: el componente solo las dibuja.
 *
 * Principios:
 * - Un solo estado legible para el cliente (nunca «Aprobado» + «Aprobado manual»).
 * - Aprobado el presupuesto, la validez ya no importa: se muestra «Aprobado el …».
 * - Nada de jerga interna («Vía: Panel») ni de cuentas internas de caja como
 *   destino de una transferencia.
 */

/** Etapa del presupuesto desde el punto de vista del cliente: define «qué hacer ahora». */
export type PortalStage =
  | "authorize" // todavía no decidió: autorizar, pedir rebaja o cambio
  | "waiting" // pidió algo y espera respuesta del equipo
  | "closed" // perdido o cancelado: nada que hacer
  | "pay" // aprobado con saldo por transferir
  | "review" // aprobado, comprobante en revisión
  | "settled" // aprobado, sin saldo pendiente
  | "coordinate"; // aprobado, saldo sin concepto abierto: el equipo coordina

export type PortalStageInput = {
  approved: boolean;
  /** Enum real del presupuesto (`CommercialStatus`). */
  status: string;
  /** Pidió cambios libres o hay una propuesta pendiente de respuesta. */
  waiting: boolean;
  /** `kind` de `budgetCollectionStep`; solo importa con el presupuesto aprobado. */
  collection: "payment" | "review" | "complete";
  /** Hay monto concreto para transferir ahora. */
  hasTransfer: boolean;
};

/** Perdido o cancelado: ya no está en juego (misma regla que el API: `portalBudgetOpen`). */
export function portalBudgetClosed(status: string): boolean {
  return status === "LOST" || status === "CANCELLED";
}

export function portalStage(input: PortalStageInput): PortalStage {
  if (input.approved) {
    if (input.collection === "complete") return "settled";
    if (input.collection === "review") return "review";
    return input.hasTransfer ? "pay" : "coordinate";
  }
  if (portalBudgetClosed(input.status)) return "closed";
  return input.waiting ? "waiting" : "authorize";
}

/** El presupuesto sin aprobar ya pasó su fecha de validez. */
export function portalExpired(validUntil: string | null, approved: boolean, status: string): boolean {
  if (approved || portalBudgetClosed(status) || !validUntil) return false;
  const days = countdownDays(validUntil);
  return days !== null && days < 0;
}

/**
 * Un solo estado para el cliente. El estado comercial interno («Enviado»,
 * «Borrador») y el método de aprobación («digital», «manual») no le sirven.
 */
export function portalStatusChip(input: {
  approved: boolean;
  status: string;
  revisionPending: boolean;
  waitingRequest: boolean;
  expired: boolean;
}): { label: string; tone: AdminTone } {
  if (input.approved) return { label: "Aprobado", tone: "ok" };
  if (input.status === "CANCELLED") return { label: "Cancelado", tone: "danger" };
  if (input.status === "LOST") return { label: "Cerrado", tone: "neutral" };
  if (input.revisionPending) return { label: "Cambios solicitados", tone: "warn" };
  if (input.waitingRequest) return { label: "Pedido en revisión", tone: "info" };
  if (input.expired) return { label: "Vencido", tone: "danger" };
  if (input.status === "NEGOTIATING") return { label: "En negociación", tone: "info" };
  return { label: "Pendiente de autorización", tone: "warn" };
}

export type PortalHeadDate = { key: string; label: string; value: string; note?: string; tone?: AdminTone };

/**
 * Fechas del encabezado sin contradicciones:
 * - aprobado: solo «Aprobado el …» (la validez ya no corre);
 * - cerrado: solo la emisión, sin cuenta regresiva;
 * - abierto: emisión (si no es posterior a la validez) y validez con su cuenta.
 */
export function portalHeadDates(input: {
  approved: boolean;
  approvedAt: string | null;
  status: string;
  createdAt: string;
  validUntil: string | null;
}): PortalHeadDate[] {
  if (input.approved) {
    return input.approvedAt ? [{ key: "approved", label: "Aprobado el", value: formatDateTime(input.approvedAt) }] : [];
  }
  const rows: PortalHeadDate[] = [];
  const closed = portalBudgetClosed(input.status);
  const validDays = input.validUntil ? countdownDays(input.validUntil) : null;
  const createdDays = countdownDays(input.createdAt);
  // Una validez anterior a la emisión es un dato inconsistente: no se muestra la emisión al lado.
  const issuedAfterValidity = validDays !== null && createdDays !== null && createdDays > validDays;
  if (!issuedAfterValidity) rows.push({ key: "issued", label: "Emitido el", value: formatDate(input.createdAt) });
  if (!closed && input.validUntil) {
    const expired = validDays !== null && validDays < 0;
    rows.push({
      key: "valid",
      label: expired ? "Venció el" : "Válido hasta",
      value: formatDate(input.validUntil),
      note: formatCountdown(input.validUntil, "client"),
      tone: expired ? "danger" : validDays !== null && validDays <= 7 ? "warn" : "neutral",
    });
  }
  return rows;
}

/** Cómo se aprobó, en voz del cliente: sin «Vía: Panel» ni «digital/manual». */
export function portalApprovalByline(input: { method: "digital" | "manual" | null; name: string | null }): string {
  if (input.method === "manual") return "Aprobado por el equipo de LedBox";
  return input.name ? `Autorizado por ${input.name}` : "Autorizado desde el portal";
}

export type PortalTransferDestination =
  | { kind: "bank"; details: PortalBudgetPaymentDetails }
  | { kind: "coordinate"; message: string };

/**
 * Destino de la transferencia. Solo cuenta lo que el cliente puede usar de
 * verdad (cuenta o alias de la empresa). La «cuenta destino» interna del plan
 * (`TreasuryAccount`, p. ej. «Efectivo») es contabilidad del equipo: no es un
 * destino de transferencia y nunca se muestra.
 */
export function portalTransferDestination(details: PortalBudgetPaymentDetails | null): PortalTransferDestination {
  if (details && (details.account || details.alias)) return { kind: "bank", details };
  return {
    kind: "coordinate",
    message: "A coordinar: el equipo de LedBox te pasa los datos bancarios. Escribinos respondiendo el correo con el que te enviamos el presupuesto.",
  };
}
