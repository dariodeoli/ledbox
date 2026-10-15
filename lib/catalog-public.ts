import { whatsappHref } from "./admin-format";
import type { PriceList } from "./catalog-audience";
import { isEventBilled, quoteProductPrice } from "./quote-sharing";

/**
 * Catálogo público por empresa y preórdenes (alquileres fase 3). Reglas puras,
 * sin base ni red: las comparten el servidor, la página pública y el panel.
 *
 * Una preorden NO es una reserva: no compromete stock. Su estado vive en
 * `QuoteRequest.status` (texto validado acá, no un enum de base).
 */

export const QUOTE_REQUEST_STATUSES = ["NEW", "REVIEWING", "QUOTED", "CONVERTED", "DECLINED", "EXPIRED"] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

export function isQuoteRequestStatus(value: unknown): value is QuoteRequestStatus {
  return typeof value === "string" && (QUOTE_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** Estados desde los que un pedido todavía se puede convertir en presupuesto. */
export const CONVERTIBLE_STATUSES: readonly QuoteRequestStatus[] = ["NEW", "REVIEWING", "QUOTED"];

/** Etiqueta para el equipo (panel de Leads). */
export const QUOTE_REQUEST_STATUS_LABEL: Record<QuoteRequestStatus, string> = {
  NEW: "Nuevo",
  REVIEWING: "En revisión",
  QUOTED: "Cotizado",
  CONVERTED: "Convertido en presupuesto",
  DECLINED: "Declinado",
  EXPIRED: "Vencido",
};

/** Copia honesta para quien hizo el pedido (seguimiento público). */
export const QUOTE_REQUEST_PUBLIC_COPY: Record<QuoteRequestStatus, { label: string; detail: string }> = {
  NEW: { label: "Recibido", detail: "Recibimos tu pedido. Todavía no es una reserva confirmada." },
  REVIEWING: { label: "En revisión", detail: "Estamos revisando tu pedido y la disponibilidad. Todavía no es una reserva confirmada." },
  QUOTED: { label: "Cotización enviada", detail: "Te enviamos una cotización. Todavía no es una reserva confirmada." },
  CONVERTED: { label: "Presupuesto en preparación", detail: "Armamos un presupuesto a partir de tu pedido. La reserva se confirma cuando lo aprobás." },
  DECLINED: { label: "No pudimos atenderlo", detail: "No pudimos atender este pedido. Escribinos y buscamos una alternativa." },
  EXPIRED: { label: "Vencido", detail: "Este pedido venció sin respuesta. Escribinos para retomarlo." },
};

export const quoteRequestStatusLabel = (value: string | null | undefined) =>
  isQuoteRequestStatus(value) ? QUOTE_REQUEST_STATUS_LABEL[value] : "Nuevo";

// ── Disponibilidad indicativa ────────────────────────────────────────────────

export type AvailabilityHint = "AVAILABLE" | "LOW" | "CONSULT";

/** El público nunca ve el número exacto: solo uno de estos tres textos. */
export const AVAILABILITY_HINT_LABEL: Record<AvailabilityHint, string> = {
  AVAILABLE: "Disponible",
  LOW: "Pocas unidades",
  CONSULT: "Consultar",
};

/**
 * Del número real a la pista pública. Sin unidades libres (o bloqueado) o si se
 * pide más de lo libre: «Consultar». Con pocas libres (hasta 2 o hasta el 25 %
 * del stock): «Pocas unidades». Si no: «Disponible».
 */
export function availabilityHint(input: { available: number; total: number; blocked: boolean; requested?: number }): AvailabilityHint {
  const { available, total, blocked } = input;
  const requested = Math.max(1, input.requested ?? 1);
  if (blocked || total <= 0 || available <= 0 || requested > available) return "CONSULT";
  if (available <= 2 || available <= Math.ceil(total * 0.25)) return "LOW";
  return "AVAILABLE";
}

// ── Plazos y días ────────────────────────────────────────────────────────────

/** Horas hábiles que se prometen para responder una preorden. */
export const PREORDER_RESPONSE_HOURS = 24;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Asuncion", weekday: "short" });

/**
 * Suma `hours` horas que cuentan solo de lunes a viernes (zona America/Asuncion):
 * las horas de sábado y domingo no corren. Un pedido del viernes a la tarde
 * vence el lunes. Pasos de una hora; determinista.
 */
export function addBusinessHours(from: Date, hours: number): Date {
  let cursor = from.getTime();
  let remaining = Math.max(0, Math.floor(hours));
  while (remaining > 0) {
    cursor += 3_600_000;
    const weekday = WEEKDAY_FORMAT.format(new Date(cursor - 1));
    if (weekday !== "Sat" && weekday !== "Sun") remaining -= 1;
  }
  return new Date(cursor);
}

/** Días de alquiler entre dos días `YYYY-MM-DD`, ambos inclusive (mínimo 1). */
export function rentalDaysBetween(fromKey: string, toKey: string): number {
  const parse = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const diff = Math.round((parse(toKey) - parse(fromKey)) / 86_400_000);
  return Number.isFinite(diff) ? Math.max(1, diff + 1) : 1;
}

/** Tope del período de un pedido, en días. */
export const MAX_PREORDER_DAYS = 90;

// ── Precio de referencia ─────────────────────────────────────────────────────

/** Campos de precio de venta de cliente final; nunca costos ni mayorista. */
export type CatalogPriceFields = { listPrice: number; listFromDays: number; listFromPrice: number; billingUnit?: string | null };

/**
 * Precio que ve el público, neutro respecto de la lista: en el catálogo de cliente
 * final sale de los campos de lista y en el mayorista de los campos mayoristas, pero
 * el DTO nunca dice de cuál (ni expone el otro).
 */
export type CatalogPrice = { unit: number; fromDays: number; fromPrice: number; /** «Se cobra por evento»: el precio no se multiplica por los días. */ perEvent?: boolean };

type TieredFields = {
  billingUnit: string | null;
  listPrice: number; listFromDays: number; listFromPrice: number;
  wholesalePrice: number; wholesaleFromDays: number; wholesaleFromPrice: number;
};

/** Precio de la lista elegida a partir de una fila de inventario. */
export function catalogPriceFor(row: Partial<TieredFields>, list: PriceList): CatalogPrice {
  const base = list === "WHOLESALE"
    ? { unit: row.wholesalePrice ?? 0, fromDays: row.wholesaleFromDays ?? 0, fromPrice: row.wholesaleFromPrice ?? 0 }
    : { unit: row.listPrice ?? 0, fromDays: row.listFromDays ?? 0, fromPrice: row.listFromPrice ?? 0 };
  return isEventBilled(row.billingUnit) ? { ...base, perEvent: true } : base;
}

/** Precio por día de un `CatalogPrice` para `days` días; 0 = sin precio cargado («Consultar»). */
export function catalogDailyPrice(price: CatalogPrice, days: number): number {
  return quoteProductPrice({ listPrice: price.unit, listFromDays: price.fromDays, listFromPrice: price.fromPrice, billingUnit: price.perEvent ? "EVENT" : null }, Math.max(1, days), "FINAL");
}

/** Precio por día de la lista elegida directo desde una fila de inventario. */
export function listDailyPrice(row: Partial<TieredFields>, list: PriceList, days: number): number {
  return catalogDailyPrice(catalogPriceFor(row, list), days);
}

/** Precio por día de referencia para `days` días; 0 = sin precio cargado («Consultar»). */
export function referenceDailyPrice(item: CatalogPriceFields, days: number): number {
  return quoteProductPrice(item, Math.max(1, days), "FINAL");
}

export type PreorderLine = { name: string; quantity: number; unitPrice: number | null; /** Se cobra por evento: no se multiplica por los días. */ perEvent?: boolean };

/** Subtotal estimado; `null` si algún artículo no tiene precio (no se inventa). */
export function estimatedSubtotal(lines: ReadonlyArray<PreorderLine>, days: number): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const line of lines) {
    if (!line.unitPrice || line.unitPrice <= 0) return null;
    total += line.unitPrice * line.quantity * (line.perEvent ? 1 : Math.max(1, days));
  }
  return total;
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const dayLabel = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });

