import { randomBytes, randomUUID } from "node:crypto";
import type { BillingUnit, InventoryStatus } from "@prisma/client";
import { billedDays } from "@/lib/quote-sharing";
import { registroConsentimiento } from "owncoding-ui/utils";
import { z } from "zod";
import { APP_VERSION } from "@/lib/version";
import {
  MAX_PREORDER_DAYS,
  PREORDER_RESPONSE_HOURS,
  addBusinessHours,
  availabilityHint,
  catalogPriceFor,
  estimatedSubtotal,
  listLine,
  preorderWhatsappMessage,
  preorderWhatsappUrl,
  rentalDaysBetween,
  type AvailabilityHint,
  type CatalogPrice,
} from "@/lib/catalog-public";
import { catalogAudienceWhere, type PriceList } from "@/lib/catalog-audience";
import { appearanceView, type AppearanceView } from "@/lib/appearance";
import { PRICE_REQUESTS_PER_ORDER, PRICE_REQUEST_ORDER_STATUSES, parsePriceRequest } from "@/lib/price-request";
import { sortStorefrontItems } from "@/lib/storefront-order";
import { profileHasData, type OrgProfile } from "@/lib/org-profile";
import { storefrontTheme, type StorefrontTheme } from "@/lib/storefront-theme";
import { catalogTokenHash, isCatalogTokenShape, resolveCatalogAccess, type ResolvedCatalogAccess } from "./catalog-access";
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
import { listPublicDeliveryZones, resolveDeliveryChoice } from "./delivery-zones";
import { TIER_SELECT } from "./line-pricing";
import type { AudiencePriceTier } from "@/lib/price-tiers";
import { deliveryFee } from "@/lib/delivery-zones";
import { coverUrl, loadOrgPresentation } from "./org-presentation";
import { createPriceRequestInTx, loadPriceRequests, type PriceRequestView } from "./quote-price-request";

/**
 * Catálogo público por empresa y preórdenes (alquileres fase 3).
 *
 * Reglas que no se negocian:
 * - Solo se publica lo que la empresa marcó (`catalogAudience`) y solo si la tienda
 *   está encendida; si no, la empresa "no existe" (404). El catálogo de cliente final
 *   muestra RETAIL y BOTH con precio de lista; el mayorista (link privado por cliente)
 *   muestra WHOLESALE y BOTH con precio mayorista. Un producto WHOLESALE nunca sale
 *   en el catálogo público ni su precio mayorista en ningún DTO del público.
 * - Los DTO se arman campo por campo: nunca se serializa una fila de inventario
 *   (costos, mayorista, piso, notas internas y stock exacto no salen).
 * - Una preorden NO toca `EventInventory`: no compromete stock.
 */

export type PublicOrganization = { id: string; name: string; slug: string };
export type PublicCatalogContext = {
  organization: PublicOrganization;
  settings: RentalSettingsView;
  demo: boolean;
  /** Lista de precios del catálogo: cliente final (público) o mayorista (link privado). */
  priceList: PriceList;
  /** Solo en el catálogo mayorista: el link y el cliente al que pertenece. */
  access: ResolvedCatalogAccess | null;
  /** Solo en el enlace mágico del carrito de un visitante (`/tienda/<slug>/carrito/<token>`): su carrito guardado. */
  visitorCartId?: string | null;
};

/** Empresa con tienda encendida; `null` si no existe, está inactiva o la apagó. */
async function resolveStore(slug: string): Promise<Omit<PublicCatalogContext, "priceList" | "access"> | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized || normalized.length > 80) return null;
  const organization = await db.organization.findFirst({
    // Las sandboxes de la demo (`isDemo` con `demoParentId`) no tienen tienda pública por slug:
    // la vitrina (`demo`) sí, de solo lectura (docs/DEMO-INTERACTIVA.md §4).
    where: { slug: normalized, active: true, NOT: { isDemo: true, demoParentId: { not: null } } },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) return null;
  const settings = await getRentalSettings(organization.id);
  if (!settings.publicCatalogEnabled) return null;
  return { organization, settings, demo: isDemoOrganizationSlug(organization.slug) };
}

