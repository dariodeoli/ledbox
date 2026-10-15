import { db } from "./db";
import { missingPriceMessage, missingPriceNames } from "../budget-price-gate";

type Client = Pick<typeof db, "budgetItem">;

/**
 * Líneas del presupuesto (de la empresa activa) con precio unitario 0 sin confirmar. Devuelve el
 * mensaje listo para mostrar o `null` si no hay nada que frenar. Un id ajeno no encuentra líneas.
 */
export async function budgetPriceGate(organizationId: string, budgetId: string, action: "enviar" | "aprobar" | "cobrar", client: Client = db): Promise<string | null> {
  const rows = await client.budgetItem.findMany({
    where: { budgetId, budget: { organizationId }, excluded: false, unitPrice: 0, freeOnPurpose: false },
    select: { name: true, unitPrice: true, excluded: true, freeOnPurpose: true },
    orderBy: { sortOrder: "asc" },
  });
  const names = missingPriceNames(rows);
  return names.length ? missingPriceMessage(names, action) : null;
}
