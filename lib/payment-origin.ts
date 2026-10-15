/**
 * Origen de un cobro (`ClientPayment.origin`), alquileres P1-4.
 *
 * - `null`: cobro común del presupuesto (seña, cuota, saldo, cobro libre). Baja el saldo.
 * - `deposit_reserve`: garantía de reserva. ES parte del pago del alquiler: baja el saldo y se
 *   imputa al plan (seña y saldo) con la misma lógica que cualquier cobro.
 * - `deposit_retained`: garantía de daños retenida. Es un ingreso de la empresa por cargos, NO un
 *   pago del alquiler: entra a tesorería pero no baja el saldo ni el «por cobrar».
 * - `rental_extra`: cobro de un cargo extra de la liquidación. Mismo trato que el anterior: los
 *   cargos van encima del total, no lo cancelan.
 *
 * Regla única: todo lo que suma «cobrado de un presupuesto» (saldo, por cobrar, ficha del cliente,
 * portal, plan de pagos) pasa por acá. Los ingresos de tesorería y de finanzas siguen sumando todo.
 */
export const DEPOSIT_RETAINED_ORIGIN = "deposit_retained";
export const DEPOSIT_RESERVE_ORIGIN = "deposit_reserve";
export const RENTAL_EXTRA_ORIGIN = "rental_extra";

/** Orígenes que NO bajan el saldo del alquiler. */
export const NON_RENTAL_PAYMENT_ORIGINS: readonly string[] = [DEPOSIT_RETAINED_ORIGIN, RENTAL_EXTRA_ORIGIN];

/** ¿Este cobro baja el saldo del presupuesto? (no mira el estado: eso lo decide quien llama) */
export function countsTowardBudgetBalance(payment: { origin?: string | null }): boolean {
  return !payment.origin || !NON_RENTAL_PAYMENT_ORIGINS.includes(payment.origin);
}

/**
 * Filtro de Prisma: los cobros que bajan el saldo. Ojo: `notIn` solo deja afuera los NULL en SQL,
 * por eso el `null` va explícito. Se usa dentro de `where` (no pisa un `OR` ajeno: va en `AND`).
 */
export const rentalBalancePaymentFilter = {
  AND: [{ OR: [{ origin: null }, { origin: { notIn: [...NON_RENTAL_PAYMENT_ORIGINS] } }] }],
};
