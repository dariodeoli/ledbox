import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { trashErrorResponse } from "@/lib/server/trash";
import { crmActionCapability, runCrmAction, type CrmModel } from "@/lib/server/trash-crm";

/**
 * Manejador común de `POST /api/admin/<entidad>/[id]/[action]` (clients, leads, suppliers,
 * promoters, budgets). `archive`/`unarchive`/`trash` usan la capacidad de escritura de la
 * entidad; `restore`/`purge`/`anonymize` exigen `trash.manage` (OWNER y ADMIN).
 */
export async function handleCrmAction(model: CrmModel, request: Request, params: Promise<{ id: string; action: string }>) {
  const { id, action } = await params;
  const capability = crmActionCapability(model, action);
  if (!capability) return jsonError("Acción desconocida.", 404);
  const auth = await requireAdminContext(capability);
  if (!auth.ok) return auth.response;
  const parsedBody = await readJson(request).catch(() => null);
  const body = (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {}) as Record<string, unknown>;
  try {
    await runCrmAction(model, action, id, body, auth.context);
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
  return Response.json({ ok: true, id, action });
}
