import { FIELD_LIMITS } from "@/lib/field-rules";
import { budgetPriceGate } from "@/lib/server/budget-price-gate";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import {
  COLLECTED_PAYMENT_METHODS,
  PAYMENT_METHODS,
  PENDING_PAYMENT_METHOD,
  TERM_PAYMENT_METHODS,
} from "@/lib/admin-types";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { withIdempotency } from "@/lib/server/idempotency";
import {
  clientNameForSnapshot,
  collectionSnapshotOf,
  movementSourceSnapshot,
} from "@/lib/server/finance-snapshots";
import { clientLabel, dayKeyOf, dayStart, isValidDayKey, shiftDayKey } from "@/lib/server/notifications";
import { readFinanceListing } from "@/lib/server/finance-listing";
import { runDailyPaymentReminders } from "@/lib/server/reminders";
import { runDailySignatureReminders } from "@/lib/server/signature/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cobros de clientes y cuentas por pagar de la empresa activa (issue #16).
 *
 * `POST` con `kind: "client"` registra un cobro: cobrado al momento (default,
 * `status RECEIVED`, con `paidAt`/`collectedAt` reales) o a plazo
 * (`status PENDING`, con factura emitida, vencimiento calculado desde la emisión
 * + días o fecha exacta, y fecha de cheque obligatoria cuando el método es
 * cheque). Un cobro pendiente no es plata cobrada: `paidAt` queda nulo.
 *
 * `PATCH` con `kind: "client"` cierra un cobro a plazo: `action: "collect"` lo
 * pasa a `RECEIVED` sellando la fecha real, `action: "cancel"` lo anula. Las
 * transiciones son monotónicas: un reintento que pide el estado que el cobro ya
 * tiene devuelve el estado actual sin cambios y un retroceso real (cobrar un
 * anulado, anular un cobrado) responde 409 sin tocar nada. Cada cambio real
 * queda auditado una sola vez.
 *
 * Tesorería (issue #27): el cobro se registra en una cuenta (`treasuryAccountId`,
 * por defecto la primera activa) y al cobrarse genera el movimiento de entrada.
 * Sin cuentas cargadas el cobro sigue funcionando y no genera movimiento.
 *
 * Idempotencia y snapshots (issue #20): ambas mutaciones pasan por
 * `withIdempotency` con `scope: "finance:*:client"` —repetir la misma clave
 * devuelve la misma respuesta y no duplica el cobro ni el movimiento— y el cobro
 * confirmado guarda su `collectedSnapshot` (fecha, monto, método, cliente,
 * presupuesto y cuenta del momento) para que la historia no siga al dato vivo.
 *
 * El `GET` es el primer uso del día del módulo y dispara el despacho diario de
 * recordatorios al cliente (issue #19) después de responder: idempotente por
 * cobro, canal y día (`PaymentReminderLog`), así que no hace falta cron externo.
 */

/** Plazos ofrecidos en días desde la emisión de la factura. */
const TERM_DAYS: readonly number[] = [0, 15, 30, 60];
const MAX_AMOUNT = FIELD_LIMITS.amountStorage;
const MAX_INVOICE = 60;
const MAX_REFERENCE = 120;

/** Método canónico de la lista; `null` si no vino, `false` si es desconocido. */
function normalizeMethod(raw: unknown, allowed: readonly string[]): string | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return allowed.find((method) => method.toLowerCase() === value) ?? false;
}

/** Día de Asunción (`YYYY-MM-DD`) validado desde el body. */
function readDayKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().slice(0, 10);
  return isValidDayKey(key) ? key : null;
}

// ── Tesorería del cobro (issue #27) ─────────────────────────────────────────
// El cobro se registra en una cuenta (por defecto la primera activa) y al
// cobrarse genera su movimiento de entrada. Sin cuentas cargadas el cobro sigue
// funcionando igual y no se inventa ningún movimiento.

const treasuryAccountSelect = { id: true, name: true, type: true } as const;

/** Cuenta pedida en el body: `undefined` si no vino, `null` si no existe en la empresa. */
async function requestedTreasuryAccount(tx: Prisma.TransactionClient, organizationId: string, raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  return tx.treasuryAccount.findFirst({ where: { id: raw, organizationId }, select: treasuryAccountSelect });
}

