import type { AdminClientRucSnapshot } from "@/lib/admin-types";

export type OwnDataResult = {
  name: string;
  /** Vista opcional solicitada explícitamente para personas confirmadas. */
  namePresentationFull?: string;
  fullRuc: string;
  reviewRequired: true;
  ownData: Omit<AdminClientRucSnapshot, "fullRuc" | "lookedUpAt" | "confirmedAt"> & {
    ruc: string;
    dv: string | number;
    requestId?: string;
    quota: { limit: number; used: number; remaining: number; day: string; resetAfter: number };
  };
};
type ProviderFactory = (options: { lookup: (ruc: string) => Promise<unknown> }) => (ruc: string) => Promise<OwnDataResult>;
type ResponseMapper = (envelope: unknown, ruc: string) => OwnDataResult;

const SAFE_ERROR_CODES = new Set([
  "INVALID_RUC_FORMAT", "API_KEY_REQUIRED", "API_KEY_INVALID", "API_KEY_REVOKED", "API_KEY_EXPIRED",
  "API_KEY_ENVIRONMENT_MISMATCH", "ENVIRONMENT_MISMATCH", "INSUFFICIENT_SCOPE", "PLAN_REQUIRED",
  "REGISTERED_RUC_NOT_FOUND", "DAILY_QUOTA_REACHED", "COMMERCIAL_API_DISABLED", "COMMERCIAL_API_UNAVAILABLE",
  "DNIT_DATA_UNAVAILABLE", "FREE_API_DISABLED",
]);

export class OwnDataLookupError extends Error {
  constructor(public code: string, public status: number, message: string, public retryAfter?: number) { super(message); }
}

type Envelope = { data?: Record<string, unknown>; meta?: Record<string, unknown>; namePresentation?: { values?: { full?: unknown } }; error?: { code?: unknown; retryAfter?: unknown }; requestId?: unknown; retryAfter?: unknown };

function safeRequestId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

function invalidResponse(): never {
  throw new OwnDataLookupError("OWNDATA_INVALID_RESPONSE", 502, "OwnData devolvió una respuesta incompleta. Completá los datos a mano.");
}

