import { randomUUID } from "node:crypto";
import type { Prisma, RentalChargeKind } from "@prisma/client";
import { budgetMoneyValid } from "../budget-payment-plan";
import { countsTowardBudgetBalance, DEPOSIT_RESERVE_ORIGIN, DEPOSIT_RETAINED_ORIGIN } from "../payment-origin";
import { securityDepositAmountValid } from "../budget-security-deposit";
import {
  cancellationPolicyLines,
  cancellationRetention,
  customChargeAmount,
  damageCharge,
  isDepositPurpose,
  lateFeeAmount,
  lateUnits,
  offeredCustomCharges,
  settleRental,
  suggestSecurityDeposit,
  type CustomChargeType,
  type DepositPurpose,
  type LateFeeConfig,
} from "../rental-charges";
import { recordAudit, type AuditContext } from "./audit";
import { db } from "./db";
import { syncBudgetExpectedPayments } from "./expected-payments";
import { collectionSnapshotOf } from "./finance-snapshots";
import { getRentalSettings, toRentalSettingsView } from "./rental-settings";

/**
 * Cargos de la devolución y liquidación con la garantía (alquileres P1-4).
 *
 * - `proposeReturnCharges` corre DENTRO de la transacción de `returnAssignment`: deja
 *   cargos PROPOSED (recargo por demora, roturas, faltantes). Es idempotente por
 *   `dedupeKey` y nunca falla la devolución.
 * - El equipo de finanzas (`budgets.write`) aplica, condona (con motivo), edita o agrega cargos.
 * - `settleBudgetRental` corre en UNA transacción con `FOR UPDATE` del presupuesto: la segunda
 *   llamada ve `rentalSettledAt` y no escribe nada. No toca `Budget.total`.
 *
 * Todo está acotado a la empresa del contexto; un presupuesto ajeno responde 404.
 */
export class RentalSettlementError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

const GARANTIA_RETENIDA = "Garantía retenida";
const GARANTIA_RESERVA = "Garantía de reserva";
export const EXTRA_SLOT = "extra:settlement";

async function lockBudget(tx: Tx, budgetId: string, organizationId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (locked.length === 0) throw new RentalSettlementError(404, "Presupuesto no encontrado.");
  return tx.budget.findUniqueOrThrow({
    where: { id: budgetId },
    select: {
      id: true,
      title: true,
      total: true,
      clientId: true,
      eventId: true,
      securityDeposit: true,
      securityDepositStatus: true,
      securityDepositRetained: true,
      securityDepositPurpose: true,
      rentalSettledAt: true,
      rentalSettlement: true,
      client: { select: { id: true, name: true, company: true } },
    },
  });
}

async function accountFor(tx: Tx, organizationId: string, accountId?: string | null) {
  const account = accountId
    ? await tx.treasuryAccount.findFirst({ where: { id: accountId, organizationId, active: true }, select: { id: true, name: true } })
    : await tx.treasuryAccount.findFirst({ where: { organizationId, active: true, currency: "PYG" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  if (!account) throw new RentalSettlementError(accountId ? 404 : 400, accountId ? "La cuenta no existe en esta empresa." : "Creá una cuenta de tesorería antes de registrar el cobro.");
  return account;
}

/** Cobro confirmado + movimiento de tesorería (misma forma que la confirmación de un pago esperado). */
async function recordIncome(
  tx: Tx,
  context: AuditContext,
  input: {
    budget: { id: string; title: string; total: number; client: { id: string; name: string; company: string | null } };
    amount: number;
    method: string;
    notes: string;
    /** Ver `lib/payment-origin.ts`: qué clase de cobro es (no baja el saldo, o es la garantía de reserva). */
    origin: string;
    /** Concepto del plan que este cobro imputa (solo la garantía de reserva). */
    expectedPaymentId?: string | null;
    accountId?: string | null;
    at: Date;
  },
) {
  const account = await accountFor(tx, context.organizationId, input.accountId);
  const payment = await tx.clientPayment.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      clientId: input.budget.client.id,
      budgetId: input.budget.id,
      amount: input.amount,
      status: "RECEIVED",
      paidAt: input.at,
      collectedAt: input.at,
      method: input.method,
      notes: input.notes,
      treasuryAccountId: account.id,
      origin: input.origin,
      expectedPaymentId: input.expectedPaymentId ?? null,
      collectedSnapshot: collectionSnapshotOf({ at: input.at, amount: input.amount, method: input.method, client: input.budget.client, budget: input.budget, account }) as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await tx.treasuryMovement.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      accountId: account.id,
      direction: "IN",
      amount: input.amount,
      occurredAt: input.at,
      origin: "client_payment",
      sourceId: payment.id,
      notes: input.notes,
      createdById: context.user.id,
      createdByName: context.user.name,
      createdByEmail: context.user.email,
    },
  });
  return { paymentId: payment.id, accountName: account.name };
}

