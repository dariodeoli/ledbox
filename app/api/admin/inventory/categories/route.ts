import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import {
  archiveInventoryCategory,
  listInventoryCategories,
  mergeInventoryCategories,
  moveInventoryCategory,
  renameInventoryCategory,
  resolveInventoryCategory,
  styleInventoryCategory,
} from "@/lib/server/inventory-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Categorías de inventario de la empresa activa (rediseño E1).
 *
 * - `GET`: el árbol plano (categoría + subcategorías) con la cantidad de productos; lo lee cualquier rol.
 * - `POST { kind: "quick", category, subcategory? }`: alta rápida desde el formulario del producto
 *   (`inventory.write`; busca por clave o crea, sin duplicar).
 * - `POST { kind: "create" | "rename" | "move" | "style" | "merge" | "archive" | "restore" }`:
 *   administración en Ajustes → Inventario (`org.manage`: solo OWNER y ADMIN).
 *
 * Todo id se valida contra la empresa activa; uno ajeno responde 404.
 */

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  return Response.json({ categories: await listInventoryCategories(db, auth.context.organizationId) });
}

export async function POST(request: Request) {
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  const auth = await requireAdminContext(kind === "quick" ? "inventory.write" : "org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const id = typeof body.id === "string" ? body.id : "";

  if (kind === "quick" || kind === "create") {
    const resolved = await db.$transaction((tx) => resolveInventoryCategory(tx, organizationId, { category: body.category, subcategory: body.subcategory }));
    if (!resolved) return jsonError("No se pudo crear la categoría.", 400);
    await recordAudit({ context: auth.context, action: "create", entity: "InventoryCategory", entityId: resolved.categoryId, summary: `Categoría «${resolved.text}»`, detail: { fields: { texto: resolved.text } } });
    return Response.json({ category: { id: resolved.categoryId, text: resolved.text, parentName: resolved.parentName, childName: resolved.childName } }, { status: 201 });
  }

  if (!["rename", "move", "style", "merge", "archive", "restore"].includes(kind)) return jsonError("Operación de categorías desconocida.", 400);
  if (kind !== "merge" && !id) return jsonError("Falta la categoría.", 400);

  const result = await db.$transaction(async (tx) => {
    if (kind === "rename") return renameInventoryCategory(tx, organizationId, id, body.name);
    if (kind === "move") return moveInventoryCategory(tx, organizationId, id, typeof body.parentId === "string" && body.parentId ? body.parentId : null);
    if (kind === "style") return styleInventoryCategory(tx, organizationId, id, { color: body.color, icon: body.icon, sortOrder: body.sortOrder });
    if (kind === "merge") return mergeInventoryCategories(tx, organizationId, typeof body.fromId === "string" ? body.fromId : "", typeof body.intoId === "string" ? body.intoId : "");
    return archiveInventoryCategory(tx, organizationId, id, kind === "archive");
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const target = kind === "merge" ? String(body.intoId) : id;
  const summary: Record<string, string> = {
    rename: "Renombró una categoría de inventario",
    move: "Movió una categoría de inventario",
    style: "Cambió el color, ícono u orden de una categoría",
    merge: "Unió dos categorías de inventario",
    archive: "Archivó una categoría de inventario",
    restore: "Restauró una categoría de inventario",
  };
  await recordAudit({ context: auth.context, action: "update", entity: "InventoryCategory", entityId: target, summary: summary[kind], detail: { fields: { operacion: kind, ...("moved" in result ? { productos: result.moved } : {}) } } });
  return Response.json({ ok: true, ...("moved" in result ? { moved: result.moved } : {}) });
}
