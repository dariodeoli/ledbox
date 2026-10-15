import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { auditRenames } from "@/lib/server/inventory-families-audit";
import { applySamePrice, getFamilyView, trashFamily, updateFamily } from "@/lib/server/inventory-families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Una familia de variantes (docs/VARIANTES.md). Todo acotado a la empresa activa: una familia ajena es 404.
 *
 * - `GET`: la familia con sus variantes (cualquier rol).
 * - `PATCH { name?, code?, categoryId?, axes?, publicDescription?, coverItemId?, archived? }`: edita y propaga
 *   nombre y categoría a las variantes en la misma transacción (`inventory.write`).
 * - `POST { kind: "same-price", sourceItemId }`: «mismo precio para todas»: copia los precios de la variante
 *   de referencia a las que no tienen precio propio.
 * - `DELETE { reason? }`: la manda a la papelera y desvincula sus variantes (quedan como productos sueltos).
 */

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const family = await getFamilyView(db, auth.context.organizationId, id);
  if (!family) return jsonError("La familia no existe en esta empresa.", 404);
  return Response.json({ family });
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;
  const body = (await readJson(request)) as Record<string, unknown>;
  const result = await db.$transaction(
    async (tx) => {
      const updated = await updateFamily(tx, organizationId, id, body);
      if (!updated.ok) return updated;
      return { ...updated, family: await getFamilyView(tx, organizationId, id) };
    },
    { timeout: 20_000 },
  );
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "InventoryFamily",
    entityId: id,
    summary: `Editó la familia «${result.family?.name ?? result.before.name}»`,
    detail: { changes: { ...(result.before.name !== result.family?.name ? { name: { from: result.before.name, to: result.family?.name } } : {}), ...(result.before.code !== result.family?.code ? { code: { from: result.before.code, to: result.family?.code } } : {}) } },
  });
  await auditRenames(auth.context, result.renamed, "Cambió la familia");
  return Response.json({ family: result.family, renamed: result.renamed });
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const { id } = await params;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.kind !== "same-price") return jsonError("Operación de familia desconocida.", 400);
  const result = await db.$transaction((tx) => applySamePrice(tx, organizationId, id, body.sourceItemId), { timeout: 20_000 });
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "InventoryFamily",
    entityId: id,
    summary: `Aplicó el mismo precio a ${result.updatedIds.length} variantes de la familia`,
    detail: { fields: { actualizadas: result.updatedIds.length, conPrecioPropio: result.skipped } },
  });
  return Response.json({ updatedIds: result.updatedIds, skipped: result.skipped, family: await getFamilyView(db, organizationId, id) });
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;
  const { id } = await params;
  const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : null;
  const result = await db.$transaction((tx) => trashFamily(tx, organizationId, id, user.id, reason), { timeout: 20_000 });
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "trash",
    entity: "InventoryFamily",
    entityId: id,
    summary: `Mandó a la papelera la familia «${result.name}» (${result.unlinked} productos quedaron sueltos)`,
    detail: { fields: { desvinculados: result.unlinked } },
  });
  return Response.json({ ok: true, unlinked: result.unlinked });
}