export const formatDayKey = (key: string): string => {
  const [year, month, day] = key.split("-").map(Number);
  return dayLabel.format(new Date(Date.UTC(year, month - 1, day)));
};

/** Resumen del pedido para el mensaje precargado (sin datos internos). */
export function preorderWhatsappMessage(input: {
  organizationName: string;
  lines: ReadonlyArray<PreorderLine>;
  fromKey: string;
  toKey: string;
  location: string;
  name: string;
  subtotal: number | null;
  trackingUrl?: string | null;
}): string {
  const parts = [
    `Hola ${input.organizationName}! Soy ${input.name}. Hice un pedido de alquiler desde su catálogo (todavía sin confirmar).`,
    `Fechas: ${formatDayKey(input.fromKey)} al ${formatDayKey(input.toKey)}`,
    `Lugar: ${input.location}`,
    ...input.lines.map((line) => `- ${line.quantity} × ${line.name}`),
    input.subtotal !== null ? `Subtotal estimado: Gs. ${gs.format(input.subtotal)}` : "Subtotal: a cotizar",
    input.trackingUrl ? `Seguimiento: ${input.trackingUrl}` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Link de WhatsApp precargado; `null` si la empresa no cargó un número válido. */
export function preorderWhatsappUrl(phone: string | null | undefined, message: string): string | null {
  return whatsappHref(phone, message);
}
