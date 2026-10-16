import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { eventVenueSnapshot, venueKey, type EventVenue, type SavedEventVenue } from "@/lib/event-venues";
import { parseEventFields } from "@/app/api/admin/events/event-fields";
import { db } from "./db";

export class EventVenueError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function loadEventVenues(organizationId: string): Promise<SavedEventVenue[]> {
  // Sólo datos del lugar, sin cliente/responsable ni restricciones heredadas del listado de eventos.
  return db.$queryRaw<SavedEventVenue[]>(Prisma.sql`SELECT "id", "revision", "needsReview", "location", "city", "department", "address", "addressReference", "locationUrl", "venueContactName", "venueContactPhone", "venueContactEmail"
    FROM "EventVenue" WHERE "organizationId" = ${organizationId} ORDER BY "key", "id"`);
}

export async function saveEventVenue(organizationId: string, body: Record<string, unknown>): Promise<{ venue: SavedEventVenue; before: SavedEventVenue | null }> {
  if (body.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) throw new EventVenueError("Elegí el recinto a actualizar.", 400);
  const id = typeof body.id === "string" ? body.id : null;
  if (id && (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)) throw new EventVenueError("Actualizá la libreta antes de guardar sus datos predeterminados.", 409, "venue_revision_conflict");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(135265, hashtext(${organizationId}))`;
    const before = id ? (await tx.$queryRaw<SavedEventVenue[]>(Prisma.sql`SELECT * FROM "EventVenue" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`))[0] ?? null : null;
    if (id && !before) throw new EventVenueError("No encontramos ese recinto en la empresa activa.", 404);
    if (before && before.revision !== body.expectedRevision) throw new EventVenueError("Otra persona cambió los datos predeterminados. Volvé a elegir el recinto guardado para revisar la última ficha.", 409, "venue_revision_conflict");
    const parsed = parseEventFields(Object.fromEntries(Object.keys(eventVenueSnapshot({})).filter(key => key in body).map(key => [key, body[key]])), before?.city);
    if (!parsed.ok) throw new EventVenueError(parsed.error, 400);
    if (parsed.data.city !== undefined && parsed.data.city !== before?.city && parsed.data.department === undefined) parsed.data.department = null;
    const data = eventVenueSnapshot({ ...(before ?? {}), ...parsed.data });
    if (!data.location?.trim()) throw new EventVenueError("Ingresá el nombre del recinto.", 400);
    data.location = data.location.trim().replace(/\s+/g, " ");
    const key = venueKey(data.location);
    const duplicate = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "EventVenue" WHERE "organizationId" = ${organizationId} AND "key" = ${key}`);
    if (duplicate.some(row => row.id !== id)) throw new EventVenueError("Ese recinto ya está en la libreta. Seleccionalo para revisar o actualizar sus datos predeterminados.", 409, "venue_duplicate");
    const savedId = id ?? randomUUID();
    const rows = before
      ? await tx.$queryRaw<SavedEventVenue[]>(Prisma.sql`UPDATE "EventVenue" SET "key" = ${key}, "location" = ${data.location}, "city" = ${data.city}, "department" = ${data.department}, "address" = ${data.address}, "addressReference" = ${data.addressReference}, "locationUrl" = ${data.locationUrl}, "venueContactName" = ${data.venueContactName}, "venueContactPhone" = ${data.venueContactPhone}, "venueContactEmail" = ${data.venueContactEmail}, "revision" = "revision" + 1, "needsReview" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${savedId} AND "organizationId" = ${organizationId} RETURNING *`)
      : await tx.$queryRaw<SavedEventVenue[]>(Prisma.sql`INSERT INTO "EventVenue" ("id", "organizationId", "key", "location", "city", "department", "address", "addressReference", "locationUrl", "venueContactName", "venueContactPhone", "venueContactEmail") VALUES (${savedId}, ${organizationId}, ${key}, ${data.location}, ${data.city}, ${data.department}, ${data.address}, ${data.addressReference}, ${data.locationUrl}, ${data.venueContactName}, ${data.venueContactPhone}, ${data.venueContactEmail}) RETURNING *`);
    const row = rows[0];
    // Nunca expone columnas internas ni ningún campo de un evento.
    return { venue: { id: row.id, revision: row.revision, needsReview: row.needsReview, ...eventVenueSnapshot(row) }, before };
  });
}