export function mapOwnDataRucResponse(envelope: unknown, requested: string): OwnDataResult {
  if (!ownDataRucValid(requested)) throw new OwnDataLookupError("INVALID_RUC_FORMAT", 400, "Ingresá un RUC de 1 a 9 dígitos, sin cero inicial y con DV opcional explícito.");
  const value = (envelope && typeof envelope === "object" ? envelope : {}) as Envelope;
  if (value.error && typeof value.error === "object") {
    const candidate = value.error.code;
    const code = typeof candidate === "string" && SAFE_ERROR_CODES.has(candidate) ? candidate : "OWNDATA_INVALID_RESPONSE";
    const status = code === "REGISTERED_RUC_NOT_FOUND" ? 404 : code === "DAILY_QUOTA_REACHED" ? 429 : ["API_KEY_INVALID", "API_KEY_REVOKED", "API_KEY_EXPIRED", "API_KEY_REQUIRED", "API_KEY_ENVIRONMENT_MISMATCH", "ENVIRONMENT_MISMATCH"].includes(code) ? 401 : ["PLAN_REQUIRED", "INSUFFICIENT_SCOPE"].includes(code) ? 403 : ["INVALID_RUC_FORMAT", "INVALID_RUC_DV", "INVALID_NAME_OPTIONS"].includes(code) ? 400 : 503;
    const messages: Record<string, string> = {
      COMMERCIAL_API_DISABLED: "OwnData todavía no habilitó la API comercial. Completá los datos a mano.",
      API_KEY_INVALID: "Revisá la configuración de OwnData en el servidor. Completá los datos a mano.",
      API_KEY_REVOKED: "La clave de OwnData fue revocada. Actualizá la configuración del servidor.",
      API_KEY_EXPIRED: "La clave de OwnData venció. Actualizá la configuración del servidor.",
      DAILY_QUOTA_REACHED: "Se alcanzó la cuota OwnData. Completá los datos a mano; no se reintentó la consulta.",
      REGISTERED_RUC_NOT_FOUND: "No encontramos este RUC. Completá los datos a mano.",
    };
    const retryAfter = value.error.retryAfter ?? value.retryAfter;
    throw new OwnDataLookupError(code, status, messages[code] ?? "OwnData no está disponible para esta consulta. Completá los datos a mano.", code === "DAILY_QUOTA_REACHED" && Number.isSafeInteger(retryAfter) && Number(retryAfter) >= 0 ? Number(retryAfter) : undefined);
  }
  const data = value.data;
  const meta = value.meta;
  const provenance = meta?.provenance as Record<string, unknown> | undefined;
  const quota = meta?.quota as Record<string, unknown> | undefined;
  const base = typeof data?.ruc === "number" && Number.isSafeInteger(data.ruc) ? String(data.ruc) : data?.ruc;
  const dv = typeof data?.dv === "number" && Number.isInteger(data.dv) ? String(data.dv) : data?.dv;
  const fullRuc = data?.fullRuc;
  const requestedMatches = typeof base === "string" && (requested.includes("-") ? requested === fullRuc : requested === base);
  const sourcePage = provenance?.sourcePage;
  const sourcePageValid = typeof sourcePage === "string" && (sourcePage.startsWith("https://") || (meta?.environment === "test" && sourcePage.startsWith("urn:")));
  const quotaValid = quota && ["limit", "used", "remaining", "resetAfter"].every(key => Number.isSafeInteger(quota[key]) && Number(quota[key]) >= 0) && Number(quota.used) <= Number(quota.limit) && Number(quota.remaining) <= Number(quota.limit) && typeof quota.day === "string" && quota.day.length > 0;
  const valid = typeof base === "string" && /^[1-9][0-9]{0,8}$/.test(base) && typeof dv === "string" && /^[0-9]$/.test(dv) && typeof fullRuc === "string" && fullRuc === `${base}-${dv}` && requestedMatches && typeof data?.nameOfficial === "string" && data.nameOfficial.trim().length > 0 && (!Object.hasOwn(data, "equivalenceRaw") || data.equivalenceRaw === null || typeof data.equivalenceRaw === "string") && (!Object.hasOwn(data, "sourcePartition") || (Number.isSafeInteger(data.sourcePartition) && Number(data.sourcePartition) >= 0 && Number(data.sourcePartition) <= 9)) && (meta?.environment === "test" || meta?.environment === "live") && provenance?.source === "dnit_official_snapshot" && sourcePageValid && typeof provenance.publicationDate === "string" && typeof provenance.importedAt === "string" && typeof provenance.publishedText === "string" && typeof provenance.snapshotHash === "string" && /^[a-f0-9]{64}$/i.test(provenance.snapshotHash) && quotaValid;
  if (!valid) invalidResponse();
  const ownData = {
    ruc: base!, dv: data!.dv as string | number, nameOfficial: data!.nameOfficial as string, equivalenceRaw: (data!.equivalenceRaw ?? null) as string | null,
    ...(Object.hasOwn(data!, "sourcePartition") ? { sourcePartition: data!.sourcePartition as number } : {}),
    requestId: safeRequestId(value.requestId), environment: meta!.environment as "test" | "live",
    quota: { limit: quota!.limit as number, used: quota!.used as number, remaining: quota!.remaining as number, day: quota!.day as string, resetAfter: quota!.resetAfter as number },
    provenance: { source: "dnit_official_snapshot" as const, sourcePage: sourcePage as string, publicationDate: provenance!.publicationDate as string, publishedText: provenance!.publishedText as string, importedAt: provenance!.importedAt as string, snapshotHash: provenance!.snapshotHash as string },
  } as OwnDataResult["ownData"];
  // Keep the legacy status internally for signed snapshots, but make it non-enumerable so it cannot reach JSON/frontend.
  Object.defineProperty(ownData, "stateRaw", { value: typeof data!.stateRaw === "string" ? data!.stateRaw : null, enumerable: false });
  const presented = value.namePresentation?.values?.full;
  return { name: data!.nameOfficial as string, ...(typeof presented === "string" && presented.trim() ? { namePresentationFull: presented.trim() } : {}), fullRuc: fullRuc as string, reviewRequired: true, ownData };
}

function createOwnDataRucProvider({ lookup }: { lookup: (ruc: string) => Promise<unknown> }) {
  return async (ruc: string) => mapOwnDataRucResponse(await lookup(ruc), ruc);
}

/** Adaptador local: el contrato público no depende de status/stateRaw del proveedor. */
export function ownDataAdapters() {
  return { create: createOwnDataRucProvider as ProviderFactory, map: mapOwnDataRucResponse as ResponseMapper };
}

export function ownDataConfig(env: Record<string, string | undefined> = process.env) {
  const base = env.OWNDATA_API_ORIGIN ?? env.OWNDATA_API_URL;
  const key = env.OWNDATA_API_KEY;
  const environment = env.OWNDATA_ENVIRONMENT;
  if (!base || !key || !["test", "live"].includes(environment ?? "")) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash || /[\r\n]/.test(key)) return null;
    return { base: url.href.replace(/\/$/, ""), key, environment: environment as "test" | "live" };
  } catch { return null; }
}

