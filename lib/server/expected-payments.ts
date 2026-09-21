import { randomUUID } from "node:crypto";
import type { ExpectedPayment, Prisma } from "@prisma/client";
import { db } from "./db";
import { parseInstallments } from "./budget-portal";
import { clientLabel, dayKeyOf, dayStart } from "./notifications";
import { auditChanges, recordAudit, type AuditContext } from "./audit";

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
export type ExpectedStatusValue = "AWAITING" | "PROOF" | "CONFIRMED" | "CANCELLED";

export type ExpectedPlanItem = {
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
    where: { organizationId, active: true },
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
    items.push({
      slot: `installment:${index + 1}`,
      concept: "installment",
      installmentNumber: index + 1,
      label: installment.label || `Cuota ${index + 1}`,
      amount: installment.amount,
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
  organizationId: string;
  budgetId: string;
  actor?: AuditContext | null;
  /** Motivo del cambio para el resumen de auditoría (aprobación o plan). */
  reason?: string;
}): Promise<ExpectedSyncResult> {
  const result: ExpectedSyncResult = { created: 0, updated: 0, cancelled: 0, total: 0 };
  const budget = await db.budget.findFirst({
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
        },
      },
    },
  });
  // Sin aprobación no hay promesa de pago: no se inventa dinero esperado.
  if (!budget || !budget.approvedAt) return result;

  const desired = budgetExpectedPlan(budget);
  const existing = new Map(budget.expectedPayments.map((row) => [row.slot, row]));
  const now = new Date();
  let defaultAccountId: string | null | undefined;
  const resolveDefaultAccount = async () => {
    if (defaultAccountId === undefined) {
      defaultAccountId = (await firstActiveAccount(input.organizationId))?.id ?? null;
    }
    return defaultAccountId;
  };

  for (const item of desired) {
    const current = existing.get(item.slot);
    if (!current) {
      const accountId = await resolveDefaultAccount();
      await db.expectedPayment.create({
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
    // Lo confirmado no se pisa: la plata ya entró con sus valores reales.
    if (current.status === "CONFIRMED") continue;

    const nextStatus: ExpectedStatusValue = current.status === "CANCELLED" ? "AWAITING" : (current.status as ExpectedStatusValue);
    const reviving = current.status === "CANCELLED";
    const expectedAccountId = current.expectedAccountId ?? (await resolveDefaultAccount());
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
    await db.expectedPayment.update({
      where: { id: current.id },
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
    result.updated += 1;
  }

  // Conceptos que salieron del plan: se cancelan (lo confirmado queda).
  for (const row of existing.values()) {
    if (row.status === "CONFIRMED" || row.status === "CANCELLED") continue;
    await db.expectedPayment.update({
      where: { id: row.id },
      data: { status: "CANCELLED", cancelledAt: now },
    });
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
    }
  | { ok: false; status: number; error: string };

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
 * `updateMany` condicional por estado es el candado; un segundo intento
 * devuelve `alreadyConfirmed` sin duplicar nada.
 *
 * El monto confirmado es el del pago esperado real (no se inventa un monto
 * nuevo) y la fecha del cobro es la elegida en el panel o el instante actual.
 */
export async function confirmExpectedPayment(input: {
  organizationId: string;
  expectedPaymentId: string;
  accountId?: string | null;
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
  if (expected.status === "CONFIRMED") {
    return {
      ok: true,
      alreadyConfirmed: true,
      expectedPayment: expected,
      movementCreated: false,
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
  const client = expected.budget.client;

  const applied = await db.$transaction(async (tx) => {
    // Candado de idempotencia: solo la primera confirmación escribe.
    const claimed = await tx.expectedPayment.updateMany({
      where: {
        id: expected.id,
        organizationId: input.organizationId,
        status: { in: ["AWAITING", "PROOF"] },
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: now,
        confirmedById: input.actor.user.id,
        confirmedByName: input.actor.user.name,
        confirmedByEmail: input.actor.user.email,
        expectedAccountId: account.id,
      },
    });
    if (claimed.count === 0) return null;

    /** Cobro a plazo ya vinculado al comprobante (flujo del issue #17). */
    const pending = expected.proof?.payment?.status === "PENDING" ? expected.proof.payment : null;
    let paymentId: string | null = null;
    let movementCreated = false;

    if (pending) {
      const collected = await tx.clientPayment.updateMany({
        where: { id: pending.id, organizationId: input.organizationId, status: "PENDING" },
        data: {
          status: "RECEIVED",
          paidAt: collectedAt,
          collectedAt,
          treasuryAccountId: account.id,
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
            amount: expected.amount,
            occurredAt: collectedAt,
            origin: "client_payment",
            sourceId: pending.id,
            notes: notes ?? `Pago esperado: ${expected.label}`,
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
          amount: expected.amount,
          status: "RECEIVED",
          paidAt: collectedAt,
          collectedAt,
          method: "Transferencia",
          reference,
          notes: notes ?? `Pago esperado: ${expected.label}`,
          treasuryAccountId: account.id,
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
          amount: expected.amount,
          occurredAt: collectedAt,
          origin: "client_payment",
          sourceId: created.id,
          notes: notes ?? `Pago esperado: ${expected.label}`,
          createdById: input.actor.user.id,
          createdByName: input.actor.user.name,
          createdByEmail: input.actor.user.email,
        },
      });
      movementCreated = true;
    }

    const updated = await tx.expectedPayment.update({
      where: { id: expected.id },
      data: { paymentId },
      include: expectedInclude,
    });
    // El comprobante del portal queda colgado del cobro real (mismo binario, más traza).
    if (expected.proof && !expected.proof.paymentId) {
      await tx.budgetPaymentProof.update({ where: { id: expected.proof.id }, data: { paymentId } });
    }
    return { updated, paymentId, movementCreated };
  });

  if (!applied) {
    const current = await db.expectedPayment.findUnique({ where: { id: expected.id }, include: expectedInclude });
    return { ok: true, alreadyConfirmed: true, expectedPayment: current ?? expected, movementCreated: false };
  }

  await recordAudit({
    context: input.actor,
    action: "status",
    entity: "ExpectedPayment",
    entityId: expected.id,
    summary: `Confirmó el pago esperado «${expected.label}» de «${clientLabel(client)}» en «${account.name}»${
      applied.movementCreated ? "" : " (el cobro ya estaba registrado: no se duplicó el movimiento)"
    }`,
    detail: {
      changes: {
        status: { from: expected.status, to: "CONFIRMED" },
        expectedAccountId: { from: expected.expectedAccountId, to: account.id },
      },
      fields: {
        amount: expected.amount,
        budgetId: expected.budgetId,
        paymentId: applied.paymentId,
        proofId: expected.proofId,
        movementCreated: applied.movementCreated,
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
  };
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
