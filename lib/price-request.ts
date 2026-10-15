/**
 * «Pedir un mejor precio»: el cliente le pide a la empresa un mejor precio dentro de su pedido del
 * catálogo. Reglas puras (validación y textos), sin base ni red.
 *
 * El monto deseado es solo informativo y NUNCA se aplica solo: la empresa acepta, contraoferta o
 * rechaza; si acepta o contraoferta, el pedido pasa a «Propuesta enviada» y el cliente aprueba la
 * versión final desde su seguimiento.
 */

export const PRICE_REQUEST_STATUSES = ["OPEN", "ACCEPTED", "COUNTERED", "REJECTED"] as const;
export type PriceRequestStatus = (typeof PRICE_REQUEST_STATUSES)[number];

export const PRICE_REQUEST_LABEL: Record<PriceRequestStatus, string> = {
  OPEN: "Esperando respuesta",
  ACCEPTED: "Aceptado",
  COUNTERED: "Contraoferta",
  REJECTED: "No pudimos mejorar el precio",
};

export const isPriceRequestStatus = (value: unknown): value is PriceRequestStatus =>
  typeof value === "string" && (PRICE_REQUEST_STATUSES as readonly string[]).includes(value);

export const PRICE_COMMENT_MIN = 3;
export const PRICE_COMMENT_MAX = 500;
export const PRICE_NOTE_MAX = 500;
/** Tope de pedidos de precio por pedido del catálogo: evita insistir sin fin. */
export const PRICE_REQUESTS_PER_ORDER = 3;
/** Tope razonable del monto (PYG): frena números absurdos sin limitar ningún pedido real. */
export const PRICE_AMOUNT_MAX = 2_000_000_000;

/** Estados del pedido en los que el cliente todavía puede pedir un mejor precio. */
export const PRICE_REQUEST_ORDER_STATUSES = ["NEW", "REVIEWING", "QUOTED", "PROPOSED"] as const;

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max + 1) : "";

/** Monto entero en guaraníes: acepta número o texto con puntos/espacios («1.250.000»). */
export function parsePriceAmount(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" && /^[\d.\s]+$/.test(value.trim()) ? Number(value.replace(/[.\s]/g, "")) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > PRICE_AMOUNT_MAX) return "invalid";
  return n;
}

export type PriceRequestInput = { comment: string; desiredAmount: number | null };

/** Valida el pedido del cliente. Con `total` conocido, el monto deseado tiene que ser menor. */
export function parsePriceRequest(body: unknown, options: { total?: number | null } = {}): { ok: true; value: PriceRequestInput } | { ok: false; error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const comment = clean(record.comment, PRICE_COMMENT_MAX);
  if (comment.length < PRICE_COMMENT_MIN) return { ok: false, error: "Contanos por qué pedís un mejor precio (al menos 3 caracteres)." };
  if (comment.length > PRICE_COMMENT_MAX) return { ok: false, error: `El comentario no puede superar los ${PRICE_COMMENT_MAX} caracteres.` };
  const amount = parsePriceAmount(record.desiredAmount);
  if (amount === "invalid") return { ok: false, error: "El monto que querés pagar tiene que ser un número entero en guaraníes, mayor a cero." };
  if (amount !== null && options.total && options.total > 0 && amount >= options.total) {
    return { ok: false, error: "El monto que querés pagar tiene que ser menor al total del pedido." };
  }
  return { ok: true, value: { comment, desiredAmount: amount } };
}

export const PRICE_RESPONSE_ACTIONS = ["accept", "counter", "reject"] as const;
export type PriceResponseAction = (typeof PRICE_RESPONSE_ACTIONS)[number];
export type PriceResponseInput = { action: PriceResponseAction; offeredAmount: number | null; note: string | null };

/**
 * Valida la respuesta de la empresa. «Aceptar» toma el monto deseado por el cliente (tiene que
 * existir); «Contraofertar» exige un monto propio; «Rechazar» exige un motivo para el cliente.
 */
export function parsePriceResponse(body: unknown, request: { desiredAmount: number | null; originalTotal: number | null }): { ok: true; value: PriceResponseInput } | { ok: false; error: string } {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const action = record.action;
  if (typeof action !== "string" || !(PRICE_RESPONSE_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: "Elegí aceptar, contraofertar o rechazar." };
  const note = clean(record.note, PRICE_NOTE_MAX);
  if (note.length > PRICE_NOTE_MAX) return { ok: false, error: `La nota no puede superar los ${PRICE_NOTE_MAX} caracteres.` };
  if (action === "reject") {
    if (note.length < PRICE_COMMENT_MIN) return { ok: false, error: "Contale al cliente el motivo (al menos 3 caracteres): lo va a ver en su pedido." };
    return { ok: true, value: { action, offeredAmount: null, note } };
  }
  let offered: number | null;
  if (action === "accept") {
    if (!request.desiredAmount) return { ok: false, error: "El cliente no indicó un monto: contraofertá con tu propio precio." };
    offered = request.desiredAmount;
  } else {
    const parsed = parsePriceAmount(record.offeredAmount);
    if (parsed === null || parsed === "invalid") return { ok: false, error: "Indicá el monto de tu contraoferta: un entero en guaraníes, mayor a cero." };
    offered = parsed;
  }
  if (request.originalTotal && request.originalTotal > 0 && offered > request.originalTotal) {
    return { ok: false, error: "La oferta no puede superar el total actual del pedido." };
  }
  return { ok: true, value: { action: action as PriceResponseAction, offeredAmount: offered, note: note || null } };
}