export function ownDataRucValid(ruc: unknown): ruc is string {
  return typeof ruc === "string" && /^[1-9][0-9]{0,8}(?:-[0-9])?$/.test(ruc);
}

/** Un único intento, sin redirect, retry, fallback SUN ni mensajes upstream. */
export async function lookupOwnData(ruc: string, options: {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  adapters?: ReturnType<typeof ownDataAdapters> | null;
  subjectKind?: "individual" | "legal_entity" | "unknown";
} = {}): Promise<OwnDataResult> {
  if (!ownDataRucValid(ruc)) throw new OwnDataLookupError("INVALID_RUC_FORMAT", 400, "Ingresá un RUC de 1 a 9 dígitos, sin cero inicial y con DV opcional explícito.");
  const config = ownDataConfig(options.env);
  if (!config) throw new OwnDataLookupError("OWNDATA_NOT_CONFIGURED", 503, "OwnData no está configurado. Completá los datos a mano.");
  const adapters = options.adapters === undefined ? ownDataAdapters() : options.adapters;
  if (!adapters) throw new OwnDataLookupError("OWNDATA_ADAPTER_UNAVAILABLE", 503, "La integración OwnData no está disponible. Completá los datos a mano.");
  const provider = createOwnDataRucProvider({ lookup: async (requested) => {
    const endpoint = new URL(`${config.base}/api/v1/ruc/${encodeURIComponent(requested)}`);
    if (options.subjectKind === "individual") {
      endpoint.searchParams.set("nameMethods", "full");
      endpoint.searchParams.set("subjectKind", "individual");
    } else if (options.subjectKind === "legal_entity") {
      endpoint.searchParams.set("nameMethods", "full");
      endpoint.searchParams.set("subjectKind", "legal_entity");
    }
    const response = await (options.fetch ?? fetch)(endpoint.href, {
      headers: { "X-API-Key": config.key, Accept: "application/json" },
      signal: AbortSignal.timeout(6000), cache: "no-store", redirect: "error",
    });
    // Limita el cuerpo antes de parsear y jamás expone texto/headers del proveedor.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error("Oversized response"); }
      chunks.push(chunk.value);
    }
    const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!response.ok && !envelope?.error) throw new Error("Unexpected HTTP status");
    if (envelope?.meta?.environment && envelope.meta.environment !== config.environment) {
      throw new OwnDataLookupError("API_KEY_ENVIRONMENT_MISMATCH", 503, "OwnData respondió desde otro ambiente. Completá los datos a mano.");
    }
    return envelope;
  } });
  try {
    const result = await provider(ruc);
    if (result.ownData.environment !== config.environment) throw new OwnDataLookupError("API_KEY_ENVIRONMENT_MISMATCH", 503, "OwnData respondió desde otro ambiente. Completá los datos a mano.");
    return result;
  } catch (error) {
    if (error instanceof OwnDataLookupError) throw error;
    // Mensajes del mapper son propios del kit; el cliente nunca recibe el Error original.
    const e = error as { code?: string; status?: number; retryAfter?: number };
    const code = typeof e?.code === "string" && /^[A-Z_]{1,80}$/.test(e.code) ? e.code : "OWNDATA_TRANSPORT_ERROR";
    const status = e?.status === 404 ? 404 : e?.status === 429 ? 429 : e?.status === 400 ? 400 : e?.status === 401 ? 401 : e?.status === 403 ? 403 : e?.status === 503 ? 503 : 502;
    const providerMessages: Record<string, string> = {
      COMMERCIAL_API_DISABLED: "OwnData todavía no habilitó la API comercial. Completá los datos a mano.",
      FREE_API_DISABLED: "La API gratuita de OwnData está deshabilitada. Completá los datos a mano.",
      API_KEY_INVALID: "Revisá la configuración de OwnData en el servidor. Completá los datos a mano.",
      API_KEY_REVOKED: "La clave de OwnData fue revocada. Actualizá la configuración del servidor.",
      API_KEY_EXPIRED: "La clave de OwnData venció. Actualizá la configuración del servidor.",
      PLAN_REQUIRED: "La cuenta de OwnData necesita un cupo activo. Completá los datos a mano.",
    };
    const message = providerMessages[code] ?? (status === 404 ? "No encontramos este RUC. Completá los datos a mano." : status === 429 ? "Se alcanzó la cuota OwnData. Completá los datos a mano; no se reintentó la consulta." : "OwnData no está disponible para esta consulta. Completá los datos a mano.");
    throw new OwnDataLookupError(code, status, message, code === "DAILY_QUOTA_REACHED" && Number.isSafeInteger(e.retryAfter) && e.retryAfter! >= 0 ? e.retryAfter : undefined);
  }
}
