import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { getFamilyView, unlinkVariant } from "@/lib/server/inventory-families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Desvincula una variante de su familia (`inventory.write`): vuelve a ser un producto suelto con su nombre, stock y precio. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id, itemId } = await params;
  const result = await db.$transaction((tx) => unlinkVariant(tx, organizationId, id, itemId), { timeout: 20_000 });
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "InventoryItem",
    entityId: itemId,
    summary: `Desvinculó «${result.name}» de su familia (queda como producto suelto)`,
    detail: { changes: { familyId: { from: id, to: null } } },
  });
  return Response.json({ ok: true, family: await getFamilyView(db, organizationId, id) });
}
