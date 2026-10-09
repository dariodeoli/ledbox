import { randomUUID } from "node:crypto";
import type { ExpectedPayment, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/admin-format";
import { db } from "./db";
import { parseInstallments } from "./budget-portal";
import { clientLabel, dayKeyOf, dayStart, isValidDayKey } from "./notifications";
import { auditChanges, recordAudit, type AuditContext } from "./audit";
import { collectionSnapshotOf } from "./finance-snapshots";
import { budgetPlanLedgerError } from "../budget-payment-plan";
import { QuoteComparisonError } from "./quote-comparison";

/**
 * Pagos esperados del plan de un presupuesto (issue #28): el dinero que el
 * cliente aprobó transferir y que **todavía no** es un cobro.
 *
 * - La **sincronización** (`syncBudgetExpectedPayments`) traduce el plan real
 *   —anticipo + cuotas + saldo sin agendar— a filas `ExpectedPayment` con una
 *   ranura estable por concepto (`advance`, `installment:N`, `balance`). Es
 *   idempotente: repetirla no duplica ni pisa lo confirmado; un concepto que
 *   sale del plan se cancela y, si vuelve, se reactiva.
 * - La **confirmación** (`confirmExpectedPayment`) crea el `ClientPayment`
 *   `RECEIVED` y el `TreasuryMovement` de entrada **en la misma transacción** y
 *   sella quién y cuándo. Reintentarla no duplica: el cambio de estado del pago
 *   esperado es el candado.
 * - La **observación** (`reviewExpectedPayment`) vuelve el pago a `AWAITING`
 *   con el motivo visible para el cliente en el portal.
 *
 * Un presupuesto sin aprobar no genera pagos esperados: sin aprobación no hay
 * promesa de pago.
 */

export const MAX_EXPECTED_NOTE = 1000;
export const MAX_EXPECTED_REFERENCE = 120;

export type ExpectedConceptValue = "advance" | "installment" | "balance";
export type ExpectedStatusValue = "AWAITING" | "PROOF" | "PARTIAL" | "CONFIRMED" | "CANCELLED";

export type ExpectedPlanItem = {
  accountId?: string | null;
  /** Ranura estable dentro del plan: `advance`, `installment:N` o `balance`. */
  slot: string;
  concept: ExpectedConceptValue;
  installmentNumber: number | null;
  label: string;
  amount: number;
  dueAt: Date | null;
};

const accountSelect = { id: true, name: true, type: true } as const;

const expectedInclude = {
  budget: { select: { id: true, title: true, total: true, client: { select: { id: true, name: true, company: true } } } },
  expectedAccount: { select: accountSelect },
  proof: { select: { id: true, paymentId: true, payment: { select: { id: true, status: true } } } },
  payment: { select: { id: true, status: true, collectedAt: true, treasuryAccountId: true } },
} as const;

export type ExpectedPaymentWithRefs = Prisma.ExpectedPaymentGetPayload<{ include: typeof expectedInclude }>;

/** Cuenta de tesorería esperada por defecto: la primera activa (orden del panel). */
async function firstActiveAccount(organizationId: string) {
  return db.treasuryAccount.findFirst({
    where: { organizationId, active: true, currency: "PYG" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: accountSelect,
  });
}

/**
 * Plan real del presupuesto como lista de conceptos esperados. El anticipo
 * vence el día de la aprobación (se transfiere con ella); cada cuota usa su
 * vencimiento real; el saldo sin cuota agendada queda sin fecha.
 */
export function budgetExpectedPlan(input: {
  total: number;
  advanceAmount: number;
  installmentsJson: unknown;
  approvedAt: Date | null;
}): ExpectedPlanItem[] {
  const items: ExpectedPlanItem[] = [];
  const total = Math.max(0, Math.round(input.total || 0));
  const advanceAmount = Math.max(0, Math.round(input.advanceAmount || 0));
  const installments = parseInstallments(input.installmentsJson);
  const advanceDueAt = input.approvedAt ? dayStart(dayKeyOf(input.approvedAt)) : null;

  if (advanceAmount > 0) {
    items.push({
      slot: "advance",
      concept: "advance",
      installmentNumber: null,
      label: "Anticipo",
      amount: advanceAmount,
      dueAt: advanceDueAt,
    });
  }
  installments.forEach((installment, index) => {
    if (installment.amount <= 0) return;
    items.push({
      slot: `installment:${index + 1}`,
      concept: "installment",
      installmentNumber: index + 1,
      label: installment.label || `Cuota ${index + 1}`,
      amount: installment.amount,
      accountId: installment.accountId,
      dueAt: installment.dueAt ? dayStart(installment.dueAt) : null,
    });
  });
  const committed = advanceAmount + installments.reduce((sum, installment) => sum + installment.amount, 0);
  const balance = Math.max(0, total - committed);
  if (balance > 0) {
    items.push({
      slot: "balance",
      concept: "balance",
      installmentNumber: null,
      label: "Saldo",
      amount: balance,
      dueAt: null,
    });
  }
  return items;
}

export type ExpectedSyncResult = {
  created: number;
  updated: number;
  cancelled: number;
  /** Total de conceptos vigentes del plan (sin contar los cancelados). */
  total: number;
};

/**
 * Sincroniza los pagos esperados con el plan del presupuesto.
 *
 * Idempotente por la ranura (`@@unique([budgetId, slot])`): repetirla con el
 * mismo plan no escribe nada. Nunca toca un concepto confirmado (la plata ya
 * entró) ni revive uno cancelado que no volvió al plan; el resto se actualiza
 * a los valores vigentes (monto, vencimiento y etiqueta).
 */
export async function syncBudgetExpectedPayments(input: {
  /** Commercial revisions pass their transaction so ledger and quote commit together. */
  tx?: Prisma.TransactionClient;
  organizationId: string;
  budgetId: string;
  actor?: AuditContext | null;
  /** Motivo del cambio para el resumen de auditoría (aprobación o plan). */
  reason?: string;
}): Promise<ExpectedSyncResult> {
  const result: ExpectedSyncResult = { created: 0, updated: 0, cancelled: 0, total: 0 };
  const database = input.tx ?? db;
  const budget = await database.budget.findFirst({
    where: { id: input.budgetId, organizationId: input.organizationId },
    select: {
      id: true,
      title: true,
      total: true,
      advanceAmount: true,
      installmentsJson: true,
      approvedAt: true,
      client: { select: { name: true, company: true } },
      expectedPayments: {
        select: {
          id: true,
          slot: true,
          concept: true,
          installmentNumber: true,
          label: true,
          amount: true,
          dueAt: true,
          status: true,
          expectedAccountId: true,
          paidAmount: true,
          proofId: true,
          paymentId: true,
        },
      },
    },
  });
  // Sin aprobación no hay promesa de pago: no se inventa dinero esperado.
  if (!budget || (!budget.approvedAt && budget.expectedPayments.length === 0)) return result;

  const desired = budgetExpectedPlan(budget);
  const ledgerError = budgetPlanLedgerError(desired, budget.expectedPayments);
  if (ledgerError) throw new QuoteComparisonError(409, ledgerError);
  const existing = new Map(budget.expectedPayments.map((row) => [row.slot, row]));
  const now = new Date();
  let defaultAccountId: string | null | undefined;
  const resolveDefaultAccount = async () => {
    if (defaultAccountId === undefined) {
      defaultAccountId = (await database.treasuryAccount.findFirst({ where: { organizationId: input.organizationId, active: true, currency: "PYG" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: accountSelect }))?.id ?? null;
    }
    return defaultAccountId;
  };

  for (const item of desired) {
    const current = existing.get(item.slot);
    if (!current) {
      const accountId = item.accountId ?? await resolveDefaultAccount();
      await database.expectedPayment.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          budgetId: budget.id,
          concept: item.concept,
          slot: item.slot,
          installmentNumber: item.installmentNumber,
          label: item.label,
          amount: item.amount,
          dueAt: item.dueAt,
          status: "AWAITING",
          expectedAccountId: accountId,
        },
      });
      result.created += 1;
      continue;
    }
    existing.delete(item.slot);
    // Lo confirmado y lo parcial no se pisan: la plata ya entró con sus valores
    // reales y el saldo pendiente se completa o se divide a mano (issue #129).
    if (current.status === "CONFIRMED" || current.status === "PARTIAL" || current.status === "PROOF" || current.paidAmount > 0 || current.proofId || current.paymentId || current.label.includes(" · parte ") || current.slot.startsWith("split:")) continue;

    const nextStatus: ExpectedStatusValue = current.status === "CANCELLED" ? "AWAITING" : (current.status as ExpectedStatusValue);
    const reviving = current.status === "CANCELLED";
    const expectedAccountId = item.accountId ?? current.expectedAccountId ?? (await resolveDefaultAccount());
    const changes = auditChanges(
      {
        label: current.label,
        amount: current.amount,
        dueAt: current.dueAt,
        concept: current.concept,
        installmentNumber: current.installmentNumber,
        status: current.status,
        expectedAccountId: current.expectedAccountId,
      },
      {
        label: item.label,
        amount: item.amount,
        dueAt: item.dueAt,
        concept: item.concept,
        installmentNumber: item.installmentNumber,
        status: nextStatus,
        expectedAccountId,
      },
      ["label", "amount", "dueAt", "concept", "installmentNumber", "status", "expectedAccountId"],
    );
    if (!changes) continue;
    const applied = await database.expectedPayment.updateMany({
      where: { id: current.id, status: current.status, amount: current.amount, paidAmount: current.paidAmount, proofId: current.proofId, paymentId: current.paymentId },
      data: {
        label: item.label,
        amount: item.amount,
        dueAt: item.dueAt,
        concept: item.concept,
        installmentNumber: item.installmentNumber,
        status: nextStatus,
        expectedAccountId,
        // Al reactivar un concepto el motivo viejo ya no aplica.
        ...(reviving ? { reviewNote: null, reviewedAt: null, reviewedByName: null, cancelledAt: null } : {}),
      },
    });
    if (!applied.count) throw new QuoteComparisonError(409, "El concepto cambió mientras se sincronizaba. Actualizá el plan: se conservó el cobro o comprobante concurrente.");
    result.updated += 1;
  }

  // Conceptos que salieron del plan: se cancelan (lo confirmado queda). Las
  // partes de una división manual (`split:`) no son del plan: se respetan.
  for (const row of existing.values()) {
    if (row.status === "CONFIRMED" || row.status === "PARTIAL" || row.status === "PROOF" || row.status === "CANCELLED" || row.paidAmount > 0 || row.proofId || row.paymentId || row.label.includes(" · parte ") || row.slot.startsWith("split:")) continue;
    const applied = await database.expectedPayment.updateMany({
      where: { id: row.id, status: row.status, amount: row.amount, paidAmount: row.paidAmount, proofId: row.proofId, paymentId: row.paymentId },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    if (!applied.count) throw new QuoteComparisonError(409, "El concepto cambió mientras se cancelaba. Se conservó el cobro o comprobante concurrente.");
    result.cancelled += 1;
  }

  result.total = desired.length;
  if ((result.created > 0 || result.updated > 0 || result.cancelled > 0) && input.actor) {
    const parts = [
      result.created > 0 ? `${result.created} generado${result.created === 1 ? "" : "s"}` : null,
      result.updated > 0 ? `${result.updated} actualizado${result.updated === 1 ? "" : "s"}` : null,
      result.cancelled > 0 ? `${result.cancelled} cancelado${result.cancelled === 1 ? "" : "s"}` : null,
    ].filter((part): part is string => Boolean(part));
    await recordAudit({
      context: input.actor,
      action: "update",
      entity: "ExpectedPayment",
      entityId: budget.id,
      summary: `Sincronizó los pagos esperados del presupuesto «${budget.title}» de «${clientLabel(budget.client)}»${
        input.reason ? ` (${input.reason})` : ""
      }`,
      detail: {
        fields: {
          created: result.created,
          updated: result.updated,
          cancelled: result.cancelled,
          plan: desired.map((item) => `${item.label} ${item.amount}`),
        },
      },
    });
  }
  return result;
}

// ── Confirmación en cuenta y observación ────────────────────────────────────

export type ConfirmExpectedOutcome =
  | {
      ok: true;
      alreadyConfirmed: boolean;
      expectedPayment: ExpectedPaymentWithRefs;
      /** Se creó el movimiento de entrada ahora (false si el cobro ya estaba registrado). */
      movementCreated: boolean;
      /** Monto aplicado en esta confirmación (issue #129): la seña o el saldo. */
      appliedAmount: number;
      /** Saldo pendiente después de aplicar (0 en la confirmación completa). */
      remaining: number;
      /** Cobro creado/cobrado en la confirmación (issue #129). */
      paymentId: string | null;
    }
  | { ok: false; status: number; error: string };

export type SplitExpectedOutcome =
  | {
      ok: true;
      /** Concepto original, ahora la primera parte. */
      expectedPayment: ExpectedPaymentWithRefs;
      /** Partes nuevas (2..N) del saldo. */
      parts: ExpectedPayment[];
    }
  | { ok: false; status: number; error: string };

/** Tope de partes de una división de saldo (issue #129). */
export const MAX_SPLIT_PARTS = 12;

export type RejectExpectedOutcome =
  | { ok: true; expectedPayment: ExpectedPayment }
  | { ok: false; status: number; error: string };

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Confirma el pago esperado en una cuenta de tesorería: crea (o cobra, si ya
 * había un cobro a plazo vinculado al comprobante) el `ClientPayment`
 * `RECEIVED` y su movimiento de entrada en la **misma transacción**, vincula
 * comprobante y pago esperado y deja la traza del actor. Idempotente: el
 * `updateMany` condicional por estado (y por saldo) es el candado; un segundo
 * intento devuelve `alreadyConfirmed` sin duplicar nada.
 *
 * Cobro parcial / seña (issue #129): con `amount` menor al saldo pendiente se
 * registra el cobro por ese monto, el concepto queda `PARTIAL` con
 * `paidAmount` acumulado y el saldo sigue pendiente de completar. Sin `amount`
 * se confirma el saldo pendiente completo (`CONFIRMED`). El monto nunca puede
 * superar el saldo y un comprobante con cobro a plazo vinculado se cobra
 * completo (no se parte para no dejar el cobro a plazo colgado).
 *
 * La fecha del cobro es la elegida en el panel o el instante actual y el método
 * sale del panel/contrato de métodos (por defecto, transferencia).
 */
export async function confirmExpectedPayment(input: {
  organizationId: string;
  expectedPaymentId: string;
  accountId?: string | null;
  /** Monto a confirmar (issue #129): menor al saldo registra una seña. */
  amount?: number | null;
  /** Método del cobro (issue #129); por defecto, transferencia. */
  method?: string | null;
  actor: AuditContext;
  collectedAt?: Date | null;
  reference?: string | null;
  notes?: string | null;
}): Promise<ConfirmExpectedOutcome> {
  const expected = await db.expectedPayment.findFirst({
    where: { id: input.expectedPaymentId, organizationId: input.organizationId },
    include: expectedInclude,
  });
  if (!expected) return { ok: false, status: 404, error: "Pago esperado no encontrado." };
  if (expected.status === "CANCELLED") {
    return { ok: false, status: 409, error: "El pago esperado está cancelado: no se puede confirmar." };
  }
  const client = expected.budget.client;
  const remaining = Math.max(0, expected.amount - expected.paidAmount);
  if (expected.status === "CONFIRMED" || remaining === 0) {
    return {
      ok: true,
      alreadyConfirmed: true,
      expectedPayment: expected,
      movementCreated: false,
      appliedAmount: 0,
      remaining: 0,
      paymentId: expected.paymentId,
    };
  }

  // Monto aplicado: el pedido (seña) o el saldo completo.
  const requestedAmount = input.amount === undefined || input.amount === null ? remaining : Math.round(input.amount);
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount <= 0) {
    return { ok: false, status: 400, error: "El monto a confirmar tiene que ser un entero en guaraníes mayor a cero." };
  }
  if (requestedAmount > remaining) {
    return { ok: false, status: 400, error: `El monto no puede superar el saldo pendiente (${formatMoney(remaining)}).` };
  }
  const appliedAmount = requestedAmount;
  const isPartial = appliedAmount < remaining;
  const method = (input.method ?? "").trim().slice(0, 60) || "Transferencia";

  /** Cobro a plazo ya vinculado al comprobante (flujo del issue #17). */
  const pending = expected.proof?.payment?.status === "PENDING" ? expected.proof.payment : null;
  if (isPartial && pending) {
    return {
      ok: false,
      status: 409,
      error: "Este concepto tiene un cobro a plazo vinculado: cobralo completo o anulá ese cobro antes de registrar una seña.",
    };
  }

  const requested = input.accountId
    ? await db.treasuryAccount.findFirst({
        where: { id: input.accountId, organizationId: input.organizationId },
        select: accountSelect,
      })
    : undefined;
  if (input.accountId && !requested) return { ok: false, status: 404, error: "La cuenta no existe en esta empresa." };
  const account = requested ?? expected.expectedAccount ?? (await firstActiveAccount(input.organizationId));
  if (!account) {
    return { ok: false, status: 400, error: "Creá una cuenta de tesorería antes de confirmar el pago." };
  }

  /** Fecha real del cobro elegida en el panel (día de Asunción); por defecto, ahora. */
  const collectedAt = input.collectedAt ?? new Date();
  /** Instante real de la confirmación: es la traza de quién y cuándo confirmó. */
  const now = new Date();
  const reference = (input.reference ?? "").trim().slice(0, MAX_EXPECTED_REFERENCE) || null;
  const notes = (input.notes ?? "").trim().slice(0, MAX_EXPECTED_NOTE) || null;
  const paymentNotes = notes ?? `Pago esperado: ${expected.label}${isPartial ? " (seña)" : ""}`;
  const snapshot = collectionSnapshotOf({
    at: collectedAt,
    amount: appliedAmount,
    method,
    reference,
    client,
    budget: expected.budget,
    account,
  });

  const applied = await db.$transaction(async (tx) => {
    // Candado: solo escribe si el saldo no cambió desde la lectura (issue #129).
    const claimed = await tx.expectedPayment.updateMany({
      where: {
        id: expected.id,
        organizationId: input.organizationId,
        status: { in: ["AWAITING", "PROOF", "PARTIAL"] },
        paidAmount: expected.paidAmount,
        amount: expected.amount,
        proofId: expected.proofId,
        paymentId: expected.paymentId,
      },
      data: isPartial
        ? {
            status: "PARTIAL",
            paidAmount: expected.paidAmount + appliedAmount,
            expectedAccountId: account.id,
          }
        : {
            status: "CONFIRMED",
            paidAmount: expected.amount,
            confirmedAt: now,
            confirmedById: input.actor.user.id,
            confirmedByName: input.actor.user.name,
            confirmedByEmail: input.actor.user.email,
            expectedAccountId: account.id,
          },
    });
    if (claimed.count === 0) return null;

    /** Cobro a plazo ya vinculado al comprobante (flujo del issue #17). */
    let paymentId: string | null = null;
    let movementCreated = false;

    if (!isPartial && pending) {
      const collected = await tx.clientPayment.updateMany({
        where: { id: pending.id, organizationId: input.organizationId, status: "PENDING" },
        data: {
          status: "RECEIVED",
          // El cobro a plazo se cierra por lo realmente cobrado (issue #129).
          amount: appliedAmount,
          paidAt: collectedAt,
          collectedAt,
          treasuryAccountId: account.id,
          expectedPaymentId: expected.id,
          method,
          collectedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          ...(reference ? { reference } : {}),
        },
      });
      if (collected.count > 0) {
        paymentId = pending.id;
        await tx.treasuryMovement.create({
          data: {
            id: randomUUID(),
            organizationId: input.organizationId,
            accountId: account.id,
            direction: "IN",
            amount: appliedAmount,
            occurredAt: collectedAt,
            origin: "client_payment",
            sourceId: pending.id,
            notes: paymentNotes,
            createdById: input.actor.user.id,
            createdByName: input.actor.user.name,
            createdByEmail: input.actor.user.email,
          },
        });
        movementCreated = true;
      } else {
        // Se resolvió en paralelo: si ya estaba cobrado, se vincula sin duplicar
        // el movimiento; si se anuló, se registra el cobro de nuevo.
        const current = await tx.clientPayment.findFirst({
          where: { id: pending.id, organizationId: input.organizationId },
          select: { id: true, status: true },
        });
        if (current?.status === "RECEIVED") paymentId = current.id;
      }
    }

    if (!paymentId) {
      const created = await tx.clientPayment.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          clientId: client.id,
          budgetId: expected.budgetId,
          expectedPaymentId: expected.id,
          amount: appliedAmount,
          status: "RECEIVED",
          paidAt: collectedAt,
          collectedAt,
          method,
          reference,
          notes: paymentNotes,
          treasuryAccountId: account.id,
          collectedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      paymentId = created.id;
      await tx.treasuryMovement.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          accountId: account.id,
          direction: "IN",
          amount: appliedAmount,
          occurredAt: collectedAt,
          origin: "client_payment",
          sourceId: created.id,
          notes: paymentNotes,
          createdById: input.actor.user.id,
          createdByName: input.actor.user.name,
          createdByEmail: input.actor.user.email,
        },
      });
      movementCreated = true;
    }

    const updated = await tx.expectedPayment.update({
      where: { id: expected.id },
      data: isPartial ? {} : { paymentId },
      include: expectedInclude,
    });
    // El comprobante del portal queda colgado del cobro real (mismo binario, más traza).
    if (expected.proof && !expected.proof.paymentId) {
      await tx.budgetPaymentProof.update({ where: { id: expected.proof.id }, data: { paymentId } });
    }
    return { updated, paymentId, movementCreated };
  });

  const remainingAfter = isPartial ? remaining - appliedAmount : 0;
  if (!applied) {
    const current = await db.expectedPayment.findUnique({ where: { id: expected.id }, include: expectedInclude });
    return {
      ok: true,
      alreadyConfirmed: true,
      expectedPayment: current ?? expected,
      movementCreated: false,
      appliedAmount: 0,
      remaining: Math.max(0, expected.amount - expected.paidAmount),
      paymentId: null,
    };
  }

  await recordAudit({
    context: input.actor,
    action: "status",
    entity: "ExpectedPayment",
    entityId: expected.id,
    summary: isPartial
      ? `Registró una seña de ${formatMoney(appliedAmount)} del pago esperado «${expected.label}» de «${clientLabel(client)}» en «${account.name}» (saldo ${formatMoney(remainingAfter)})`
      : `Confirmó el pago esperado «${expected.label}» de «${clientLabel(client)}» en «${account.name}»${
          applied.movementCreated ? "" : " (el cobro ya estaba registrado: no se duplicó el movimiento)"
        }`,
    detail: {
      changes: {
        status: { from: expected.status, to: isPartial ? "PARTIAL" : "CONFIRMED" },
        expectedAccountId: { from: expected.expectedAccountId, to: account.id },
        paidAmount: { from: expected.paidAmount, to: expected.paidAmount + appliedAmount },
      },
      fields: {
        amount: appliedAmount,
        expectedAmount: expected.amount,
        remaining: remainingAfter,
        partial: isPartial,
        budgetId: expected.budgetId,
        paymentId: applied.paymentId,
        proofId: expected.proofId,
        movementCreated: applied.movementCreated,
        method,
        reference,
        collectedAt: isoDay(collectedAt),
      },
    },
  });

  return {
    ok: true,
    alreadyConfirmed: false,
    expectedPayment: applied.updated,
    movementCreated: applied.movementCreated,
    appliedAmount,
    remaining: remainingAfter,
    paymentId: applied.paymentId,
  };
}

