import { trashErrorResponse } from "@/lib/server/trash";
import { INVENTORY_ACTION_CAPABILITY, runInventoryAction } from "@/lib/server/trash-ops";
import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Papelera de productos (docs/PAPELERA.md), `POST /api/admin/inventory/[id]/[action]`.
 * Archivar y desarchivar siguen en `POST /api/admin/inventory` (`item-archive` / `item-restore`).
 * - `trash` (eliminar): `inventory.write`; solo archivados; 409 `{ blockers }` con asignaciones
 *   futuras, incidentes abiertos o combos vivos que lo usan. Body opcional `{ reason }`.
 * - `restore` (de la papelera, vuelve a archivado) y `purge` (`{ confirmName, reason }`): `trash.manage`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const capability = Object.hasOwn(INVENTORY_ACTION_CAPABILITY, action) ? INVENTORY_ACTION_CAPABILITY[action] : undefined;
  if (!capability) return jsonError("Acción desconocida.", 404);
  const auth = await requireAdminContext(capability);
  if (!auth.ok) return auth.response;
  const parsedBody = await readJson(request).catch(() => null);
  const body = (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {}) as Record<string, unknown>;
  try {
    await runInventoryAction(action, id, body, auth.context);
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
  return Response.json({ ok: true, id, action });
}