// ── Garantía de reserva: al recibirla se imputa al plan ──────────────────────

/**
 * Una garantía de RESERVA es parte del pago del alquiler: al marcarla recibida entra como cobro
 * confirmado («Garantía de reserva») y se IMPUTA al plan igual que cualquier cobro (seña primero,
 * después cuotas y saldo): los pagos esperados bajan su saldo y las dos vistas (total − cobrado y
 * suma de pendientes del plan) coinciden. Si no hay plan (presupuesto sin aprobar) o sobra plata,
 * el resto queda como un cobro libre del presupuesto, que igual baja el saldo.
 *
 * La llama `transitionBudgetSecurityDeposit` dentro de su transacción y con el presupuesto ya
 * bloqueado, así que corre una sola vez por garantía. Devuelve el primer cobro creado.
 */
export async function receiveReserveDeposit(tx: Tx, context: AuditContext, budgetId: string): Promise<{ paymentId: string } | null> {
  const budget = await tx.budget.findFirst({
    where: { id: budgetId, organizationId: context.organizationId },
    select: { id: true, title: true, total: true, securityDeposit: true, securityDepositPurpose: true, client: { select: { id: true, name: true, company: true } } },
  });
  if (!budget || budget.securityDepositPurpose !== "RESERVE" || !securityDepositAmountValid(budget.securityDeposit)) return null;
  const now = new Date();
  const notes = `Garantía de reserva del presupuesto «${budget.title}»`;
  const account = await accountFor(tx, context.organizationId, null);
  try {
    // Asegura que existan la seña y el saldo del plan (idempotente; sin aprobar no crea nada).
    await syncBudgetExpectedPayments({ tx, organizationId: context.organizationId, budgetId });
  } catch (error) {
    console.error("[rental-charges] no se pudo sincronizar el plan antes de imputar la garantía de reserva", error);
  }
  const rank = (concept: string) => (concept === "advance" ? 0 : concept === "installment" ? 1 : concept === "balance" ? 2 : 3);
  const open = (
    await tx.expectedPayment.findMany({
      where: { organizationId: context.organizationId, budgetId, concept: { not: "extra" }, status: { in: ["AWAITING", "PARTIAL"] } },
    })
  ).sort((a, b) => rank(a.concept) - rank(b.concept) || (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  let left = budget.securityDeposit;
  let firstPaymentId: string | null = null;
  for (const row of open) {
    if (left <= 0) break;
    const remaining = row.amount - row.paidAmount;
    if (remaining <= 0) continue;
    const applied = Math.min(remaining, left);
    const full = applied === remaining;
    // Mismo candado que la confirmación de un pago esperado: solo escribe si el saldo no cambió.
    const claimed = await tx.expectedPayment.updateMany({
      where: { id: row.id, organizationId: context.organizationId, status: row.status, paidAmount: row.paidAmount, amount: row.amount, proofId: row.proofId, paymentId: row.paymentId },
      data: full
        ? { status: "CONFIRMED", paidAmount: row.amount, confirmedAt: now, confirmedById: context.user.id, confirmedByName: context.user.name, confirmedByEmail: context.user.email, expectedAccountId: account.id }
        : { status: "PARTIAL", paidAmount: row.paidAmount + applied, expectedAccountId: account.id },
    });
    if (claimed.count === 0) continue;
    const income = await recordIncome(tx, context, { budget, amount: applied, method: GARANTIA_RESERVA, notes, origin: DEPOSIT_RESERVE_ORIGIN, expectedPaymentId: row.id, at: now });
    firstPaymentId ??= income.paymentId;
    left -= applied;
  }
  if (left > 0 || firstPaymentId === null) {
    const income = await recordIncome(tx, context, { budget, amount: left, method: GARANTIA_RESERVA, notes, origin: DEPOSIT_RESERVE_ORIGIN, at: now });
    firstPaymentId ??= income.paymentId;
  }
  return { paymentId: firstPaymentId };
}

// ── Propuesta de cargos al devolver ─────────────────────────────────────────

type ProposeInput = {
  organizationId: string;
  /** La asignación tal como estaba ANTES de esta devolución. */
  assignment: { id: string; inventoryId: string; eventId: string; budgetId: string | null; quantity: number; endsAt: Date | null; returnedQuantity: number; inventory: { name: string; replacementCost: number }; event: { endsAt: Date | null; strikeAt: Date | null } };
  incidents: Array<{ id: string; kind: string; quantity: number }>;
  returnedAt: Date;
  /** Unidades que volvieron en esta devolución (incluye dañadas) y las que no volvieron. */
  returnedNow: number;
  missingNow: number;
};

export function lateConfigOf(settings: { lateFeeKind: LateFeeConfig["kind"]; lateFeeUnit: LateFeeConfig["unit"]; lateFeeValue: number; lateGraceMinutes: number }): LateFeeConfig {
  return { kind: settings.lateFeeKind, unit: settings.lateFeeUnit, value: settings.lateFeeValue, graceMinutes: settings.lateGraceMinutes };
}

async function budgetForAssignment(tx: Tx, organizationId: string, assignment: ProposeInput["assignment"]) {
  const select = { id: true, rentalSettledAt: true, items: { select: { inventoryId: true, quantity: true, days: true, unitPrice: true, excluded: true } } } as const;
  let found: { id: string } | null = null;
  if (assignment.budgetId) found = await tx.budget.findFirst({ where: { id: assignment.budgetId, organizationId }, select: { id: true } });
  found ??= await tx.budget.findFirst({ where: { organizationId, eventId: assignment.eventId, status: { in: ["APPROVED", "SENT", "DRAFT"] } }, orderBy: [{ approvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], select: { id: true } });
  if (!found) return null;
  // Lock del presupuesto (ORDEN DE LOCKS, ver abajo) y relectura: si la liquidación terminó
  // mientras esperábamos, `rentalSettledAt` ya viene seteado y no se proponen cargos.
  await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${found.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
  return tx.budget.findFirst({ where: { id: found.id, organizationId }, select });
}

/**
 * ORDEN DE LOCKS (devolución y liquidación, para no abrazarse nunca):
 *   1. `InventoryItem` (`lockInventoryItems`, ids ordenados), 2. `Budget` (`FOR UPDATE`).
 * La devolución toma 1 y después 2 (acá); la liquidación toma solo 2, así que ninguna espera un
 * lock de menor orden teniendo uno de mayor. Quien necesite los dos tiene que respetar ese orden.
 * Con el presupuesto bloqueado se vuelve a comprobar `rentalSettledAt`: un presupuesto ya
 * liquidado no recibe cargos PROPOSED nuevos (la liquidación sumó los que existían).
 *
 * Deja los cargos PROPOSED de una devolución. No lanza: un problema se registra en consola y la
 * devolución sigue. Sin presupuesto del evento no hay a quién cargar y no se inventa nada.
 */
export async function proposeReturnCharges(tx: Tx, input: ProposeInput): Promise<number> {
  try {
    const budget = await budgetForAssignment(tx, input.organizationId, input.assignment);
    if (!budget || budget.rentalSettledAt) return 0;
    const settings = toRentalSettingsView(await tx.organizationRentalSettings.findUnique({ where: { organizationId: input.organizationId } }));
    const { assignment } = input;
    const rows: Prisma.RentalChargeCreateManyInput[] = [];
    const base = { id: "", organizationId: input.organizationId, budgetId: budget.id, eventId: assignment.eventId, assignmentId: assignment.id, inventoryId: assignment.inventoryId };

    for (const incident of input.incidents) {
      if (incident.kind !== "DAMAGE" && incident.kind !== "MISSING") continue;
      const kind: RentalChargeKind = incident.kind;
      const { unitAmount, amount } = damageCharge(assignment.inventory.replacementCost, incident.quantity, settings.damageChargePercent);
      rows.push({
        ...base,
        id: randomUUID(),
        incidentId: incident.id,
        kind,
        label: `${kind === "DAMAGE" ? "Rotura" : "Faltante"}: ${assignment.inventory.name}`,
        quantity: incident.quantity,
        unitAmount,
        amount,
        dedupeKey: `incident:${incident.id}:${kind}`,
        note: assignment.inventory.replacementCost > 0 ? null : "Sin costo de reposición cargado: definí el monto.",
      });
    }

    const dueAt = assignment.endsAt ?? assignment.event.endsAt ?? assignment.event.strikeAt;
    if (dueAt && input.returnedNow + input.missingNow > 0) {
      const config = lateConfigOf(settings);
      const { units, lateMinutes } = lateUnits(config, dueAt, input.returnedAt);
      if (units > 0) {
        if (config.kind === "FIXED") {
          const { unitAmount, amount } = lateFeeAmount(config, 0, units);
          if (amount > 0) await upsertEventLateCharge(tx, { ...base, budgetId: budget.id }, { unitAmount, units, amount, lateMinutes });
        } else {
          const line = budget.items.filter((item) => item.inventoryId === assignment.inventoryId && !item.excluded).reduce((sum, item) => sum + item.quantity * item.days * item.unitPrice, 0);
          const lineQuantity = budget.items.filter((item) => item.inventoryId === assignment.inventoryId && !item.excluded).reduce((sum, item) => sum + item.quantity, 0);
          // Base = lo que costó el alquiler de las piezas que volvieron tarde (proporcional a la cantidad).
          const share = lineQuantity > 0 ? Math.min(1, (input.returnedNow + input.missingNow) / lineQuantity) : 0;
          const { unitAmount, amount } = lateFeeAmount(config, Math.round(line * share), units);
          if (amount > 0) {
            rows.push({
              ...base,
              id: randomUUID(),
              kind: "LATE",
              label: `Demora: ${assignment.inventory.name} (${describeLate(config, units)})`,
              quantity: units,
              unitAmount,
              amount,
              dedupeKey: `late:${assignment.id}:${assignment.returnedQuantity}`,
            });
          }
        }
      }
    }
    if (rows.length === 0) return 0;
    const created = await tx.rentalCharge.createMany({ data: rows, skipDuplicates: true });
    return created.count;
  } catch (error) {
    console.error("[rental-charges] no se pudieron proponer los cargos de la devolución", error);
    return 0;
  }
}

function describeLate(config: LateFeeConfig, units: number): string {
  return `${units} ${config.unit === "DAY" ? (units === 1 ? "día" : "días") : units === 1 ? "hora" : "horas"} tarde`;
}

/** Recargo FIJO: uno por evento. Si una devolución posterior llega más tarde, sube mientras siga propuesto. */
async function upsertEventLateCharge(tx: Tx, base: Pick<Prisma.RentalChargeCreateManyInput, "organizationId" | "budgetId" | "eventId">, late: { unitAmount: number; units: number; amount: number; lateMinutes: number }) {
  const dedupeKey = `late:event:${base.eventId}`;
  const existing = await tx.rentalCharge.findUnique({ where: { budgetId_dedupeKey: { budgetId: base.budgetId, dedupeKey } } });
  if (!existing) {
    await tx.rentalCharge.createMany({
      data: [{ ...base, id: randomUUID(), kind: "LATE", label: `Demora en la devolución (${late.units} ${late.units === 1 ? "unidad" : "unidades"} de demora)`, quantity: late.units, unitAmount: late.unitAmount, amount: late.amount, dedupeKey }],
      skipDuplicates: true,
    });
    return;
  }
  if (existing.status === "PROPOSED" && late.units > existing.quantity) {
    await tx.rentalCharge.update({ where: { id: existing.id }, data: { quantity: late.units, amount: late.amount, label: `Demora en la devolución (${late.units} ${late.units === 1 ? "unidad" : "unidades"} de demora)` } });
  }
}

// ── Lectura para el panel ───────────────────────────────────────────────────

export type RentalChargeRow = {
  id: string;
  kind: RentalChargeKind;
  status: "PROPOSED" | "APPLIED" | "WAIVED";
  label: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  reason: string | null;
  note: string | null;
  incidentId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
};

const toRow = (row: { id: string; kind: RentalChargeKind; status: "PROPOSED" | "APPLIED" | "WAIVED"; label: string; quantity: number; unitAmount: number; amount: number; reason: string | null; note: string | null; incidentId: string | null; decidedByName: string | null; decidedAt: Date | null }): RentalChargeRow => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  label: row.label,
  quantity: row.quantity,
  unitAmount: row.unitAmount,
  amount: row.amount,
  reason: row.reason,
  note: row.note,
  incidentId: row.incidentId,
  decidedByName: row.decidedByName,
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

export type SettlementView = {
  budgetId: string;
  charges: RentalChargeRow[];
  offers: Array<{ typeId: string; name: string; amount: number; unit: "PIECE" | "EVENT"; suggestedQuantity: number }>;
  purpose: DepositPurpose;
  deposit: { amount: number; status: string | null } | null;
  /** `pending` = faltan equipos por volver: no se puede liquidar todavía. */
  equipmentReturn: "none" | "pending" | "returned";
  appliedTotal: number;
  proposedCount: number;
  /** Lo que resultaría de liquidar hoy (vista previa; el servidor recalcula al liquidar). */
  preview: ReturnType<typeof settleRental>;
  settled: SettledSnapshot | null;
};

export type SettledSnapshot = { at: string; byName: string; purpose: DepositPurpose; chargesTotal: number; retained: number; returned: number; extra: number; depositStatus: string | null };

function readSettled(value: unknown): SettledSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== "string") return null;
  return {
    at: record.at,
    byName: typeof record.byName === "string" ? record.byName : "",
    purpose: isDepositPurpose(record.purpose) ? record.purpose : "DAMAGES",
    chargesTotal: Number(record.chargesTotal) || 0,
    retained: Number(record.retained) || 0,
    returned: Number(record.returned) || 0,
    extra: Number(record.extra) || 0,
    depositStatus: typeof record.depositStatus === "string" ? record.depositStatus : null,
  };
}

export async function getSettlementView(organizationId: string, budgetId: string): Promise<SettlementView> {
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { id: true, eventId: true, securityDeposit: true, securityDepositStatus: true, securityDepositPurpose: true, rentalSettlement: true },
  });
  if (!budget) throw new RentalSettlementError(404, "Presupuesto no encontrado.");
  const [settings, rows, assignments] = await Promise.all([
    getRentalSettings(organizationId),
    db.rentalCharge.findMany({ where: { organizationId, budgetId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    budget.eventId
      ? db.eventInventory.findMany({
          where: { eventId: budget.eventId, event: { organizationId }, releasedAt: null },
          select: { quantity: true, checkedIn: true, returnedQuantity: true, inventory: { select: { categoryRef: { select: { id: true, parentId: true } } } } },
        })
      : Promise.resolve([]),
  ]);
  const charges = rows.map(toRow);
  const appliedTotal = charges.filter((charge) => charge.status === "APPLIED").reduce((sum, charge) => sum + charge.amount, 0);
  const purpose: DepositPurpose = isDepositPurpose(budget.securityDepositPurpose) ? budget.securityDepositPurpose : "DAMAGES";
  const deposit = securityDepositAmountValid(budget.securityDeposit) ? { amount: budget.securityDeposit, status: budget.securityDepositStatus } : null;
  const settled = readSettled(budget.rentalSettlement);
  const returned = assignments.map((row) => ({
    categoryIds: [row.inventory.categoryRef?.id, row.inventory.categoryRef?.parentId].filter((id): id is string => Boolean(id)),
    quantity: Math.max(row.returnedQuantity, row.checkedIn ? row.quantity : 0),
  }));
  const offers = offeredCustomCharges(settings.customCharges, returned).map(({ type, suggestedQuantity }) => ({ typeId: type.id, name: type.name, amount: type.amount, unit: type.unit, suggestedQuantity }));
  return {
    budgetId,
    charges,
    offers,
    purpose,
    deposit,
    equipmentReturn: assignments.length === 0 ? "none" : assignments.every((row) => row.checkedIn) ? "returned" : "pending",
    appliedTotal,
    proposedCount: charges.filter((charge) => charge.status === "PROPOSED").length,
    preview: settleRental({ deposit: deposit?.amount ?? 0, depositHeld: deposit?.status === "HELD", purpose, chargesTotal: appliedTotal }),
    settled,
  };
}

// ── Decisiones sobre los cargos ─────────────────────────────────────────────

export type ChargeAction =
  | { action: "apply" }
  | { action: "waive"; reason: string }
  | { action: "reopen" }
  | { action: "update"; quantity?: number; unitAmount?: number; label?: string; note?: string | null };

const intOk = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;

export async function decideRentalCharge(context: AuditContext, budgetId: string, chargeId: string, input: ChargeAction): Promise<RentalChargeRow> {
  const result = await db.$transaction(async (tx) => {
    const budget = await lockBudget(tx, budgetId, context.organizationId);
    if (budget.rentalSettledAt) throw new RentalSettlementError(409, "La devolución ya está liquidada: los cargos no se pueden cambiar.");
    const current = await tx.rentalCharge.findFirst({ where: { id: chargeId, budgetId, organizationId: context.organizationId } });
    if (!current) throw new RentalSettlementError(404, "El cargo no existe en esta empresa.");
    const data: Prisma.RentalChargeUpdateInput = {};
    const now = new Date();
    if (input.action === "apply") {
      if (current.status === "APPLIED") return { before: current, after: current, changed: false };
      data.status = "APPLIED";
      data.reason = null;
    } else if (input.action === "waive") {
      const reason = (input.reason ?? "").trim();
      if (reason.length < 3) throw new RentalSettlementError(400, "Para condonar un cargo escribí el motivo.");
      if (reason.length > 300) throw new RentalSettlementError(400, "El motivo no puede superar los 300 caracteres.");
      if (current.status === "WAIVED") return { before: current, after: current, changed: false };
      data.status = "WAIVED";
      data.reason = reason;
    } else if (input.action === "reopen") {
      if (current.status === "PROPOSED") return { before: current, after: current, changed: false };
      data.status = "PROPOSED";
      data.reason = null;
    } else {
      if (current.status !== "PROPOSED") throw new RentalSettlementError(409, "Solo se edita un cargo propuesto: reabrilo primero.");
      const quantity = input.quantity ?? current.quantity;
      const unitAmount = input.unitAmount ?? current.unitAmount;
      if (!intOk(quantity, 1) || !intOk(unitAmount, 0)) throw new RentalSettlementError(400, "La cantidad y el monto deben ser enteros (cantidad desde 1).");
      const amount = quantity * unitAmount;
      if (!budgetMoneyValid(amount)) throw new RentalSettlementError(400, "El monto del cargo supera el límite.");
      data.quantity = quantity;
      data.unitAmount = unitAmount;
      data.amount = amount;
      if (input.label !== undefined) {
        const label = input.label.replace(/\s+/g, " ").trim();
        if (!label || label.length > 160) throw new RentalSettlementError(400, "El nombre del cargo debe tener entre 1 y 160 caracteres.");
        data.label = label;
      }
      if (input.note !== undefined) data.note = input.note?.trim().slice(0, 300) || null;
    }
    if (input.action !== "update") {
      data.decidedAt = input.action === "reopen" ? null : now;
      data.decidedByName = input.action === "reopen" ? null : context.user.name;
    }
    const after = await tx.rentalCharge.update({ where: { id: current.id }, data });
    await recordAudit(
      {
        context,
        action: "update",
        entity: "Budget",
        entityId: budgetId,
        summary: `${input.action === "apply" ? "Aplicó" : input.action === "waive" ? "Condonó" : input.action === "reopen" ? "Reabrió" : "Editó"} el cargo «${after.label}» del presupuesto «${budget.title}»`,
        detail: { fields: { cargo: after.id, monto: after.amount, estado: after.status, ...(after.reason ? { motivo: after.reason } : {}) } },
      },
      tx,
    );
    return { before: current, after, changed: true };
  });
  return toRow(result.after);
}

/** Cargo manual o elegido de la lista de la empresa: nace aplicado (lo agrega quien factura). */
export async function addRentalCharge(
  context: AuditContext,
  budgetId: string,
  input: { typeId?: string | null; label?: string; kind?: RentalChargeKind; quantity?: number; unitAmount?: number },
): Promise<RentalChargeRow> {
  const settings = await getRentalSettings(context.organizationId);
  const type: CustomChargeType | undefined = input.typeId ? settings.customCharges.find((candidate) => candidate.id === input.typeId) : undefined;
  if (input.typeId && !type) throw new RentalSettlementError(404, "Ese cargo no está en la lista de la empresa.");
  let label: string;
  let quantity: number;
  let unitAmount: number;
  if (type) {
    const computed = customChargeAmount(type, input.quantity ?? 1);
    label = type.name;
    quantity = computed.quantity;
    unitAmount = input.unitAmount ?? computed.unitAmount;
  } else {
    label = (input.label ?? "").replace(/\s+/g, " ").trim();
    quantity = input.quantity ?? 1;
    unitAmount = input.unitAmount ?? -1;
  }
  if (!label || label.length > 160) throw new RentalSettlementError(400, "El nombre del cargo debe tener entre 1 y 160 caracteres.");
  if (!intOk(quantity, 1) || !intOk(unitAmount, 0)) throw new RentalSettlementError(400, "La cantidad y el monto deben ser enteros (cantidad desde 1).");
  const amount = quantity * unitAmount;
  if (!budgetMoneyValid(amount)) throw new RentalSettlementError(400, "El monto del cargo supera el límite.");
  const kind: RentalChargeKind = type ? "CUSTOM" : input.kind === "CLEANING" || input.kind === "STAIN" || input.kind === "OTHER" ? input.kind : "CUSTOM";
  const row = await db.$transaction(async (tx) => {
    const budget = await lockBudget(tx, budgetId, context.organizationId);
    if (budget.rentalSettledAt) throw new RentalSettlementError(409, "La devolución ya está liquidada: no se pueden agregar cargos.");
    const created = await tx.rentalCharge.create({
      data: { id: randomUUID(), organizationId: context.organizationId, budgetId, eventId: budget.eventId, kind, status: "APPLIED", label, quantity, unitAmount, amount, dedupeKey: `custom:${randomUUID()}`, decidedAt: new Date(), decidedByName: context.user.name },
    });
    await recordAudit(
      { context, action: "create", entity: "Budget", entityId: budgetId, summary: `Agregó el cargo «${label}» al presupuesto «${budget.title}»`, detail: { fields: { cargo: created.id, monto: amount, cantidad: quantity } } },
      tx,
    );
    return created;
  });
  return toRow(row);
}

// ── Liquidación ─────────────────────────────────────────────────────────────

export type SettleResult = SettledSnapshot & { alreadySettled: boolean; paymentId: string | null; expectedPaymentId: string | null };

/**
 * «Liquidar»: cierra los cargos contra la garantía en una transacción con `FOR UPDATE` del
 * presupuesto. Idempotente (la segunda llamada devuelve lo ya liquidado sin escribir).
 *
 * - Garantía de daños: se retiene lo que corresponde (entra como cobro confirmado «Garantía
 *   retenida» + movimiento de tesorería), el resto se devuelve; si los cargos superan la garantía,
 *   la diferencia queda como pago esperado `extra`.
 * - Garantía de reserva (o sin garantía): todos los cargos van como `extra`; la reserva ya se descontó
 *   del saldo cuando se recibió.
 * Nunca toca `Budget.total`.
 */
export async function settleBudgetRental(context: AuditContext, budgetId: string, options: { accountId?: string | null } = {}): Promise<SettleResult> {
  return db.$transaction(
    async (tx) => {
      const budget = await lockBudget(tx, budgetId, context.organizationId);
      const previous = readSettled(budget.rentalSettlement);
      if (budget.rentalSettledAt && previous) return { ...previous, alreadySettled: true, paymentId: null, expectedPaymentId: null };

      if (budget.eventId) {
        const pendingReturn = await tx.eventInventory.count({ where: { eventId: budget.eventId, event: { organizationId: context.organizationId }, releasedAt: null, checkedIn: false } });
        if (pendingReturn > 0) throw new RentalSettlementError(409, "Todavía faltan equipos por devolver: liquidá cuando vuelva todo.");
      }
      const charges = await tx.rentalCharge.findMany({ where: { organizationId: context.organizationId, budgetId } });
      const open = charges.filter((charge) => charge.status === "PROPOSED").length;
      if (open > 0) throw new RentalSettlementError(409, `Hay ${open} cargo${open === 1 ? "" : "s"} sin decidir: aplicalos o condonalos antes de liquidar.`);
      const chargesTotal = charges.filter((charge) => charge.status === "APPLIED").reduce((sum, charge) => sum + charge.amount, 0);
      const purpose: DepositPurpose = isDepositPurpose(budget.securityDepositPurpose) ? budget.securityDepositPurpose : "DAMAGES";
      const deposit = securityDepositAmountValid(budget.securityDeposit) ? budget.securityDeposit : 0;
      const depositStatus = budget.securityDepositStatus;
      if (deposit > 0 && depositStatus === "PENDING") throw new RentalSettlementError(409, "La garantía todavía no se recibió: marcala recibida o quitala antes de liquidar.");
      const result = settleRental({ deposit, depositHeld: depositStatus === "HELD", purpose, chargesTotal });
      const now = new Date();
      let paymentId: string | null = null;
      let expectedPaymentId: string | null = null;

      if (result.retained > 0) {
        const income = await recordIncome(tx, context, {
          budget,
          amount: result.retained,
          method: GARANTIA_RETENIDA,
          origin: DEPOSIT_RETAINED_ORIGIN,
          notes: `Garantía retenida por cargos de la devolución del presupuesto «${budget.title}»`,
          accountId: options.accountId,
          at: now,
        });
        paymentId = income.paymentId;
      }
      if (result.extra > 0) {
        // Solo hay extra por cobrar (sin retención): no se exige una cuenta de tesorería. La cuenta
        // se resuelve cuando se cobra; acá solo se la fija si se eligió una o ya hubo un ingreso.
        const account = options.accountId || result.retained > 0 ? await accountFor(tx, context.organizationId, options.accountId) : null;
        const expected = await tx.expectedPayment.create({
          data: {
            id: randomUUID(),
            organizationId: context.organizationId,
            budgetId,
            concept: "extra",
            slot: EXTRA_SLOT,
            label: "Cargos de la devolución",
            amount: result.extra,
            status: "AWAITING",
            expectedAccountId: account?.id ?? null,
          },
          select: { id: true },
        });
        expectedPaymentId = expected.id;
      }
      const snapshot: SettledSnapshot = {
        at: now.toISOString(),
        byName: context.user.name,
        purpose,
        chargesTotal,
        retained: result.retained,
        returned: result.returned,
        extra: result.extra,
        depositStatus: result.depositStatus ?? depositStatus,
      };
      await tx.budget.update({
        where: { id: budgetId },
        data: {
          rentalSettledAt: now,
          rentalSettlement: snapshot as unknown as Prisma.InputJsonValue,
          ...(result.depositStatus ? { securityDepositStatus: result.depositStatus, securityDepositRetained: result.depositStatus === "KEPT" ? deposit : result.depositStatus === "KEPT_PARTIAL" ? result.retained : 0 } : {}),
        },
      });
      await recordAudit(
        {
          context,
          action: "status",
          entity: "Budget",
          entityId: budgetId,
          summary: `Liquidó la devolución del presupuesto «${budget.title}»`,
          detail: { fields: { cargos: chargesTotal, retenido: result.retained, devuelto: result.returned, extra: result.extra, proposito: purpose } },
        },
        tx,
      );
      return { ...snapshot, alreadySettled: false, paymentId, expectedPaymentId };
    },
    { timeout: 15_000 },
  );
}

// ── Portal del cliente ──────────────────────────────────────────────────────

export type PortalRental = {
  /** Cargos decididos (los propuestos no se muestran). El motivo interno de una condonación no viaja. */
  charges: Array<{ label: string; quantity: number; unitAmount: number; amount: number; waived: boolean }>;
  settlement: { retained: number; returned: number; extra: number; chargesTotal: number } | null;
  terms: string | null;
  cancellationLines: string[];
};

/** Lo que el cliente ve del alquiler: cargos, liquidación, condiciones y política de cancelación. */
export async function loadPortalRental(organizationId: string, budgetId: string): Promise<PortalRental | null> {
  const [budget, settings, charges, rentalLines] = await Promise.all([
    db.budget.findFirst({ where: { id: budgetId, organizationId }, select: { rentalSettlement: true } }),
    getRentalSettings(organizationId),
    db.rentalCharge.findMany({ where: { organizationId, budgetId, status: { in: ["APPLIED", "WAIVED"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.budgetItem.count({ where: { budgetId, inventoryId: { not: null }, budget: { organizationId } } }),
  ]);
  if (!budget) return null;
  const settled = readSettled(budget.rentalSettlement);
  if (rentalLines === 0 && charges.length === 0 && !settled) return null;
  return {
    charges: charges.map((charge) => ({ label: charge.label, quantity: charge.quantity, unitAmount: charge.unitAmount, amount: charge.amount, waived: charge.status === "WAIVED" })),
    settlement: settled ? { retained: settled.retained, returned: settled.returned, extra: settled.extra, chargesTotal: settled.chargesTotal } : null,
    terms: settings.rentalTerms,
    cancellationLines: cancellationPolicyLines(settings.cancellationPolicy),
  };
}

// ── Cancelación: retención propuesta ────────────────────────────────────────

/**
 * Retención sugerida de la seña si se cancela hoy: según la política de la empresa y los días que
 * faltan para el evento. Solo propone; no devuelve ni retiene plata.
 */
export async function proposeCancellationRetention(organizationId: string, budgetId: string, now = new Date()) {
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { id: true, event: { select: { startsAt: true } }, deliveryAt: true, payments: { where: { status: "RECEIVED" }, select: { amount: true, origin: true } } },
  });
  if (!budget) throw new RentalSettlementError(404, "Presupuesto no encontrado.");
  const settings = await getRentalSettings(organizationId);
  const startsAt = budget.event?.startsAt ?? budget.deliveryAt;
  if (!startsAt) return { daysBefore: null, percent: null, retained: 0, refundable: 0, advancePaid: 0 };
  const daysBefore = Math.floor((startsAt.getTime() - now.getTime()) / 86_400_000);
  const advancePaid = budget.payments.filter((payment) => countsTowardBudgetBalance(payment)).reduce((sum, payment) => sum + payment.amount, 0);
  const proposal = cancellationRetention(settings.cancellationPolicy, { daysBefore, advancePaid });
  return { daysBefore, advancePaid, ...proposal };
}

// ── Garantía sugerida ───────────────────────────────────────────────────────

/**
 * Garantía que corresponde a un pedido según la política de la empresa (fijo, % del pedido o
 * por producto o categoría). `null` si la política es «no uso» o no hay base para calcular.
 * Con `auto: true` solo propone cuando la política es «siempre» (así nace un presupuesto nuevo).
 */
export async function suggestDepositForOrder(
  organizationId: string,
  order: { total: number; lines: Array<{ inventoryId: string | null; quantity: number }> },
  options: { auto?: boolean } = {},
): Promise<number | null> {
  const settings = await getRentalSettings(organizationId);
  if (settings.securityDepositMode === "NONE") return null;
  if (options.auto && settings.securityDepositMode !== "ALWAYS") return null;
  const ids = [...new Set(order.lines.flatMap((line) => (line.inventoryId ? [line.inventoryId] : [])))];
  const items = settings.securityDepositCalc === "PER_PRODUCT" && ids.length > 0
    ? await db.inventoryItem.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, categoryRef: { select: { id: true, parentId: true } } } })
    : [];
  const categories = new Map(items.map((item) => [item.id, [item.categoryRef?.id, item.categoryRef?.parentId].filter((id): id is string => Boolean(id))]));
  return suggestSecurityDeposit(
    { mode: settings.securityDepositMode, calc: settings.securityDepositCalc, fixedAmount: settings.securityDepositDefault, percent: settings.securityDepositPercent, rules: settings.securityDepositRules },
    { total: order.total, lines: order.lines.map((line) => ({ inventoryId: line.inventoryId, categoryIds: line.inventoryId ? categories.get(line.inventoryId) ?? [] : [], quantity: line.quantity })) },
  );
}
