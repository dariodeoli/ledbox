import { publicConfig } from "@/lib/public-config";
import { getPublicOrigin } from "@/lib/server/public-origin";

/** Google SSO is only valid on the configured administration origin. */
export function isGoogleAuthOriginAllowed(
  request: Request,
  adminUrl: string = process.env.NEXT_PUBLIC_ADMIN_URL || publicConfig.adminUrl,
): boolean {
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(getPublicOrigin(request));
    expected = new URL(adminUrl);
  } catch {
    return false;
  }

  if (actual.origin === expected.origin) return true;

  // Local Next.js development uses HTTP on loopback. Never allow this escape
  // hatch in production, even if a forwarded host header is supplied.
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(actual.host);
  return process.env.NODE_ENV !== "production" && loopback && actual.protocol === "http:";
}
