import { clientLabel } from "./notifications";

/**
 * Snapshots inmutables de las operaciones financieras (issue #20).
 *
 * Fuente única de las copias que se guardan **en el momento** de una operación
 * para que la historia no cambie cuando cambie el original:
 *
 * - `TreasuryMovement.sourceSnapshot`: el hecho que originó el movimiento
 *   (cobro, pago a proveedor o gasto), con la etiqueta legible, el monto y la
 *   referencia tal como estaban al registrarlo. La lista de tesorería lee esto
 *   antes que la fuente viva; los movimientos anteriores a la migración caen a
 *   la lectura viva (comportamiento histórico, no se inventa hacia atrás).
 * - `ClientPayment.collectedSnapshot`: el detalle del cobro al confirmarlo
 *   (fecha real, monto, método, referencia, y los nombres del cliente,
 *   presupuesto y cuenta de ese momento).
 *
 * Qué **no** se snapshotea (y por qué): los saldos de tesorería se derivan de
 * los movimientos (no hay saldo guardado que copiar); la aprobación del
 * presupuesto y el plan de pagos del portal siguen leyendo el presupuesto vivo
 * (el snapshot de la aprobación es alcance del portal, fuera de este cambio); y
 * los comprobantes de pago ya son inmutables por naturaleza (el binario y sus
 * metadatos se guardan tal cual, sin referenciar datos mutables).
 */

const MAX_LABEL = 200;

export type MovementSnapshotKind = "client_payment" | "supplier_job" | "expense";

/** Snapshot del hecho que originó un movimiento de tesorería. */
export type MovementSourceSnapshot = {
  kind: MovementSnapshotKind;
  /** Etiqueta legible al momento del movimiento (cliente, trabajo o gasto). */
  label: string;
  /** Monto del movimiento, en guaraníes. */
  amount: number;
  /** Referencia del hecho (Nº de factura, comprobante o método), si había. */
  ref: string | null;
};

function clean(value: string | null | undefined, max = MAX_LABEL): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

/** Nombre visible del cliente en una etiqueta (`empresa` o `nombre`), acotado. */
export function clientNameForSnapshot(client: { name: string; company: string | null }): string {
  return clientLabel(client).slice(0, MAX_LABEL);
}

/** Snapshot de un movimiento nacido de un hecho real (cobro, trabajo o gasto). */
export function movementSourceSnapshot(input: {
  kind: MovementSnapshotKind;
  label: string;
  amount: number;
  ref?: string | null;
}): MovementSourceSnapshot {
  return {
    kind: input.kind,
    label: (input.label.trim() || "Sin detalle").slice(0, MAX_LABEL),
    amount: input.amount,
    ref: clean(input.ref),
  };
}

/** Lee un snapshot guardado; `null` si falta o tiene forma rara (nunca lanza). */
export function parseMovementSourceSnapshot(value: unknown): MovementSourceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const kind =
    row.kind === "client_payment" || row.kind === "supplier_job" || row.kind === "expense" ? row.kind : null;
  const label = clean(typeof row.label === "string" ? row.label : null);
  const amount = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : null;
  if (!kind || !label || amount === null) return null;
  return { kind, label, amount, ref: clean(typeof row.ref === "string" ? row.ref : null) };
}

/** Snapshot inmutable del cobro de un cliente al confirmarlo. */
export type CollectionSnapshot = {
  /** Fecha real del cobro (ISO). */
  at: string;
  amount: number;
  method: string | null;
  reference: string | null;
  invoiceNumber: string | null;
  client: { id: string; name: string; company: string | null };
  budget: { id: string; title: string; total: number } | null;
  account: { id: string; name: string } | null;
};

export function collectionSnapshotOf(input: {
  at: Date;
  amount: number;
  method?: string | null;
  reference?: string | null;
  invoiceNumber?: string | null;
  client: { id: string; name: string; company: string | null };
  budget?: { id: string; title: string; total: number } | null;
  account?: { id: string; name: string } | null;
}): CollectionSnapshot {
  return {
    at: input.at.toISOString(),
    amount: input.amount,
    method: clean(input.method, 60),
    reference: clean(input.reference, 120),
    invoiceNumber: clean(input.invoiceNumber, 60),
    client: { id: input.client.id, name: input.client.name, company: input.client.company },
    budget: input.budget ? { id: input.budget.id, title: input.budget.title, total: input.budget.total } : null,
    account: input.account ? { id: input.account.id, name: input.account.name } : null,
  };
}
