import { randomBytes, randomUUID } from "node:crypto";
import type { InventoryStatus } from "@prisma/client";
import { registroConsentimiento } from "owncoding-ui/utils";
import { z } from "zod";
import { APP_VERSION } from "@/lib/version";
import {
  MAX_PREORDER_DAYS,
  PREORDER_RESPONSE_HOURS,
  addBusinessHours,
  availabilityHint,
  estimatedSubtotal,
  preorderWhatsappMessage,
  preorderWhatsappUrl,
  referenceDailyPrice,
  rentalDaysBetween,
  type AvailabilityHint,
} from "@/lib/catalog-public";
import { db } from "./db";
import { isDemoOrganizationSlug } from "./demo-data";
import { inventoryImageUrl } from "./inventory-images";
import {
  EVENT_RANGE_SELECT,
  MAINTENANCE_UNITS_SELECT,
  buildAvailability,
  committedAssignmentWhere,
  maintenanceUnits,
  resolveRentalBuffers,
  type AssignmentRecord,
} from "./inventory-availability";
import type { IdempotentTx } from "./idempotency";
import { dayKeyOf, dayStart, isValidDayKey, nextDayKey } from "./notifications";
import { getRentalSettings, type RentalSettingsView } from "./rental-settings";
import { phoneKey } from "./lead-client";

/**
 * Catálogo público por empresa y preórdenes (alquileres fase 3).
 *
 * Reglas que no se negocian:
 * - Solo se publica lo que la empresa marcó (`visibleOnWeb`) y solo si el
 *   catálogo está encendido; si no, la empresa "no existe" (404).
 * - Los DTO se arman campo por campo: nunca se serializa una fila de inventario
 *   (costos, mayorista, piso, notas internas y stock exacto no salen).
 * - Una preorden NO toca `EventInventory`: no compromete stock.
 */

export type PublicOrganization = { id: string; name: string; slug: string };
export type PublicCatalogContext = { organization: PublicOrganization; settings: RentalSettingsView; demo: boolean };

/** Empresa con catálogo público encendido; `null` si no existe, está inactiva o lo apagó. */
export async function resolvePublicCatalog(slug: string): Promise<PublicCatalogContext | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized || normalized.length > 80) return null;
  const organization = await db.organization.findFirst({
    where: { slug: normalized, active: true },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) return null;
  const settings = await getRentalSettings(organization.id);
  if (!settings.publicCatalogEnabled) return null;
  return { organization, settings, demo: isDemoOrganizationSlug(organization.slug) };
}

/** Artículo tal como lo ve el público: sin costos, sin stock exacto, sin notas. */
export type PublicCatalogItem = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  imageUrl: string | null;
  /** Precio de venta de referencia por día; `null` si la empresa no muestra precios. */
  price: { listPrice: number; listFromDays: number; listFromPrice: number } | null;
  /** Pista de disponibilidad para las fechas elegidas; `null` si no hay fechas. */
  availability: AvailabilityHint | null;
};

type CatalogRow = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  imageUrl: string | null;
  imageMime: string | null;
  updatedAt: Date;
  quantity: number;
  status: InventoryStatus;
  listPrice: number;
  listFromDays: number;
  listFromPrice: number;
  bufferBeforeMin: number | null;
  bufferAfterMin: number | null;
  incidentHold: number;
  _count: { units: number };
};

/** Lectura mínima (sin `imageData` ni ningún costo): solo lo que el DTO necesita. */
async function loadVisibleRows(organizationId: string, ids?: readonly string[]): Promise<CatalogRow[]> {
  return db.inventoryItem.findMany({
    where: { organizationId, visibleOnWeb: true, archivedAt: null, status: { not: "RETIRED" }, ...(ids ? { id: { in: [...ids] } } : {}) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      category: true,
      sku: true,
      imageUrl: true,
      imageMime: true,
      updatedAt: true,
      quantity: true,
      status: true,
      listPrice: true,
      listFromDays: true,
      listFromPrice: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
      incidentHold: true,
      _count: { select: MAINTENANCE_UNITS_SELECT },
    },
  });
}

export type PublicRange = { fromKey: string; toKey: string; startsAt: Date; endsAt: Date; days: number };

/** Período del pedido (días `YYYY-MM-DD`, ambos inclusive, hasta 90 días); `null` si no es válido. */
export function parsePublicRange(fromKey: unknown, toKey: unknown, today: string = dayKeyOf(new Date())): PublicRange | null {
  if (typeof fromKey !== "string" || typeof toKey !== "string") return null;
  if (!isValidDayKey(fromKey) || !isValidDayKey(toKey)) return null;
  if (fromKey < today || toKey < fromKey) return null;
  const days = rentalDaysBetween(fromKey, toKey);
  if (days > MAX_PREORDER_DAYS) return null;
  return { fromKey, toKey, days, startsAt: dayStart(fromKey), endsAt: new Date(dayStart(nextDayKey(toKey)).getTime() - 60_000) };
}

