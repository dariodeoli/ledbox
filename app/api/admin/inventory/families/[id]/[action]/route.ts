import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError, readJson } from "@/lib/server/http";
import { restore, trashErrorResponse } from "@/lib/server/trash";
import { purgeInventoryFamily } from "@/lib/server/trash-ops";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recuperación explícita de familias: no vuelve a vincular sus antiguos productos. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (action !== "restore" && action !== "purge") return jsonError("Acción desconocida.", 404);
  const auth = await requireAdminContext("trash.manage");
  if (!auth.ok) return auth.response;
  try {
    if (action === "restore") await restore("InventoryFamily", id, auth.context);
    else {
      const parsed = await readJson(request).catch(() => null);
      const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      await purgeInventoryFamily(id, { confirmName: body.confirmName, reason: body.reason }, auth.context);
    }
    return Response.json({ ok: true, id, action });
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