/** Catálogo público (cliente final); `null` si la empresa no existe o apagó la tienda. */
export async function resolvePublicCatalog(slug: string): Promise<PublicCatalogContext | null> {
  const store = await resolveStore(slug);
  return store ? { ...store, priceList: "RETAIL", access: null } : null;
}

/**
 * Catálogo mayorista por link privado: `null` si la tienda está apagada, el token no
 * existe, está revocado o es de otra empresa (todos son 404 para quien visita).
 */
export async function resolveWholesaleCatalog(slug: string, token: string): Promise<PublicCatalogContext | null> {
  const store = await resolveStore(slug);
  if (!store) return null;
  const access = await resolveCatalogAccess(slug, token);
  if (!access || access.organization.id !== store.organization.id || access.priceList !== "WHOLESALE") return null;
  return { ...store, priceList: "WHOLESALE", access };
}

/**
 * Catálogo de cliente final por link de acceso (`/tienda/<slug>/acceso/<token>`): el que recibe
 * quien pidió acceso en una tienda «Con solicitud» o «Privada». Precios de lista (cliente final).
 * Token inexistente, revocado, de otra empresa o de un link mayorista: `null` (404).
 */
export async function resolveAccessCatalog(slug: string, token: string): Promise<PublicCatalogContext | null> {
  const store = await resolveStore(slug);
  if (!store) return null;
  const access = await resolveCatalogAccess(slug, token);
  if (!access || access.organization.id !== store.organization.id || access.priceList !== "RETAIL") return null;
  return { ...store, priceList: "RETAIL", access };
}

/**
 * Enlace mágico del carrito de un visitante (`/tienda/<slug>/carrito/<token>`): abre la tienda pública
 * (cliente final) con su carrito guardado. Solo con la tienda abierta; token inexistente, vencido o de
 * otra empresa: `null` (404).
 */
