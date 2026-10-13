import { trashErrorResponse } from "@/lib/server/trash";
import { EVENT_ACTION_CAPABILITY, runEventAction } from "@/lib/server/trash-ops";
import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Papelera de eventos (docs/PAPELERA.md), `POST /api/admin/events/[id]/[action]`:
 * - `archive` / `unarchive` / `trash` (eliminar): `events.write`. Solo archivan COMPLETED, CANCELLED o DRAFT;
 *   solo se elimina lo archivado, sin estado CONFIRMED/IN_PROGRESS ni reservas sin liberar. Body opcional `{ reason }` en `trash`.
 * - `restore` / `purge` / `anonymize`: `trash.manage` (OWNER y ADMIN). `purge` y `anonymize` piden
 *   `{ confirmName, reason }`; `purge` responde 409 `{ blockers }` si hay datos contables.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  const capability = Object.hasOwn(EVENT_ACTION_CAPABILITY, action) ? EVENT_ACTION_CAPABILITY[action] : undefined;
  if (!capability) return jsonError("Acción desconocida.", 404);
  const auth = await requireAdminContext(capability);
  if (!auth.ok) return auth.response;
  const parsedBody = await readJson(request).catch(() => null);
  const body = (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {}) as Record<string, unknown>;
  try {
    await runEventAction(action, id, body, auth.context);
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
  return Response.json({ ok: true, id, action });
}