/** Pista de disponibilidad por artículo con el motor real (tiempos y retenciones incluidos). */
async function hintsFor(organizationId: string, rows: readonly CatalogRow[], range: PublicRange): Promise<Map<string, AvailabilityHint>> {
  const settings = await db.organizationRentalSettings.findUnique({ where: { organizationId } });
  const assignments = rows.length
    ? await db.eventInventory.findMany({
        where: { inventoryId: { in: rows.map((row) => row.id) }, ...committedAssignmentWhere(organizationId) },
        orderBy: { startsAt: "asc" },
        take: 5000,
        include: { event: { select: EVENT_RANGE_SELECT } },
      })
    : [];
  const byItem = new Map<string, AssignmentRecord[]>();
  for (const assignment of assignments) {
    const list = byItem.get(assignment.inventoryId) ?? [];
    list.push(assignment);
    byItem.set(assignment.inventoryId, list);
  }
  const hints = new Map<string, AvailabilityHint>();
  for (const row of rows) {
    const availability = buildAvailability(
      { id: row.id, name: row.name, quantity: row.quantity, status: row.status, maintenance: maintenanceUnits(row), buffers: resolveRentalBuffers(settings, row) },
      byItem.get(row.id) ?? [],
      range.startsAt,
      range.endsAt,
    );
    hints.set(row.id, availabilityHint({ available: availability.available, total: availability.total, blocked: availability.blocked }));
  }
  return hints;
}

/** Catálogo de la empresa listo para serializar al público. */
export async function loadPublicCatalogItems(context: PublicCatalogContext, range: PublicRange | null): Promise<PublicCatalogItem[]> {
  const rows = await loadVisibleRows(context.organization.id);
  const hints = range ? await hintsFor(context.organization.id, rows, range) : null;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    sku: row.sku,
    imageUrl: inventoryImageUrl(row),
    price: context.settings.publicShowPrices ? { listPrice: row.listPrice, listFromDays: row.listFromDays, listFromPrice: row.listFromPrice } : null,
    availability: hints?.get(row.id) ?? null,
  }));
}

// ── Preorden ─────────────────────────────────────────────────────────────────

const honeypot = z.string().max(0).optional().or(z.literal(""));
const dayKey = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

export const preorderSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(40),
  email: z.string().trim().email().max(320),
  location: z.string().trim().min(2).max(240),
  from: dayKey,
  to: dayKey,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z
    .array(z.object({ inventoryId: z.string().trim().min(1).max(64), quantity: z.coerce.number().int().min(1).max(99) }))
    .min(1)
    .max(40),
  idempotencyKey: z.string().trim().max(200).optional(),
  honeypot,
  website: honeypot,
});
export type PreorderInput = z.infer<typeof preorderSchema>;

export type PreorderResult =
  | { ok: true; status: 201; body: { preorder: PreorderBody } }
  | { ok: false; status: number; error: string };

export type PreorderBody = {
  token: string;
  status: "NEW";
  respondBy: string;
  trackingPath: string;
  whatsappUrl: string | null;
  subtotal: number | null;
};

