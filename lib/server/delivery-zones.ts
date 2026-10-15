import type { Prisma } from "@prisma/client";
import type { DeliveryZoneRates, DeliveryZoneView } from "@/lib/delivery-zones";
import { db } from "./db";

type Client = Pick<Prisma.TransactionClient, "deliveryZone">;

const VIEW_SELECT = { id: true, name: true, basePrice: true, volumeThreshold: true, extraPrice: true, notes: true, sortOrder: true, archivedAt: true } as const;

export function zoneView(row: { id: string; name: string; basePrice: number; volumeThreshold: number | null; extraPrice: number | null; notes: string | null; sortOrder: number; archivedAt: Date | null }): DeliveryZoneView {
  return { ...row, archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null };
}

/** Zonas de la empresa (siempre filtradas por organización). */
export async function listDeliveryZones(organizationId: string, options: { includeArchived?: boolean } = {}, client: Client = db): Promise<DeliveryZoneView[]> {
  const rows = await client.deliveryZone.findMany({
    where: { organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: VIEW_SELECT,
    take: 200,
  });
  return rows.map(zoneView);
}

/** Zonas visibles para el público: solo las activas y solo precios (nunca las notas internas). */
export async function listPublicDeliveryZones(organizationId: string): Promise<Array<DeliveryZoneRates & { id: string; name: string }>> {
  const rows = await db.deliveryZone.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, basePrice: true, volumeThreshold: true, extraPrice: true },
    take: 100,
  });
  return rows;
}

/**
 * Elección de flete de un pedido de la tienda: una zona de ESTA empresa y activa, o «a coordinar»,
 * o ninguna. Una zona ajena, archivada o inexistente es un error (no se inventa otra).
 */
export async function resolveDeliveryChoice(
  tx: Client,
  organizationId: string,
  input: { deliveryZoneId?: string | null; deliveryCoordinate?: boolean | null },
): Promise<{ ok: true; zone: (DeliveryZoneRates & { id: string; name: string }) | null; coordinate: boolean } | { ok: false; error: string }> {
  const zoneId = input.deliveryZoneId?.trim();
  if (!zoneId) return { ok: true, zone: null, coordinate: input.deliveryCoordinate === true };
  const zone = await tx.deliveryZone.findFirst({
    where: { id: zoneId, organizationId, archivedAt: null },
    select: { id: true, name: true, basePrice: true, volumeThreshold: true, extraPrice: true },
  });
  if (!zone) return { ok: false, error: "La zona de flete elegida ya no está disponible. Elegí otra o dejá «A coordinar»." };
  return { ok: true, zone, coordinate: false };
}