/** Primera cuenta activa de la empresa: la cuenta por defecto del cobro. */
async function firstActiveTreasuryAccount(tx: Prisma.TransactionClient, organizationId: string) {
  return tx.treasuryAccount.findFirst({
    where: { organizationId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: treasuryAccountSelect,
  });
}

/** Cobro con su cuenta de tesorería, como lo devuelve el PATCH al cobrar. */
function readPayment(tx: Prisma.TransactionClient, id: string) {
  return tx.clientPayment.findUnique({
    where: { id },
    include: { treasuryAccount: { select: treasuryAccountSelect } },
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  if (!auth.context.demo) {
    // Despacho diario de recordatorios (issue #19) al primer uso del panel: sale
    // después de la respuesta para no demorar la lista y es idempotente, así que
    // repetirlo (o forzarlo desde el endpoint) no duplica nada.
    after(async () => {
      try {
        await runDailyPaymentReminders({ organizationId });
      } catch (error) {
        console.error("[reminders] Falló el despacho diario:", error instanceof Error ? error.message : error);
      }
      // Recordatorios de vencimiento de firma (issue #81): misma corrida diaria.
      try {
        await runDailySignatureReminders({ organizationId });
      } catch (error) {
        console.error("[signature-reminders] Falló el despacho diario:", error instanceof Error ? error.message : error);
      }
    });
  }
  return Response.json(await readFinanceListing(organizationId, new URL(request.url).searchParams));
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.kind !== "client") return jsonError("Entrada de finanzas desconocida.", 400);

  return withIdempotency({ request, organizationId, scope: "finance:POST:client", body }, async (tx) => {
    const clientId = typeof body.clientId === "string" ? body.clientId : "";
    const amount = Number(body.amount);
    if (!clientId || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return jsonError("Elegí un cliente y un monto entero en guaraníes (hasta 2.147.483.647).", 400);
    }
    const client = await tx.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true, name: true, company: true },
    });
    if (!client) return jsonError("El cliente no existe en esta empresa.", 404);
    const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
    let budget: { id: string; title: string; total: number; clientId: string } | null = null;
    if (budgetId) {
      budget = await tx.budget.findFirst({
        where: { id: budgetId, organizationId },
        select: { id: true, title: true, total: true, clientId: true },
      });
      if (!budget) return jsonError("Presupuesto no encontrado.", 404);
      if (budget.clientId !== client.id) return jsonError("El presupuesto corresponde a otro cliente. Elegí su cliente para registrar el cobro.", 409);
      const priceBlock = await budgetPriceGate(organizationId, budget.id, "cobrar", tx);
      if (priceBlock) return jsonError(priceBlock, 409, "price_missing");
    }

    // Cuenta de tesorería del cobro (issue #27): la pedida o la primera activa.
    // Un cobro a crédito (`Pendiente`, issue #135) no lleva cuenta: se elige al
    // cobrarlo.
    const requestedAccount = await requestedTreasuryAccount(tx, organizationId, body.treasuryAccountId);
    if (requestedAccount === null) return jsonError("La cuenta no existe en esta empresa.", 404);

    // ── Cobro a plazo: a cobrar, con factura y/o cheque ───────────────────────
    if (body.status === "PENDING") {
      const method = normalizeMethod(body.method, TERM_PAYMENT_METHODS);
      if (method === false) return jsonError("El método de un cobro a plazo es pendiente, transferencia, efectivo o cheque.", 400);
      if (!method) return jsonError("Indicá el método del cobro a plazo.", 400);
      if (method === PENDING_PAYMENT_METHOD && requestedAccount) {
        return jsonError("Un cobro pendiente no lleva cuenta: elegí dónde entra cuando lo cobres.", 400);
      }
      const treasuryAccount =
        method === PENDING_PAYMENT_METHOD
          ? null
          : requestedAccount ?? (await firstActiveTreasuryAccount(tx, organizationId));

      const chequeDayKey = readDayKey(body.chequeDate);
      if (method === "Cheque" && !chequeDayKey) return jsonError("La fecha del cheque es obligatoria.", 400);
      if (method !== "Cheque" && chequeDayKey) return jsonError("Solo un cobro con cheque lleva fecha de cheque.", 400);

      const invoiceDayKey = readDayKey(body.invoiceIssuedAt);
      const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
      if (invoiceNumber.length > MAX_INVOICE) return jsonError(`El número de factura no puede superar los ${MAX_INVOICE} caracteres.`, 400);
      if (invoiceDayKey && !invoiceNumber) return jsonError("Ingresá el número de la factura emitida.", 400);
      if (!invoiceDayKey && invoiceNumber) return jsonError("Indicá la fecha de emisión de la factura.", 400);

      let dueDayKey = readDayKey(body.dueAt);
      if (!dueDayKey) {
        const dueDays = Number(body.dueDays);
        if (!TERM_DAYS.includes(dueDays)) {
          return jsonError("Elegí el vencimiento de cobro: 0, 15, 30 o 60 días desde la emisión, o una fecha exacta.", 400);
        }
        dueDayKey = shiftDayKey(invoiceDayKey ?? dayKeyOf(new Date()), dueDays);
      }

      const payment = await tx.clientPayment.create({
        data: {
          id: randomUUID(),
          organizationId,
          clientId: client.id,
          budgetId: budgetId || undefined,
          amount,
          status: "PENDING",
          method,
          invoiceNumber: invoiceNumber || null,
          invoiceIssuedAt: invoiceDayKey ? dayStart(invoiceDayKey) : null,
          dueAt: dayStart(dueDayKey),
          chequeDate: chequeDayKey ? dayStart(chequeDayKey) : null,
          treasuryAccountId: treasuryAccount?.id ?? null,
        },
      });
      return {
        status: 201,
        body: { payment },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "create",
            entity: "ClientPayment",
            entityId: payment.id,
            summary: `Registró un cobro a plazo del cliente «${clientLabel(client)}»`,
            detail: {
              fields: {
                ...auditPick(payment, [
                  "clientId",
                  "budgetId",
                  "amount",
                  "status",
                  "method",
                  "invoiceNumber",
                  "invoiceIssuedAt",
                  "dueAt",
                  "chequeDate",
                ]),
                treasuryAccountId: treasuryAccount?.id ?? null,
              },
            },
          }),
      };
    }

    // ── Cobro cobrado al momento (compatibilidad con el alta directa) ─────────
    const method = normalizeMethod(body.method, PAYMENT_METHODS);
    if (method === false) return jsonError("Método de pago desconocido.", 400);
    if (method === PENDING_PAYMENT_METHOD) {
      return jsonError("Un cobro cobrado necesita su método real: para a crédito, registralo como cobro a plazo.", 400);
    }
    const treasuryAccount = requestedAccount ?? (await firstActiveTreasuryAccount(tx, organizationId));
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (reference.length > MAX_REFERENCE) return jsonError(`La referencia no puede superar los ${MAX_REFERENCE} caracteres.`, 400);

    // Seña de un cobro libre (issue #129): con el total acordado, el saldo queda
    // como cobro a plazo para completarlo después.
    let balanceAmount = 0;
    let balanceDueKey: string | null = null;
    if (body.totalAmount !== undefined && body.totalAmount !== null && body.totalAmount !== "") {
      const total = Number(body.totalAmount);
      if (!Number.isSafeInteger(total) || total <= amount || total > MAX_AMOUNT) {
        return jsonError("El total acordado tiene que ser mayor al monto de la seña (hasta 2.147.483.647).", 400);
      }
      balanceAmount = total - amount;
      if (body.balanceDueAt !== undefined && body.balanceDueAt !== null && body.balanceDueAt !== "") {
        balanceDueKey = readDayKey(body.balanceDueAt);
        if (!balanceDueKey) return jsonError("El vencimiento del saldo tiene que ser un día válido (AAAA-MM-DD).", 400);
      }
    }

    const now = new Date();
    // Cobro + entrada de tesorería en la misma transacción: la plata cobrada entra
    // a la cuenta elegida o no se registra el cobro. El snapshot del cobro y del
    // hecho que originó el movimiento quedan congelados acá (issue #20).
    const created = await tx.clientPayment.create({
      data: {
        id: randomUUID(),
        organizationId,
        clientId: client.id,
        budgetId: budgetId || undefined,
        amount,
        status: "RECEIVED",
        paidAt: now,
        collectedAt: now,
        method: method ?? undefined,
        reference: reference || undefined,
        treasuryAccountId: treasuryAccount?.id ?? null,
        collectedSnapshot: collectionSnapshotOf({
          at: now,
          amount,
          method,
          reference,
          client,
          budget,
          account: treasuryAccount,
        }),
      },
    });
    if (treasuryAccount) {
      await tx.treasuryMovement.create({
        data: {
          id: randomUUID(),
          organizationId,
          accountId: treasuryAccount.id,
          direction: "IN",
          amount,
          occurredAt: now,
          origin: "client_payment",
          sourceId: created.id,
          sourceSnapshot: movementSourceSnapshot({
            kind: "client_payment",
            label: clientNameForSnapshot(client),
            amount,
            ref: reference || null,
          }),
          createdById: auth.context.user.id,
          createdByName: auth.context.user.name,
          createdByEmail: auth.context.user.email,
        },
      });
    }
    // Saldo de la seña: cobro a plazo por el resto del total acordado (#129).
    let balance: { id: string; amount: number } | null = null;
    if (balanceAmount > 0) {
      const createdBalance = await tx.clientPayment.create({
        data: {
          id: randomUUID(),
          organizationId,
          clientId: client.id,
          budgetId: budgetId || undefined,
          amount: balanceAmount,
          status: "PENDING",
          method: method ?? undefined,
          dueAt: balanceDueKey ? dayStart(balanceDueKey) : null,
          notes: "Saldo pendiente de la seña",
          treasuryAccountId: treasuryAccount?.id ?? null,
        },
        select: { id: true, amount: true },
      });
      balance = createdBalance;
    }
    return {
      status: 201,
      body: { payment: created, ...(balance ? { balance } : {}) },
      afterCommit: () =>
        recordAudit({
          context: auth.context,
          action: "create",
          entity: "ClientPayment",
          entityId: created.id,
          summary: treasuryAccount
            ? `Registró un cobro del cliente «${clientLabel(client)}» en «${treasuryAccount.name}»${
                balance ? ` con saldo pendiente de ${balance.amount}` : ""
              }`
            : `Registró un cobro del cliente «${clientLabel(client)}»${balance ? ` con saldo pendiente de ${balance.amount}` : ""}`,
          detail: {
            fields: {
              ...auditPick(created, ["clientId", "budgetId", "amount", "method", "reference", "paidAt"]),
              treasuryAccountId: treasuryAccount?.id ?? null,
              ...(balance ? { balancePaymentId: balance.id, balanceAmount: balance.amount, balanceDueAt: balanceDueKey } : {}),
            },
          },
        }),
    };
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.kind !== "client") return jsonError("Entrada de finanzas desconocida.", 400);
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const action = body.action === "collect" ? "collect" : body.action === "cancel" ? "cancel" : "";
  if (!paymentId || !action) return jsonError("Falta el cobro o la acción.", 400);

  return withIdempotency({ request, organizationId, scope: "finance:PATCH:client", body }, async (tx) => {
    // Cuenta de tesorería del cobro (issue #27): la pedida al cobrar manda sobre
    // la del registro; sin ninguna, se usa la primera activa.
    const requestedAccount = await requestedTreasuryAccount(tx, organizationId, body.treasuryAccountId);
    if (requestedAccount === null) return jsonError("La cuenta no existe en esta empresa.", 404);

    const payment = await tx.clientPayment.findFirst({
      where: { id: paymentId, organizationId },
      include: {
        client: { select: { id: true, name: true, company: true } },
        budget: { select: { id: true, title: true, total: true } },
      },
    });
    if (!payment) return jsonError("Cobro no encontrado.", 404);
    const label = clientLabel(payment.client);

    if (action === "collect") {
      // Monotonicidad (issue #20): si el cobro ya está cobrado, un reintento
      // devuelve el estado actual sin escribir ni auditar de nuevo.
      if (payment.status === "RECEIVED") {
        return { status: 200, body: { payment: await readPayment(tx, payment.id), unchanged: true } };
      }
      if (payment.status !== "PENDING") return jsonError("El cobro está anulado: no se puede cobrar.", 409);

      // Una sola escritura condicional: si otro usuario lo cobró antes, no se pisa.
      // La entrada de tesorería nace en la misma transacción, una sola vez por
      // cobro (el cambio de estado es el candado).
      const now = new Date();
      // Método real al cobrar (issue #135): un cobro a crédito quedó «Pendiente»
      // sin método real; al cobrarlo se elige el método que entró.
      const requestedMethod = normalizeMethod(body.method, COLLECTED_PAYMENT_METHODS);
      if (requestedMethod === false) return jsonError("Método de pago desconocido.", 400);
      const storedMethod = payment.method && payment.method !== PENDING_PAYMENT_METHOD ? payment.method : null;
      const collectedMethod = requestedMethod ?? storedMethod;
      if (!collectedMethod) {
        return jsonError("Indicá el método real con el que se cobró (no «Pendiente»).", 400);
      }
      const storedAccount = payment.treasuryAccountId
        ? await tx.treasuryAccount.findFirst({
            where: { id: payment.treasuryAccountId, organizationId },
            select: treasuryAccountSelect,
          })
        : null;
      const account = requestedAccount ?? storedAccount ?? (await firstActiveTreasuryAccount(tx, organizationId));
      const applied = await tx.clientPayment.updateMany({
        where: { id: payment.id, organizationId, status: "PENDING" },
        data: {
          status: "RECEIVED",
          paidAt: now,
          collectedAt: now,
          method: collectedMethod,
          collectedSnapshot: collectionSnapshotOf({
            at: now,
            amount: payment.amount,
            method: collectedMethod,
            reference: payment.reference,
            invoiceNumber: payment.invoiceNumber,
            client: payment.client,
            budget: payment.budget,
            account,
          }),
          treasuryAccountId: account?.id ?? null,
        },
      });
      if (applied.count === 0) {
        // Otra petición cambió el cobro entre la lectura y la escritura.
        const current = await readPayment(tx, payment.id);
        if (current?.status === "CANCELLED") return jsonError("El cobro está anulado: no se puede cobrar.", 409);
        return { status: 200, body: { payment: current, unchanged: true } };
      }
      if (account) {
        await tx.treasuryMovement.create({
          data: {
            id: randomUUID(),
            organizationId,
            accountId: account.id,
            direction: "IN",
            amount: payment.amount,
            occurredAt: now,
            origin: "client_payment",
            sourceId: payment.id,
            sourceSnapshot: movementSourceSnapshot({
              kind: "client_payment",
              label: clientNameForSnapshot(payment.client),
              amount: payment.amount,
              ref: payment.invoiceNumber ?? payment.reference ?? null,
            }),
            createdById: auth.context.user.id,
            createdByName: auth.context.user.name,
            createdByEmail: auth.context.user.email,
          },
        });
      }
      return {
        status: 200,
        body: { payment: await readPayment(tx, payment.id) },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "status",
            entity: "ClientPayment",
            entityId: payment.id,
            summary: `Marcó como cobrado el cobro a plazo de «${label}»`,
            detail: {
              changes: {
                status: { from: "PENDING", to: "RECEIVED" },
                method: { from: payment.method, to: collectedMethod },
                collectedAt: { from: null, to: now },
              },
              ...(account ? { fields: { treasuryAccountId: account.id } } : {}),
            },
          }),
      };
    }

    // ── Anulación: solo desde pendiente y sin retroceder (issue #20) ──────────
    if (payment.status === "CANCELLED") {
      return { status: 200, body: { payment: await readPayment(tx, payment.id), unchanged: true } };
    }
    if (payment.status !== "PENDING") return jsonError("El cobro ya está cobrado: no se puede anular.", 409);

    const applied = await tx.clientPayment.updateMany({
      where: { id: payment.id, organizationId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (applied.count === 0) {
      const current = await readPayment(tx, payment.id);
      if (current?.status === "RECEIVED") return jsonError("El cobro ya está cobrado: no se puede anular.", 409);
      return { status: 200, body: { payment: current, unchanged: true } };
    }
    return {
      status: 200,
      body: { payment: await readPayment(tx, payment.id) },
      afterCommit: () =>
        recordAudit({
          context: auth.context,
          action: "status",
          entity: "ClientPayment",
          entityId: payment.id,
          summary: `Anuló el cobro a plazo de «${label}»`,
          detail: { changes: { status: { from: "PENDING", to: "CANCELLED" } } },
        }),
    };
  });
}