export async function resolveVisitorCartCatalog(slug: string, token: string): Promise<PublicCatalogContext | null> {
  if (!isCatalogTokenShape(token)) return null;
  const store = await resolveStore(slug);
  if (!store || store.settings.catalogAccessMode !== "OPEN") return null;
  const cart = await db.storeCart.findFirst({
    where: { visitorTokenHash: catalogTokenHash(token), organizationId: store.organization.id, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return cart ? { ...store, priceList: "RETAIL", access: null, visitorCartId: cart.id } : null;
}

export type PublicStorefront = {
  name: string;
  slug: string;
  tagline: string | null;
  email: string | null;
  whatsappPhone: string | null;
  theme: StorefrontTheme;
  logos: { light: boolean; dark: boolean };
  /** Perfil de la empresa para el público; `null` si no cargó nada (no se dibuja el bloque). */
  profile: OrgProfile | null;
  /** Plantilla, tipografía y fondo (solo tokens; la vista previa del panel usa lo mismo). */
  appearance: AppearanceView;
  /** URLs de la portada por dispositivo; `null` si no subió esa portada. */
  covers: { desktop: string | null; mobile: string | null };
  accessMode: "OPEN" | "REQUEST" | "PRIVATE";
};

/** Identidad de la tienda para la portada: solo datos que la empresa cargó para el público. */
export async function loadStorefront(context: PublicCatalogContext): Promise<PublicStorefront> {
  const presentation = await loadOrgPresentation(context.organization.id);
  return {
    name: context.organization.name,
    slug: context.organization.slug,
    tagline: context.settings.storefrontTagline,
    email: context.settings.storefrontEmail,
    whatsappPhone: context.settings.whatsappPhone,
    theme: presentation.theme,
    logos: presentation.logos,
    profile: profileHasData(presentation.profile) ? presentation.profile : null,
    appearance: appearanceView(presentation.appearance, presentation.accent),
    covers: {
      desktop: coverUrl(context.organization.slug, "desktop", presentation.covers.desktop),
      mobile: coverUrl(context.organization.slug, "mobile", presentation.covers.mobile),
    },
    accessMode: context.settings.catalogAccessMode,
  };
}

/** Artículo tal como lo ve el público: sin costos, sin stock exacto, sin notas. */
export type PublicCatalogItem = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  imageUrl: string | null;
  /** Descripción pública del ítem; `null` si no la cargaron. Nunca son las notas internas. */
  description: string | null;
  /** Capacidad en personas y medidas que cargó la empresa; `null` si no los cargó. */
  capacity: number | null;
  dimensions: string | null;
  /** Precio por día de la lista del catálogo; `null` si la empresa no muestra precios. */
  price: CatalogPrice | null;
  /** Pista de disponibilidad para las fechas elegidas; `null` si no hay fechas. */
  availability: AvailabilityHint | null;
  /**
   * Solo en paquetes (combos): sus piezas con el precio de la lista del catálogo, para mostrar
   * «suma por unidad» y «ahorro» con la misma regla de días. `null` si no es un combo o no se muestran precios.
   */
  package: Array<{ name: string; quantity: number; price: CatalogPrice }> | null;
};

type CatalogRow = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  publicDescription: string | null;
  capacity: number | null;
  dimensions: string | null;
  imageUrl: string | null;
  imageMime: string | null;
  updatedAt: Date;
  quantity: number;
  status: InventoryStatus;
  billingUnit: BillingUnit;
  wholesalePrice: number;
  priceTiers: AudiencePriceTier[];
  bufferBeforeMin: number | null;
  bufferAfterMin: number | null;
  incidentHold: number;
  webSortOrder: number;
  categoryRef: { sortOrder: number } | null;
  _count: { units: number };
};

/** Lectura mínima (sin `imageData` ni ningún costo): solo lo que el DTO necesita. */
export async function loadVisibleRows(organizationId: string, list: PriceList, ids?: readonly string[]): Promise<CatalogRow[]> {
  const rows = await db.inventoryItem.findMany({
    where: { organizationId, ...catalogAudienceWhere(list), archivedAt: null, status: { not: "RETIRED" }, comboIncomplete: false, ...(ids ? { id: { in: [...ids] } } : {}) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      category: true,
      sku: true,
      publicDescription: true,
      capacity: true,
      dimensions: true,
      imageUrl: true,
      imageMime: true,
      updatedAt: true,
      quantity: true,
      status: true,
      billingUnit: true,
      listPrice: true,
      wholesalePrice: true,
      priceTiers: TIER_SELECT,
      bufferBeforeMin: true,
      bufferAfterMin: true,
      incidentHold: true,
      webSortOrder: true,
      categoryRef: { select: { sortOrder: true } },
      _count: { select: MAINTENANCE_UNITS_SELECT },
    },
  });
  // Orden que decide la empresa (Ajustes → Tienda): secciones por `InventoryCategory.sortOrder`,
  // productos por `webSortOrder`; sin orden cargado, alfabético (`lib/storefront-order.ts`).
  return sortStorefrontItems(rows.map((row) => ({ ...row, categorySort: row.categoryRef?.sortOrder ?? null }))).map(({ categorySort: _categorySort, ...row }) => row);
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
export async function hintsFor(organizationId: string, rows: readonly CatalogRow[], range: PublicRange): Promise<Map<string, AvailabilityHint>> {
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
  const rows = await loadVisibleRows(context.organization.id, context.priceList);
  const hints = range ? await hintsFor(context.organization.id, rows, range) : null;
  const packages = context.settings.publicShowPrices ? await loadPackages(context, rows.map((row) => row.id)) : new Map<string, NonNullable<PublicCatalogItem["package"]>>();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    sku: row.sku,
    imageUrl: inventoryImageUrl(row),
    description: row.publicDescription?.trim() || null,
    capacity: row.capacity,
    dimensions: row.dimensions?.trim() || null,
    price: context.settings.publicShowPrices ? catalogPriceFor(row, context.priceList) : null,
    availability: hints?.get(row.id) ?? null,
    package: packages.get(row.id) ?? null,
  }));
}

/** Zonas de flete para la tienda: solo las activas; sin montos si la tienda no muestra precios. */
export async function loadPublicZones(context: PublicCatalogContext) {
  const zones = await listPublicDeliveryZones(context.organization.id);
  return context.settings.publicShowPrices ? zones : zones.map(({ id, name }) => ({ id, name, basePrice: 0, volumeThreshold: null, extraPrice: null }));
}

