/** A presentation-only next step from received money and the real payment ledger.
 * Does not allocate payments, mutate a plan or treat a proof as money received.
 */
export type BudgetCollectionConcept = {
  status: string;
  label: string;
  concept?: string;
  amount: number;
  paidAmount?: number;
  remaining?: number;
};

export function budgetCollectionStep<T extends BudgetCollectionConcept>(input: {
  total: number;
  collected: number;
  advanceAmount: number;
  expectedPayments?: readonly T[];
}) {
  const balance = Math.max(0, input.total - input.collected);
  if (balance === 0) return { kind: "complete" as const, label: input.total > 0 ? "Cobro completo" : "Sin saldo pendiente", amount: 0, concept: null };
  const open = (input.expectedPayments ?? []).filter((row) => ["AWAITING", "PARTIAL", "PROOF"].includes(row.status));
  const payable = open.find((row) => row.status === "PARTIAL") ?? open.find((row) => row.status === "AWAITING");
  if (payable) {
    const remaining = payable.remaining ?? Math.max(0, payable.amount - (payable.paidAmount ?? 0));
    if (remaining > 0) return { kind: "payment" as const, label: payable.concept === "advance" ? "Cobrar anticipo" : payable.concept === "balance" ? "Cobrar saldo" : `Cobrar ${payable.label}`, amount: Math.min(balance, remaining), concept: payable };
  }
  if (open.some((row) => row.status === "PROOF")) return { kind: "review" as const, label: "Revisar comprobante", amount: 0, concept: null };
  // Without a ledger, only the unpaid advance is inferred from received money.
  // A persisted ledger (even fully closed) never falls back to an old advance.
  const advance = (input.expectedPayments?.length ?? 0) === 0 ? Math.min(balance, Math.max(0, input.advanceAmount - input.collected)) : 0;
  return { kind: "payment" as const, label: advance > 0 ? "Cobrar anticipo" : input.collected > 0 ? "Cobrar saldo" : "Cobrar pago", amount: advance > 0 ? advance : balance, concept: null };
}