function trackingToken(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Crea o reutiliza el lead de ESA empresa y crea el pedido con sus ítems, todo en
 * la transacción del llamador (idempotencia). No escribe nada de inventario.
 */
export async function createPreorder(
  tx: IdempotentTx,
  context: PublicCatalogContext,
  input: PreorderInput,
  origin: string,
  now: Date = new Date(),
): Promise<PreorderResult> {
  const organizationId = context.organization.id;
  const range = parsePublicRange(input.from, input.to, dayKeyOf(now));
  if (!range) return { ok: false, status: 400, error: `Elegí fechas válidas: desde hoy, con el fin igual o posterior al inicio y hasta ${MAX_PREORDER_DAYS} días.` };

  const quantities = new Map<string, number>();
  for (const item of input.items) quantities.set(item.inventoryId, (quantities.get(item.inventoryId) ?? 0) + item.quantity);
  const ids = [...quantities.keys()];
  const rows = await tx.inventoryItem.findMany({
    where: { organizationId, visibleOnWeb: true, archivedAt: null, status: { not: "RETIRED" }, id: { in: ids } },
    select: { id: true, name: true, sku: true, listPrice: true, listFromDays: true, listFromPrice: true },
  });
  if (rows.length !== ids.length) return { ok: false, status: 400, error: "Alguno de los artículos ya no está en el catálogo. Actualizá la página y revisá tu selección." };
  if ([...quantities.values()].some((quantity) => quantity > 99)) return { ok: false, status: 400, error: "La cantidad por artículo no puede superar 99." };

  const showPrices = context.settings.publicShowPrices;
  const lines = rows.map((row) => ({
    row,
    quantity: quantities.get(row.id) ?? 1,
    unitPrice: showPrices ? referenceDailyPrice(row, range.days) || null : null,
  }));
  const subtotal = showPrices ? estimatedSubtotal(lines.map((line) => ({ name: line.row.name, quantity: line.quantity, unitPrice: line.unitPrice })), range.days) : null;

  // Lead de ESTA empresa: se reutiliza el abierto con el mismo correo o teléfono.
  const email = input.email.trim().toLowerCase();
  const wanted = phoneKey(input.phone);
  const openLeads = await tx.lead.findMany({
    where: { organizationId, status: { in: ["NEW", "CONTACTED", "QUOTED"] }, OR: [{ email }, { phone: input.phone }] },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, email: true, phone: true },
  });
  const existing = openLeads.find((lead) => lead.email.trim().toLowerCase() === email || (wanted && phoneKey(lead.phone) === wanted));
  let leadId = existing?.id ?? null;
  if (!leadId) {
    const consent = registroConsentimiento({ finalidad: "consulta", aceptado: true, version: APP_VERSION, canal: "catalogo-publico" });
    const lead = await tx.lead.create({
      data: {
        id: randomUUID(),
        organizationId,
        name: input.name,
        phone: input.phone,
        email,
        reason: "Pedido del catálogo público",
        eventDate: range.startsAt,
        location: input.location,
        message: input.notes || undefined,
        source: "catalogo",
        consentAt: new Date(consent.fecha),
        consentChannel: consent.canal,
        consentVersion: consent.version,
      },
      select: { id: true },
    });
    leadId = lead.id;
  }

  const token = trackingToken();
  const respondBy = addBusinessHours(now, PREORDER_RESPONSE_HOURS);
  await tx.quoteRequest.create({
    data: {
      id: randomUUID(),
      organizationId,
      leadId,
      status: "NEW",
      source: "catalogo",
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      eventDate: range.startsAt,
      durationDays: range.days,
      location: input.location,
      referenceTotal: subtotal ?? undefined,
      publicToken: token,
      respondBy,
      items: {
        create: lines.map((line) => ({
          id: randomUUID(),
          inventoryId: line.row.id,
          productSlug: line.row.sku || line.row.id,
          productName: line.row.name,
          quantity: line.quantity,
          duration: range.days,
          billingUnit: "DAILY" as const,
          unitPrice: line.unitPrice ?? undefined,
          subtotal: line.unitPrice ? line.unitPrice * line.quantity * range.days : undefined,
          notes: undefined,
        })),
      },
    },
  });

  const trackingPath = `/pedido/${token}`;
  const message = preorderWhatsappMessage({
    organizationName: context.organization.name,
    lines: lines.map((line) => ({ name: line.row.name, quantity: line.quantity, unitPrice: line.unitPrice })),
    fromKey: range.fromKey,
    toKey: range.toKey,
    location: input.location,
    name: input.name,
    subtotal,
    trackingUrl: `${origin}${trackingPath}`,
  });
  return {
    ok: true,
    status: 201,
    body: {
      preorder: { token, status: "NEW", respondBy: respondBy.toISOString(), trackingPath, whatsappUrl: preorderWhatsappUrl(context.settings.whatsappPhone, message), subtotal },
    },
  };
}

// ── Seguimiento público (solo lectura, sin datos internos) ───────────────────

export type PublicOrderView = {
  status: string;
  createdAt: string;
  respondBy: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  subtotal: number | null;
  organization: { name: string; whatsappPhone: string | null };
  items: Array<{ name: string; quantity: number }>;
};

/** Pedido por su token; `null` si no existe. Solo campos aptos para quien lo hizo. */
export async function loadPublicOrder(token: string): Promise<PublicOrderView | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const quote = await db.quoteRequest.findUnique({
    where: { publicToken: token },
    select: {
      status: true,
      createdAt: true,
      respondBy: true,
      startsAt: true,
      endsAt: true,
      location: true,
      referenceTotal: true,
      organizationId: true,
      items: { orderBy: { productName: "asc" }, select: { productName: true, quantity: true } },
    },
  });
  if (!quote?.organizationId) return null;
  const [organization, settings] = await Promise.all([
    db.organization.findUnique({ where: { id: quote.organizationId }, select: { name: true } }),
    db.organizationRentalSettings.findUnique({ where: { organizationId: quote.organizationId }, select: { whatsappPhone: true } }),
  ]);
  if (!organization) return null;
  return {
    status: quote.status,
    createdAt: quote.createdAt.toISOString(),
    respondBy: quote.respondBy?.toISOString() ?? null,
    startsAt: quote.startsAt?.toISOString() ?? null,
    endsAt: quote.endsAt?.toISOString() ?? null,
    location: quote.location,
    subtotal: quote.referenceTotal,
    organization: { name: organization.name, whatsappPhone: settings?.whatsappPhone ?? null },
    items: quote.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
  };
}