/** Piezas de cada combo visible, con el precio de ESTA lista (cliente final o mayorista). */
async function loadPackages(context: PublicCatalogContext, comboIds: readonly string[]): Promise<Map<string, NonNullable<PublicCatalogItem["package"]>>> {
  const result = new Map<string, NonNullable<PublicCatalogItem["package"]>>();
  if (comboIds.length === 0) return result;
  const rows = await db.inventoryComponent.findMany({
    where: { organizationId: context.organization.id, parentId: { in: [...comboIds] } },
    orderBy: [{ parentId: "asc" }, { component: { name: "asc" } }],
    select: { parentId: true, quantity: true, component: { select: { name: true, billingUnit: true, listPrice: true, wholesalePrice: true, priceTiers: TIER_SELECT } } },
  });
  for (const row of rows) {
    const list = result.get(row.parentId) ?? [];
    list.push({ name: row.component.name, quantity: row.quantity, price: catalogPriceFor(row.component, context.priceList) });
    result.set(row.parentId, list);
  }
  return result;
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
  /** Zona de flete elegida (opcional) o «a coordinar»; con zona el pedido lleva el flete estimado. */
  deliveryZoneId: z.string().trim().min(1).max(64).optional().or(z.literal("")),
  // Estricto: `z.coerce.boolean()` convertía el texto "false" en true. Solo booleano o "true"/"false" explícitos.
  deliveryCoordinate: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
  /** «Pedir un mejor precio» al enviar el pedido: comentario y monto deseado opcional (nunca se aplica solo). */
  priceRequest: z.object({ comment: z.string().max(1200), desiredAmount: z.union([z.number(), z.string().max(20)]).nullable().optional() }).optional(),
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
    where: { organizationId, ...catalogAudienceWhere(context.priceList), archivedAt: null, status: { not: "RETIRED" }, id: { in: ids } },
    select: { id: true, name: true, sku: true, billingUnit: true, listPrice: true, wholesalePrice: true, priceTiers: TIER_SELECT },
  });
  if (rows.length !== ids.length) return { ok: false, status: 400, error: "Alguno de los artículos ya no está en el catálogo. Actualizá la página y revisá tu selección." };
  if ([...quantities.values()].some((quantity) => quantity > 99)) return { ok: false, status: 400, error: "La cantidad por artículo no puede superar 99." };

  const showPrices = context.settings.publicShowPrices;
  const wholesale = context.priceList === "WHOLESALE";
  const lines = rows.map((row) => {
    const pricing = showPrices ? listLine(row, context.priceList, range.days) : null;
    return {
      row,
      quantity: quantities.get(row.id) ?? 1,
      unitPrice: pricing && pricing.unitPrice > 0 ? pricing.unitPrice : null,
      // Evento o escalón «total»: el precio ya es el del período, no se multiplica por los días.
      fixedPeriod: pricing ? pricing.mode === "TOTAL" || pricing.mode === "EVENT" : row.billingUnit === "EVENT",
      days: pricing?.days ?? billedDays(row.billingUnit, range.days),
    };
  });
  const itemsSubtotal = showPrices ? estimatedSubtotal(lines.map((line) => ({ name: line.row.name, quantity: line.quantity, unitPrice: line.unitPrice, perEvent: line.fixedPeriod })), range.days) : null;
  const zone = await resolveDeliveryChoice(tx, organizationId, input);
  if (!zone.ok) return { ok: false, status: 400, error: zone.error };
  const quotedFee = showPrices && zone.zone ? deliveryFee(zone.zone, lines.reduce((sum, line) => sum + line.quantity, 0)) : null;
  const subtotal = itemsSubtotal !== null ? itemsSubtotal + (quotedFee ?? 0) : null;

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
        reason: wholesale ? "Pedido del catálogo mayorista" : "Pedido del catálogo público",
        eventDate: range.startsAt,
        location: input.location,
        message: input.notes || undefined,
        source: wholesale ? "catalogo-mayorista" : "catalogo",
        consentAt: new Date(consent.fecha),
        consentChannel: consent.canal,
        consentVersion: consent.version,
      },
      select: { id: true },
    });
    leadId = lead.id;
  }

  const priceRequest = input.priceRequest ? parsePriceRequest(input.priceRequest, { total: subtotal }) : null;
  if (priceRequest && !priceRequest.ok) return { ok: false, status: 400, error: priceRequest.error };

  const token = trackingToken();
  const respondBy = addBusinessHours(now, PREORDER_RESPONSE_HOURS);
  const quoteRequestId = randomUUID();
  await tx.quoteRequest.create({
    data: {
      id: quoteRequestId,
      organizationId,
      leadId,
      status: "NEW",
      source: "catalogo",
      priceList: context.priceList,
      deliveryZoneId: zone.zone?.id ?? null,
      deliveryZoneName: zone.zone?.name ?? null,
      deliveryCoordinate: zone.coordinate,
      // El pedido mayorista nace vinculado al cliente del link.
      clientId: context.access?.client.id,
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
          billingUnit: line.row.billingUnit === "EVENT" ? ("EVENT" as const) : ("DAILY" as const),
          unitPrice: line.unitPrice ?? undefined,
          subtotal: line.unitPrice ? line.unitPrice * line.quantity * line.days : undefined,
          notes: undefined,
        })),
      },
    },
  });

  if (priceRequest?.ok) await createPriceRequestInTx(tx, { organizationId, quoteRequestId, originalTotal: subtotal }, priceRequest.value);

  const trackingPath = `/pedido/${token}`;
  const message = preorderWhatsappMessage({
    organizationName: context.organization.name,
    lines: lines.map((line) => ({ name: line.row.name, quantity: line.quantity, unitPrice: line.unitPrice })),
    fromKey: range.fromKey,
    toKey: range.toKey,
    location: input.location,
    name: input.name,
    subtotal,
    delivery: zone.zone
      ? `Flete — ${zone.zone.name}${quotedFee !== null ? ` (estimado Gs. ${quotedFee.toLocaleString("es-PY")})` : ""}`
      : zone.coordinate ? "Flete: a coordinar" : null,
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
  /** Lista de precios del pedido: el seguimiento dice si fue un pedido mayorista. */
  priceList: "RETAIL" | "WHOLESALE";
  organization: {
    name: string;
    slug: string;
    whatsappPhone: string | null;
    theme: StorefrontTheme;
    appearance: AppearanceView;
    profile: OrgProfile | null;
  };
  /** Motivo del rechazo (de la empresa o del cliente); solo con el pedido declinado. */
  decline: { reason: string | null; by: "COMPANY" | "CLIENT" | null } | null;
  /** Propuesta de la empresa: su nota y si el cliente ya la aprobó. */
  proposal: { note: string | null; sentAt: string | null; approvedAt: string | null } | null;
  /** Pedidos de mejor precio del cliente y lo que respondió la empresa (más nuevo primero). */
  priceRequests: PriceRequestView[];
  /** ¿Todavía puede pedir un mejor precio? (pedido abierto, sin otro pedido de precio esperando y bajo el tope). */
  canRequestPrice: boolean;
  items: Array<{
    name: string;
    quantity: number;
    /** KEEP, CHANGED, REMOVED, UNAVAILABLE o SUBSTITUTED: qué hizo la empresa con la línea. */
    state: string;
    originalName: string | null;
    originalQuantity: number | null;
    subtotal: number | null;
  }>;
};

/** Pedido por su token; `null` si no existe. Solo campos aptos para quien lo hizo. */
export async function loadPublicOrder(token: string): Promise<PublicOrderView | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const quote = await db.quoteRequest.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      budget: { select: { id: true } },
      status: true,
      createdAt: true,
      respondBy: true,
      startsAt: true,
      endsAt: true,
      location: true,
      referenceTotal: true,
      priceList: true,
      organizationId: true,
      declineReason: true,
      declinedBy: true,
      proposedAt: true,
      proposalNote: true,
      proposalApprovedAt: true,
      items: { orderBy: { productName: "asc" }, select: { productName: true, quantity: true, state: true, originalName: true, originalQuantity: true, subtotal: true } },
    },
  });
  if (!quote?.organizationId) return null;
  const [organization, settings, presentation] = await Promise.all([
    db.organization.findUnique({ where: { id: quote.organizationId }, select: { name: true, slug: true } }),
    db.organizationRentalSettings.findUnique({ where: { organizationId: quote.organizationId }, select: { whatsappPhone: true, storefrontAccent: true } }),
    loadOrgPresentation(quote.organizationId),
  ]);
  if (!organization) return null;
  const priceRequests = await loadPriceRequests(quote.id, quote.organizationId);
  return {
    status: quote.status,
    createdAt: quote.createdAt.toISOString(),
    respondBy: quote.respondBy?.toISOString() ?? null,
    startsAt: quote.startsAt?.toISOString() ?? null,
    endsAt: quote.endsAt?.toISOString() ?? null,
    location: quote.location,
    subtotal: quote.referenceTotal,
    priceList: quote.priceList === "WHOLESALE" ? "WHOLESALE" : "RETAIL",
    organization: {
      name: organization.name,
      slug: organization.slug,
      whatsappPhone: settings?.whatsappPhone ?? null,
      theme: storefrontTheme(settings?.storefrontAccent),
      appearance: appearanceView(presentation.appearance, presentation.accent),
      profile: profileHasData(presentation.profile) ? presentation.profile : null,
    },
    decline: quote.status === "DECLINED" ? { reason: quote.declineReason, by: quote.declinedBy === "CLIENT" ? "CLIENT" : quote.declinedBy === "COMPANY" ? "COMPANY" : null } : null,
    proposal: quote.proposedAt ? { note: quote.proposalNote, sentAt: quote.proposedAt.toISOString(), approvedAt: quote.proposalApprovedAt?.toISOString() ?? null } : null,
    priceRequests,
    canRequestPrice:
      (PRICE_REQUEST_ORDER_STATUSES as readonly string[]).includes(quote.status) &&
      !quote.budget &&
      !priceRequests.some((entry) => entry.status === "OPEN") &&
      priceRequests.length < PRICE_REQUESTS_PER_ORDER,
    items: quote.items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      state: item.state,
      originalName: item.originalName,
      originalQuantity: item.originalQuantity,
      subtotal: item.subtotal,
    })),
  };
}