/**
 * Divide el saldo pendiente de un concepto en partes con vencimiento (issue
 * #129): la seña ya cobrada queda en el concepto original, que pasa a ser la
 * primera parte, y las demás nacen como saldos nuevos (`split:`), fuera del
 * plan automático. Las partes tienen que sumar exactamente el saldo pendiente:
 * no se inventa ni se pierde plata, y todo queda auditado.
 */
export async function splitExpectedPayment(input: {
  organizationId: string;
  expectedPaymentId: string;
  parts: Array<{ amount: number; dueAt?: string | null }>;
  actor: AuditContext;
}): Promise<SplitExpectedOutcome> {
  const expected = await db.expectedPayment.findFirst({
    where: { id: input.expectedPaymentId, organizationId: input.organizationId },
    include: expectedInclude,
  });
  if (!expected) return { ok: false, status: 404, error: "Pago esperado no encontrado." };
  if (expected.status === "CONFIRMED" || expected.status === "CANCELLED") {
    return { ok: false, status: 409, error: "El pago esperado ya está cerrado: no se puede dividir." };
  }
  const remaining = Math.max(0, expected.amount - expected.paidAmount);
  if (remaining <= 0) {
    return { ok: false, status: 409, error: "El pago esperado no tiene saldo pendiente para dividir." };
  }
  if (!Array.isArray(input.parts) || input.parts.length < 2 || input.parts.length > MAX_SPLIT_PARTS) {
    return { ok: false, status: 400, error: `Dividí el saldo en 2 a ${MAX_SPLIT_PARTS} partes.` };
  }

  const parts = input.parts.map((part) => {
    const amount = Math.round(Number(part.amount));
    const dueDay = part.dueAt ? String(part.dueAt).trim().slice(0, 10) : "";
    return {
      amount,
      dueAt: dueDay || null,
      valid: Number.isSafeInteger(amount) && amount > 0 && (!dueDay || isValidDayKey(dueDay)),
    };
  });
  if (parts.some((part) => !part.valid)) {
    return { ok: false, status: 400, error: "Cada parte necesita un monto en guaraníes mayor a cero y un vencimiento válido (o vacío)." };
  }
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total !== remaining) {
    return { ok: false, status: 400, error: `Las partes tienen que sumar el saldo pendiente (${formatMoney(remaining)}).` };
  }

  const client = expected.budget.client;
  const applied = await db.$transaction(async (tx) => {
    // Candado: el saldo no puede haber cambiado desde la lectura.
    const claimed = await tx.expectedPayment.updateMany({
      where: {
        id: expected.id,
        organizationId: input.organizationId,
        status: { in: ["AWAITING", "PROOF", "PARTIAL"] },
        paidAmount: expected.paidAmount,
      },
      data: {
        // La primera parte queda en el concepto original (conserva su seña).
        amount: expected.paidAmount + parts[0].amount,
        label: `${expected.label} · parte 1/${parts.length}`,
        status: expected.paidAmount > 0 ? "PARTIAL" : "AWAITING",
        dueAt: parts[0].dueAt ? dayStart(parts[0].dueAt) : null,
      },
    });
    if (claimed.count === 0) return null;

    const created: ExpectedPayment[] = [];
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index];
      created.push(
        await tx.expectedPayment.create({
          data: {
            id: randomUUID(),
            organizationId: input.organizationId,
            budgetId: expected.budgetId,
            concept: "balance",
            slot: `split:${randomUUID()}`,
            installmentNumber: null,
            label: `${expected.label} · parte ${index + 1}/${parts.length}`,
            amount: part.amount,
            dueAt: part.dueAt ? dayStart(part.dueAt) : null,
            status: "AWAITING",
            expectedAccountId: expected.expectedAccountId,
          },
        }),
      );
    }
    const updated = await tx.expectedPayment.findUniqueOrThrow({ where: { id: expected.id }, include: expectedInclude });
    return { updated, created };
  });

  if (!applied) {
    return { ok: false, status: 409, error: "El pago esperado cambió mientras lo dividías: volvé a intentar." };
  }

  await recordAudit({
    context: input.actor,
    action: "update",
    entity: "ExpectedPayment",
    entityId: expected.id,
    summary: `Dividió el saldo de «${expected.label}» de «${clientLabel(client)}» en ${parts.length} partes (${formatMoney(remaining)})`,
    detail: {
      changes: { amount: { from: expected.amount, to: expected.paidAmount + parts[0].amount } },
      fields: {
        budgetId: expected.budgetId,
        paidAmount: expected.paidAmount,
        remaining,
        parts: parts.map((part) => ({ amount: part.amount, dueAt: part.dueAt })),
        createdIds: applied.created.map((row) => row.id),
      },
    },
  });

  return { ok: true, expectedPayment: applied.updated, parts: applied.created };
}

