import { NextResponse, type NextRequest } from "next/server";
import { isAdminRoute } from "@/lib/admin-routes";
import { publicConfig } from "@/lib/public-config";

/**
 * Regla de URLs (21-09-2026): el panel vive en admin.ledbox.online y sus rutas
 * NO llevan /admin (el subdominio ya dice que es admin).
 *
 * - Las páginas del panel son rutas raíz reales dentro de `app/(admin)/*`
 *   (`/login`, `/eventos`, `/finanzas`, …); no hay prefijo /admin.
 * - En el host admin, `/` muestra el dashboard (`app/(admin)/dashboard`).
 * - En el host del cliente (portal del cliente, issue #12), `/` muestra el
 *   validador de presupuestos (`app/(portal)/portal`).
 * - En el host público, las rutas del panel se redirigen al subdominio admin.
 * - `/admin/*` (links viejos) se canonicaliza a la ruta limpia.
 */

// Fuente única de los dominios: `lib/public-config.ts` (nada de defaults duplicados).
const ADMIN_URL = publicConfig.adminUrl;
const CLIENT_URL = publicConfig.clientUrl;

function adminHost(): string {
  try {
    return new URL(ADMIN_URL).host.toLowerCase();
  } catch {
    return "admin.ledbox.online";
  }
}

function clientHost(): string {
  try {
    return new URL(CLIENT_URL).host.toLowerCase();
  } catch {
    return "cliente.ledbox.online";
  }
}

function requestHost(request: NextRequest): string {
  const raw = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  return raw.split(",")[0].trim().toLowerCase();
}

function absoluteOnRequestHost(request: NextRequest, path: string): URL {
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "");
  return new URL(`${proto}://${requestHost(request)}${path}`);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const legacyAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const onAdminHost = requestHost(request) === adminHost();
  const onClientHost = requestHost(request) === clientHost();

  if (onAdminHost) {
    // Links viejos con /admin → ruta limpia equivalente.
    if (legacyAdminPath) {
      const clean = pathname.slice("/admin".length) || "/";
      return NextResponse.redirect(absoluteOnRequestHost(request, `${clean}${search}`), 308);
    }
    // El panel siempre se sirve en el host admin; el resto (API, assets, archivos) pasa igual.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  if (onClientHost) {
    // Portal del cliente (issue #12): la raíz muestra el validador de
    // presupuestos (`app/(portal)/portal`); el resto de rutas pasa igual. La
    // reescritura es directa, así que no vuelve a entrar al middleware (sin bucle).
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/portal";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Host público: el panel solo vive en el subdominio admin (en producción).
  if (process.env.NODE_ENV === "production" && (legacyAdminPath || isAdminRoute(pathname))) {
    const clean = legacyAdminPath ? pathname.slice("/admin".length) || "/" : pathname;
    return NextResponse.redirect(new URL(`${clean}${search}`, ADMIN_URL), 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
