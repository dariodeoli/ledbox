import { requireAdminContext } from "@/lib/server/tenancy";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { EventVenueError, loadEventVenues, saveEventVenue } from "@/lib/server/event-venues";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { VENUE_FIELDS } from "@/lib/event-venues";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  return Response.json({ venues: await loadEventVenues(auth.context.organizationId) });
}

/** Acción explícita de libreta: guardar un evento jamás llama a este endpoint. */
export async function POST(request: Request) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Indicá los datos del recinto.", 400);
  try {
    const { venue, before } = await saveEventVenue(auth.context.organizationId, body);
    await recordAudit({ context: auth.context, action: before ? "update" : "create", entity: "EventVenue", entityId: venue.id,
      summary: `${before ? "Actualizó los datos predeterminados de" : "Guardó en la libreta"} «${venue.location}»`,
      detail: { changes: auditChanges(before ?? {}, venue, [...VENUE_FIELDS]) ?? {}, fields: { revision: venue.revision } } });
    return Response.json({ venue }, { status: before ? 200 : 201 });
  } catch (error) {
    if (error instanceof EventVenueError) return jsonError(error.message, error.status, error.code);
    const code = typeof error === "object" && error ? (error as { code?: string; meta?: { code?: string } }) : null;
    if (code?.code === "P2002" || code?.meta?.code === "23505") return jsonError("Ese recinto ya está en la libreta. Elegilo para revisar sus datos.", 409, "venue_duplicate");
    throw error;
  }
}