/**
 * Observa o rechaza el pago esperado con un motivo: vuelve a `AWAITING` (el
 * comprobante queda en el historial) y el motivo viaja al portal para que el
 * cliente sepa qué corregir. No toca un pago confirmado ni uno cancelado.
 */
export async function reviewExpectedPayment(input: {
  organizationId: string;
  expectedPaymentId: string;
  note: string;
  actor: AuditContext;
}): Promise<RejectExpectedOutcome> {
  const note = input.note.trim();
  if (!note) return { ok: false, status: 400, error: "Indicá el motivo de la observación." };
  if (note.length > MAX_EXPECTED_NOTE) {
    return { ok: false, status: 400, error: `El motivo no puede superar los ${MAX_EXPECTED_NOTE} caracteres.` };
  }

  const expected = await db.expectedPayment.findFirst({
    where: { id: input.expectedPaymentId, organizationId: input.organizationId },
    include: expectedInclude,
  });
  if (!expected) return { ok: false, status: 404, error: "Pago esperado no encontrado." };
  if (expected.status === "CONFIRMED") {
    return { ok: false, status: 409, error: "El pago ya está confirmado en una cuenta: no se puede observar." };
  }
  if (expected.status === "CANCELLED") {
    return { ok: false, status: 409, error: "El pago esperado está cancelado: no se puede observar." };
  }

  const now = new Date();
  const applied = await db.expectedPayment.updateMany({
    where: {
      id: expected.id,
      organizationId: input.organizationId,
      status: { in: ["AWAITING", "PROOF"] },
    },
    data: {
      status: "AWAITING",
      reviewNote: note,
      reviewedAt: now,
      reviewedByName: input.actor.user.name,
    },
  });
  if (applied.count === 0) {
    return { ok: false, status: 409, error: "El pago esperado cambió de estado: volvé a intentar." };
  }

  await recordAudit({
    context: input.actor,
    action: "status",
    entity: "ExpectedPayment",
    entityId: expected.id,
    summary: `Observó el pago esperado «${expected.label}» de «${clientLabel(expected.budget.client)}»: ${note}`,
    detail: {
      changes: { status: { from: expected.status, to: "AWAITING" } },
      fields: { reviewNote: note, amount: expected.amount, budgetId: expected.budgetId, proofId: expected.proofId },
    },
  });

  const updated = await db.expectedPayment.findUnique({ where: { id: expected.id } });
  return { ok: true, expectedPayment: updated ?? expected };
}
