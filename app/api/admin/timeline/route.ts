import { buildBudgetTimeline, buildEventTimeline } from "@/lib/server/timeline";
import { requireAdminContext } from "@/lib/server/tenancy";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/timeline` (issue #33): cronología real de un presupuesto
 * (`?budgetId=`) o de un evento (`?eventId=`) de la empresa activa.
 *
 * La lectura es para cualquier rol con membresía —`VIEWER` lee la cronología
 * completa del panel— y siempre se filtra por `organizationId`: un id de otra
 * empresa responde 404 sin revelar nada. Los hitos salen de
 * `lib/server/timeline.ts` (fuente única que también alimenta el portal).
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const budgetId = (params.get("budgetId") ?? "").trim();
  const eventId = (params.get("eventId") ?? "").trim();
  if (budgetId && eventId) return jsonError("Elegí un presupuesto o un evento, no los dos.", 400);

  if (budgetId) {
    const timeline = await buildBudgetTimeline(auth.context.organizationId, budgetId);
    if (!timeline) return jsonError("No encontramos ese presupuesto en la empresa activa.", 404);
    return Response.json({ timeline });
  }

  if (eventId) {
    const timeline = await buildEventTimeline(auth.context.organizationId, eventId);
    if (!timeline) return jsonError("No encontramos ese evento en la empresa activa.", 404);
    return Response.json({ timeline });
  }

  return jsonError("Indicá el presupuesto o el evento de la cronología.", 400);
}
