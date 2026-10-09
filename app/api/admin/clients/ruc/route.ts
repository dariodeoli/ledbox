import { requireAdminContext } from "@/lib/server/tenancy";
import { rateLimit } from "@/lib/server/rate-limit";
import { readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { lookupOwnData, OwnDataLookupError } from "@/lib/server/ruc-owndata";
import { signRucConfirmation } from "@/lib/server/ruc-confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Consulta explícita con permiso de escritura. Nunca usa la clave en /api/ruc público. */
export async function POST(request: Request) {
  const auth = await requireAdminContext("clients.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Consulta inválida.", manualEntryAllowed: true }, { status: 400 });
  const { numero, confirmLookup } = body as Record<string, unknown>;
  if (confirmLookup !== true) return Response.json({ error: "Confirmá la consulta OwnData: puede consumir cuota del proveedor.", manualEntryAllowed: true }, { status: 400 });
  const { organizationId, user } = auth.context;
  const limited = await rateLimit(`ruc:ownData:${organizationId}:${user.id}`, 10);
  if (!limited.allowed) return Response.json({ error: "Alcanzaste el límite de consultas. Completá a mano.", code: "RATE_LIMITED", manualEntryAllowed: true }, { status: 429, headers: { "Retry-After": String(limited.retryAfter), "Cache-Control": "private, no-store" } });
  try {
    const result = await lookupOwnData(typeof numero === "string" ? numero.trim() : "");
    const confirmation = await signRucConfirmation(result, organizationId, user.id);
    await recordAudit({ context: auth.context, action: "update", entity: "Organization", entityId: organizationId, summary: "Consultó OwnData para revisar identidad fiscal (sin aplicar al cliente)", detail: { fields: { source: result.ownData.provenance.source, publicationDate: result.ownData.provenance.publicationDate, lookedUpAt: confirmation.lookedUpAt, environment: result.ownData.environment, quotaUsed: result.ownData.quota.used, costKnown: false } } });
    return Response.json({ ...result, ...confirmation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const e = error instanceof OwnDataLookupError ? error : new OwnDataLookupError("OWNDATA_UNAVAILABLE", 503, "OwnData no está disponible. Completá los datos a mano.");
    await recordAudit({ context: auth.context, action: "update", entity: "Organization", entityId: organizationId, summary: "La consulta de identidad fiscal OwnData no produjo un resultado aplicable", detail: { fields: { code: e.code, status: e.status, costKnown: false } } });
    return Response.json({ error: e.message, code: e.code, manualEntryAllowed: true, ...(e.retryAfter !== undefined ? { retryAfter: e.retryAfter } : {}) }, { status: e.status, headers: { "Cache-Control": "private, no-store", ...(e.retryAfter !== undefined ? { "Retry-After": String(e.retryAfter) } : {}) } });
  }
}
