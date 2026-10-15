import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { auditRenames } from "@/lib/server/inventory-families-audit";
import { addExistingVariants, addNewVariant, getFamilyView } from "@/lib/server/inventory-families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Suma variantes a una familia (`inventory.write`, familia de la empresa activa o 404):
 * - `{ mode: "new", options, sku, quantity?, templateItemId? }`: crea un producto nuevo que copia cobro,
 *   precios, categoría y medidas de la variante de referencia; con 0 o N unidades. Nace oculto en la tienda.
 * - `{ mode: "existing", members: [{ itemId, options }] }`: suma productos sueltos que ya existen.
 * Una combinación repetida responde 409 (índice único parcial: dos altas simultáneas, una gana).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.mode === "new") {
    const result = await db.$transaction(
      async (tx) => {
        const created = await addNewVariant(tx, organizationId, id, { options: body.options, sku: body.sku, quantity: body.quantity, templateItemId: body.templateItemId });
        if (!created.ok) return created;
        return { ...created, family: await getFamilyView(tx, organizationId, id) };
      },
      { timeout: 30_000 },
    );
    if (!result.ok) return jsonError(result.error, result.status);
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "InventoryItem",
      entityId: result.itemId,
      summary: `Agregó la variante «${result.name}» a la familia`,
      detail: { fields: { familia: result.family?.name, sku: String(body.sku ?? ""), unidades: Number(body.quantity) || 0 } },
    });
    return Response.json({ itemId: result.itemId, family: result.family }, { status: 201 });
  }
  if (body.mode === "existing") {
    const result = await db.$transaction(
      async (tx) => {
        const added = await addExistingVariants(tx, organizationId, id, body.members);
        if (!added.ok) return added;
        return { ...added, family: await getFamilyView(tx, organizationId, id) };
      },
      { timeout: 20_000 },
    );
    if (!result.ok) return jsonError(result.error, result.status);
    await auditRenames(auth.context, result.renamed, "Sumó a la familia");
    return Response.json({ family: result.family, renamed: result.renamed }, { status: 201 });
  }
  return jsonError("Elegí si es una variante nueva o productos que ya tenés.", 400);
}
