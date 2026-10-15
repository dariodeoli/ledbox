/**
 * IP de confianza del visitante. Un solo lugar para web-metrics y los topes de la demo.
 *
 * `TRUSTED_PROXY_HOPS` es la cantidad de proxies propios delante de la app que agregan su valor a
 * `X-Forwarded-For`. Hoy es 1 (Traefik/Coolify). La IP es el N-ésimo valor contado desde el FINAL: los
 * primeros los escribe el cliente y se pueden falsear. Si se agrega otro proxy (por ejemplo Cloudflare
 * delante de Traefik), subir la constante a 2; ver docs/DEMO-INTERACTIVA.md §10.
 */
export const TRUSTED_PROXY_HOPS = 1;

export function trustedIp(request: Request): string {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",").map((v) => v.trim()).filter(Boolean);
  return (forwarded.length >= TRUSTED_PROXY_HOPS ? forwarded.at(-TRUSTED_PROXY_HOPS) : forwarded[0]) || request.headers.get("x-real-ip")?.trim() || "unknown";
}
