/**
 * Origen público de la request (host real detrás del proxy).
 *
 * - Con `x-forwarded-proto` (producción, Coolify) se respeta tal cual.
 * - Sin header y en host local (`localhost`, `127.0.0.1`, `[::1]`) se usa
 *   `http`, que es como sirve `next dev`: sin esto el callback de Google
 *   apuntaría a `https://localhost:3000` y el navegador no tendría TLS.
 * - Cualquier otro host sin header asume `https`.
 */
export function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (host) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
    return `${forwardedProto || (local ? "http" : "https")}://${host}`;
  }
  return new URL(request.url).origin;
}