/** Tope diario de preórdenes del catálogo por empresa (además del rate-limit por IP). */
export const PREORDER_DAILY_LIMIT = 200;

/**
 * ¿La empresa ya recibió el tope de preórdenes hoy (día de Asunción)? El tope es por lista
 * de precios: una ráfaga en el catálogo público no bloquea a los mayoristas ni al revés.
 * Cuenta los pedidos reales del catálogo guardados; `retryAfter` son los segundos hasta el próximo día.
 * Es un tope blando: dos pedidos simultáneos justo en el límite pueden pasarlo por poco.
 */
export async function preorderDailyLimit(
  organizationId: string,
  options: { now?: Date; limit?: number; client?: Pick<typeof db, "quoteRequest">; priceList?: PriceList } = {},
): Promise<{ reached: boolean; used: number; limit: number; retryAfter: number }> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? PREORDER_DAILY_LIMIT;
  const today = dayKeyOf(now);
  const used = await (options.client ?? db).quoteRequest.count({
    where: { organizationId, source: "catalogo", priceList: options.priceList ?? "RETAIL", createdAt: { gte: dayStart(today) } },
  });
  const retryAfter = Math.max(60, Math.ceil((dayStart(nextDayKey(today)).getTime() - now.getTime()) / 1000));
  return { reached: used >= limit, used, limit, retryAfter };
}

/** Categoría tal como la ve el público: nombre igual al texto de `PublicCatalogItem.category`, foto propia y orden. */
export type PublicCatalogCategory = { id: string; name: string; parentName: string | null; imageUrl: string | null; sortOrder: number };

/**
 * Categorías de la empresa con su foto propia (`InventoryCategory.imageUrl`), para que la tienda las
 * muestre y, si una no tiene, use la foto de su primer producto. Sin archivadas; sin binarios.
 */
export async function loadPublicCategories(organizationId: string): Promise<PublicCatalogCategory[]> {
  const rows = await db.inventoryCategory.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, imageUrl: true, sortOrder: true, parent: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.parent ? `${row.parent.name} › ${row.name}` : row.name,
    parentName: row.parent?.name ?? null,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
  }));
}

/** Fotos de categoría por nombre público, listas para `StoreFront.categoryImages` (solo las que tienen foto). */
export async function loadCategoryImages(organizationId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const category of await loadPublicCategories(organizationId)) if (category.imageUrl) out[category.name] = category.imageUrl;
  return out;
}
