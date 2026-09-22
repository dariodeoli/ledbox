import { db } from "./db";
import { clientLabel } from "./notifications";

/**
 * Etiquetas vivas del hecho real que originó movimientos de tesorería (cobro,
 * trabajo de proveedor o gasto). Fuente única de `/api/admin/treasury` y de la
 * conciliación bancaria: los movimientos con `sourceSnapshot` (issue #20) se
 * dibujan con la etiqueta congelada y esta lectura queda como respaldo de los
 * movimientos anteriores a la migración.
 */

/** Tope de la etiqueta devuelta (mismo que la lista de tesorería). */
export const MAX_SOURCE_LABEL = 200;

export async function resolveSourceLabels(
  organizationId: string,
  movements: ReadonlyArray<{ origin: string; sourceId: string | null }>,
): Promise<Map<string, string>> {
  const ids = (origin: string) => [
    ...new Set(
      movements
        .filter((movement) => movement.origin === origin && movement.sourceId)
        .map((movement) => movement.sourceId as string),
    ),
  ];
  const [paymentIds, jobIds, expenseIds] = [ids("client_payment"), ids("supplier_job"), ids("expense")];
  const [payments, jobs, expenses] = await Promise.all([
    paymentIds.length
      ? db.clientPayment.findMany({
          where: { id: { in: paymentIds }, organizationId },
          select: { id: true, client: { select: { name: true, company: true } } },
        })
      : [],
    jobIds.length
      ? db.supplierJob.findMany({
          where: { id: { in: jobIds }, organizationId },
          select: { id: true, description: true, supplier: { select: { name: true } } },
        })
      : [],
    expenseIds.length
      ? db.expense.findMany({ where: { id: { in: expenseIds }, organizationId }, select: { id: true, description: true } })
      : [],
  ]);
  const labels = new Map<string, string>();
  for (const payment of payments) labels.set(`client_payment:${payment.id}`, clientLabel(payment.client));
  for (const job of jobs) labels.set(`supplier_job:${job.id}`, `${job.supplier.name} · ${job.description}`);
  for (const expense of expenses) labels.set(`expense:${expense.id}`, expense.description);
  return labels;
}
