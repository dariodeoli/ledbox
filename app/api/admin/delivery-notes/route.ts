import { jsonError } from "@/lib/server/http";
import { listDeliveryNotes } from "@/lib/server/delivery-notes";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remitos de un evento de la empresa activa. Cualquier rol los ve (VIEWER solo mira). */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const eventId = new URL(request.url).searchParams.get("eventId") ?? "";
  if (!eventId) return jsonError("Falta el evento.", 400);
  const event = await db.event.findFirst({ where: { id: eventId, organizationId: auth.context.organizationId }, select: { id: true } });
  if (!event) return jsonError("El evento no existe en esta empresa.", 404);
  return Response.json({ notes: await listDeliveryNotes(auth.context.organizationId, eventId) });
}
