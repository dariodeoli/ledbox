import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { readInventoryProductHistory } from "@/lib/server/inventory-product-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tenant-scoped history and latest physical count for one inventory product. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id || id.length > 120) return jsonError("El producto no es válido.", 400);
  const rawTake = Number(new URL(request.url).searchParams.get("take") ?? 50);
  const take = Number.isInteger(rawTake) ? Math.min(100, Math.max(1, rawTake)) : 50;
  const history = await readInventoryProductHistory(db, { organizationId: auth.context.organizationId, inventoryId: id, take });
  if (!history) return jsonError("No encontramos ese producto en la empresa activa.", 404);
  return Response.json(history);
}
