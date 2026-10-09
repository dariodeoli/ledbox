import * as ownCodingUtils from "owncoding-ui/utils";
import type { AdminClientRucSnapshot } from "@/lib/admin-types";

export type OwnDataResult = {
  name: string;
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

export class OwnDataLookupError extends Error {
  constructor(public code: string, public status: number, message: string, public retryAfter?: number) { super(message); }
}

/** Acceso por export: v0.55 no lo tiene; falla cerrado hasta actualizar el kit. */
export function ownDataAdapters() {
  const create = Reflect.get(ownCodingUtils, "createOwnDataRucProvider") as ProviderFactory | undefined;
  const map = Reflect.get(ownCodingUtils, "mapOwnDataRucResponse") as ResponseMapper | undefined;
  return typeof create === "function" && typeof map === "function" ? { create, map } : null;
}

export function ownDataConfig(env: Record<string, string | undefined> = process.env) {
  const base = env.OWNDATA_API_URL;
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
  adapters?: ReturnType<typeof ownDataAdapters>;
} = {}): Promise<OwnDataResult> {
  if (!ownDataRucValid(ruc)) throw new OwnDataLookupError("INVALID_RUC_FORMAT", 400, "Ingresá un RUC de 1 a 9 dígitos, sin cero inicial y con DV opcional explícito.");
  const config = ownDataConfig(options.env);
  if (!config) throw new OwnDataLookupError("OWNDATA_NOT_CONFIGURED", 503, "OwnData no está configurado. Completá los datos a mano.");
  const adapters = options.adapters === undefined ? ownDataAdapters() : options.adapters;
  if (!adapters) throw new OwnDataLookupError("OWNDATA_ADAPTER_UNAVAILABLE", 503, "La integración OwnData no está disponible. Completá los datos a mano.");
  const provider = adapters.create({ lookup: async (requested) => {
    const response = await (options.fetch ?? fetch)(`${config.base}/api/v1/ruc/${encodeURIComponent(requested)}`, {
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
    const status = e?.status === 404 ? 404 : e?.status === 429 ? 429 : e?.status === 400 ? 400 : e?.status === 503 || e?.status === 401 || e?.status === 403 ? 503 : 502;
    const message = status === 404 ? "No encontramos este RUC. Completá los datos a mano." : status === 429 ? "Se alcanzó la cuota OwnData. Completá los datos a mano; no se reintentó la consulta." : "OwnData no está disponible para esta consulta. Completá los datos a mano.";
    throw new OwnDataLookupError(code, status, message, code === "DAILY_QUOTA_REACHED" && Number.isSafeInteger(e.retryAfter) && e.retryAfter! >= 0 ? e.retryAfter : undefined);
  }
}
