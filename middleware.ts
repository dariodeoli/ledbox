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
const DEMO_URL = publicConfig.demoUrl;
const PRODUCT_URL = publicConfig.productUrl;
const LEGACY_ADMIN_URL = publicConfig.legacyAdminUrl;

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
    return "clientes.ledbox.online";
  }
}

function demoHost(): string {
  try {
    return new URL(DEMO_URL).host.toLowerCase();
  } catch {
    return "demo.ledbox.online";
  }
}

function productHost(): string {
  try {
    return new URL(PRODUCT_URL).host.toLowerCase();
  } catch {
    return "eventos.ledbox.online";
  }
}

function legacyAdminHost(): string {
  try {
    return new URL(LEGACY_ADMIN_URL).host.toLowerCase();
  } catch {
    return "admin.ledbox.online";
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
  const onDemoHost = requestHost(request) === demoHost();
  const onProductHost = requestHost(request) === productHost();

  // Host viejo del panel (admin.ledbox.online): redirige al nuevo (app.ledbox.online).
  if (requestHost(request) === legacyAdminHost()) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, ADMIN_URL), 308);
  }

  if (onProductHost) {
    // Landing de ventas de EventOS (issue #39): la raíz del host la muestra.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/producto";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

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

  if (onDemoHost) {
    // Demo pública (issue #15): la raíz **redirige** a `/demo` —la entrada que
    // crea la sesión demo— para que la ruta visible sea la que el panel espera y
    // el visitante nunca caiga en el login (bug del 22-09-2026).
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/demo";
      return NextResponse.redirect(url, 308);
    }
    return NextResponse.next();
  }

  // Host público: el panel solo vive en el subdominio de la app (en producción).
  // La demo y la landing de EventOS tienen su propio host.
  if (process.env.NODE_ENV === "production" && pathname === "/demo") {
    return NextResponse.redirect(new URL("/", DEMO_URL), 308);
  }
  if (process.env.NODE_ENV === "production" && pathname === "/producto") {
    return NextResponse.redirect(new URL("/", PRODUCT_URL), 308);
  }
  if (process.env.NODE_ENV === "production" && (legacyAdminPath || isAdminRoute(pathname))) {
    const clean = legacyAdminPath ? pathname.slice("/admin".length) || "/" : pathname;
    return NextResponse.redirect(new URL(`${clean}${search}`, ADMIN_URL), 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
