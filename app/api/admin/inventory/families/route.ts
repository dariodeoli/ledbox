import { db } from "@/lib/server/db";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { auditRenames } from "@/lib/server/inventory-families-audit";
import { createFamily, getFamilyView, listFamilyViews } from "@/lib/server/inventory-families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Familias de variantes de la empresa activa (docs/VARIANTES.md).
 *
 * - `GET`: las familias vivas con sus variantes; las lee cualquier rol.
 * - `POST { name, code?, axes, members: [{ itemId, options }], categoryId? }`: agrupa productos sueltos en una
 *   familia nueva (`inventory.write`). Cada producto ya existente pasa a llamarse «Familia · Opción».
 *   Un id ajeno responde 404; una combinación repetida, 409.
 */

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  return Response.json({ families: await listFamilyViews(db, auth.context.organizationId) });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Los datos deben ser un objeto JSON.", 400);
  const result = await db.$transaction(
    async (tx) => {
      const created = await createFamily(tx, organizationId, {
        name: body.name,
        code: body.code,
        axes: body.axes,
        members: body.members,
        categoryId: body.categoryId,
        publicDescription: body.publicDescription,
      });
      if (!created.ok) return created;
      return { ...created, family: await getFamilyView(tx, organizationId, created.familyId) };
    },
    { timeout: 20_000 },
  );
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "InventoryFamily",
    entityId: result.familyId,
    summary: `Agrupó ${result.renamed.length || result.family?.variants.length || 0} productos en la familia «${result.family?.name ?? ""}»`,
    detail: { fields: { codigo: result.family?.code, variantes: result.family?.variants.length ?? 0 } },
  });
  await auditRenames(auth.context, result.renamed, "Agrupó en una familia");
  return Response.json({ family: result.family, renamed: result.renamed }, { status: 201 });
}
