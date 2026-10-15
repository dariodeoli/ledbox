export type QuoteSelectionItem = {
  id: string; name: string; quantity: number; days: number; unitPrice: number; excluded?: boolean;
  /** `EVENT`: se cobra una sola vez por evento, los días no existen (siempre 1). */
  billingUnit?: string | null;
  inventory?: { billingUnit?: string | null } | null;
};
/** Ítem cuyo inventario se cobra por evento: su `days` es siempre 1 (alquileres P1-1). */
export const isEventBilledItem = (item: Pick<QuoteSelectionItem, "billingUnit" | "inventory">): boolean => (item.billingUnit ?? item.inventory?.billingUnit) === "EVENT";
export type SelectedQuoteItem = { id: string; quantity: number; days: number; excluded: boolean };

export function selectionSubtotal(item: Pick<QuoteSelectionItem, "quantity" | "days" | "unitPrice" | "excluded">): number {
  return item.excluded ? 0 : item.quantity * item.days * item.unitPrice;
}

export function selectionApprovalError(items: ReadonlyArray<{ excluded?: boolean; id?: string }>, pending = false, committed = 0, total = Infinity): string | null {
  if (!items.some((item) => !item.excluded)) return "El presupuesto debe incluir al menos un producto o servicio.";
  if (pending) return "Hay una selección de ítems pendiente de revisión por el equipo.";
  if (committed > total) return "El plan de pagos supera el total de los ítems incluidos. El equipo debe ajustarlo antes de aprobar.";
  return null;
}

/** Proposals are partial patches of existing lines, never client-supplied prices. */
export function resolveQuoteSelection(items: QuoteSelectionItem[], raw: unknown, options?: { requireChange?: boolean }):
  { ok: true; value: SelectedQuoteItem[]; changed: boolean } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!Array.isArray(raw) || !raw.length || raw.length > items.length) return fail("La propuesta de ítems no es válida.");
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const value: SelectedQuoteItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail("La propuesta tiene un ítem inválido.");
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !byId.has(row.id) || seen.has(row.id)) return fail("La propuesta tiene un ítem ajeno o repetido.");
    if (["unitPrice", "costPrice", "subtotal"].some((key) => row[key] !== undefined)) return fail("Los precios del presupuesto no se pueden modificar desde el portal.");
    if (Object.entries(row).some(([key, value]) => value !== undefined && !["id", "quantity", "days", "excluded"].includes(key))) return fail("La propuesta contiene campos que no se pueden cambiar desde el portal.");
    if (row.excluded !== undefined && typeof row.excluded !== "boolean") return fail("La selección del ítem no es válida.");
    if (typeof row.quantity !== "number" || typeof row.days !== "number") return fail("La cantidad y los días deben ser números enteros.");
    const original = byId.get(row.id)!;
    // Producto por evento: el cliente no puede multiplicarlo por días; se fuerza a 1.
    const quantity = row.quantity, days = isEventBilledItem(original) ? 1 : row.days;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999 || !Number.isInteger(days) || days < 1 || days > 365) return fail("La cantidad debe ser de 1 a 999 y los días de 1 a 365. Usá Retirar para excluir un ítem.");
    if (row.excluded === true && (quantity !== original.quantity || days !== original.days)) return fail("Al retirar un ítem se conservan su cantidad y días originales.");
    seen.add(row.id);
    value.push({ id: row.id, quantity, days, excluded: row.excluded === undefined ? Boolean(byId.get(row.id)!.excluded) : row.excluded });
  }
  const patches = new Map(value.map((row) => [row.id, row]));
  const error = selectionApprovalError(items.map((item) => patches.get(item.id) ?? item));
  if (error) return fail(error);
  const changed = value.some((row) => { const old = byId.get(row.id)!; return row.quantity !== old.quantity || row.days !== old.days || row.excluded !== Boolean(old.excluded); });
  if ((options?.requireChange ?? true) && !changed) return fail("La propuesta es igual al presupuesto actual.");
  return { ok: true, value, changed };
}

/** Map an admin counteroffer checkbox without changing server validation. */
export function counterofferExclusion(original: Pick<QuoteSelectionItem, "quantity" | "days">, proposed: { quantity: number; days: number; excluded?: boolean }, excluded: boolean): { quantity: number; days: number; excluded: boolean } {
  return { ...proposed, ...(excluded ? { quantity: original.quantity, days: original.days } : {}), excluded };
}
