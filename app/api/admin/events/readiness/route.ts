import { requireAdminContext } from "@/lib/server/tenancy";
import { loadEventReadiness } from "@/lib/server/event-readiness";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seña de cada evento, de solo lectura y liviana (rediseño de Eventos).
 *
 * `GET` → todos los eventos de la empresa activa; `GET ?eventIds=a,b` → solo esos
 * (los que no son de la empresa no aparecen). Por evento: `{eventId, budgetId,
 * hasBudget, advanceAmount, collected}` más título, etapa y total del presupuesto
 * vinculado. El cobrado se suma en la base; no hay tope de filas.
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  try {
    const raw = new URL(request.url).searchParams.get("eventIds");
    const ids = raw === null ? null : [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
    const readiness = await loadEventReadiness(auth.context.organizationId, ids);
    return Response.json({ readiness });
  } catch (error) {
    console.error("[events/readiness] no se pudo leer la seña por evento", error);
    return jsonError("No pudimos leer la seña de los eventos.", 500);
  }
}
