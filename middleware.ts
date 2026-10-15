import { NextResponse, type NextRequest } from "next/server";
import { PANEL_HOME, isAdminRoute } from "@/lib/admin-routes";
import { publicConfig } from "@/lib/public-config";

/**
 * Regla de URLs (21-09-2026): el panel vive en admin.ledbox.online y sus rutas
 * NO llevan /admin (el subdominio ya dice que es admin).
 *
 * - Las páginas del panel son rutas raíz reales dentro de `app/(admin)/*`
 *   (`/login`, `/eventos`, `/finanzas`, …); no hay prefijo /admin.
 * - En el host admin, `/` muestra el dashboard (`app/(admin)/dashboard`).
 * - En el host de la demo (issue #53), `/` muestra la entrada de la demo con
 *   rewrite a `/demo`: la URL visible queda limpia, sin el segmento.
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

/**
 * Rutas viejas del panel (issue #56): van a su canónica sin renderizar nada.
 * El redirect del middleware cubre la navegación dura (URL escrita, link
 * externo); las páginas viejas conservan su `redirect()` para la navegación
 * blanda del cliente, que no pasa por acá.
 */
const LEGACY_PANEL_REDIRECTS: Record<string, string> = {
  "/calendario": "/eventos?vista=calendario",
  "/empresa": "/ajustes/empresa",
  "/configuracion": "/ajustes/correo",
  "/configuracion/seguridad": "/perfil",
  "/usuarios": "/ajustes/usuarios",
  "/plan": "/ajustes/plan",
  "/auditoria": "/estado/auditoria",
  "/sistema": "/estado/sistema",
};

/**
 * Páginas internas de la superficie de EventOS (issue #168): el host del
 * producto sirve privacidad, términos y estado con la URL limpia y la ruta
 * interna vive bajo `/producto` —el mismo mecanismo que la raíz de la landing
 * (`/` → `/producto`)—. En el host público esas rutas no existen.
 */
const PRODUCT_PAGE_REWRITES: Record<string, string> = {
  "/privacidad": "/producto/privacidad",
  "/terminos": "/producto/terminos",
  "/status": "/producto/status",
};

function legacyPanelRedirect(request: NextRequest, pathname: string): NextResponse | null {
  const target = LEGACY_PANEL_REDIRECTS[pathname];
  if (!target) return null;
  return NextResponse.redirect(absoluteOnRequestHost(request, target), 308);
}

function absoluteOnRequestHost(request: NextRequest, path: string): URL {
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "");
  return new URL(`${proto}://${requestHost(request)}${path}`);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // La ruta pedida viaja al panel en todas las superficies: el layout del panel
  // la usa para distinguir la entrada a la demo (`/demo`, issue #14) del resto de
  // las pantallas sin sesión, que van al login (issue #51).
  const requestHeaders = new Headers(request.headers);
  // El rewrite interno de la raíz de la demo (`/` → `/demo`, issue #53) vuelve a
  // entrar al middleware con el path del destino: la marca conserva la ruta que
  // pidió el visitante (para el `next` de la sesión demo) y evita que ese paso
  // interno aplique la canónica `/demo` → `/`, que sería un bucle.
  const demoRootPath = requestHeaders.get("x-demo-original-path");
  requestHeaders.set("x-pathname", demoRootPath || `${pathname}${search}`);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });
  const legacyAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const onAdminHost = requestHost(request) === adminHost();
  const onClientHost = requestHost(request) === clientHost();
  const onDemoHost = requestHost(request) === demoHost();
  const onProductHost = requestHost(request) === productHost();

  // Host viejo del panel (admin.ledbox.online): redirige al nuevo (app.ledbox.online).
  if (requestHost(request) === legacyAdminHost()) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, ADMIN_URL), 308);
  }

  // Panel de plataforma (docs/SUPERADMIN.md §2): solo vive en el host de la app. En los
  // demás hosts (clientes., demo., eventos. y el público) no existe: 307 a «/» del mismo
  // host, antes de la lógica de cada uno. Solo en producción (en desarrollo todo es
  // localhost). No está en ADMIN_ROUTES a propósito: el host público lo mandaría a la app.
  if (
    process.env.NODE_ENV === "production" &&
    !onAdminHost &&
    (pathname === "/superadmin" || pathname.startsWith("/superadmin/"))
  ) {
    return NextResponse.redirect(absoluteOnRequestHost(request, "/"), 307);
  }

  if (onProductHost) {
    // Landing de ventas de EventOS (issue #39): la raíz del host la muestra.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/producto";
      return NextResponse.rewrite(url);
    }
    // Páginas de EventOS (issue #168): URL limpia → ruta interna de la piel.
    const productPage = PRODUCT_PAGE_REWRITES[pathname];
    if (productPage) {
      const url = request.nextUrl.clone();
      url.pathname = productPage;
      return NextResponse.rewrite(url);
    }
    return pass();
  }

  if (onAdminHost) {
    // Links viejos con /admin → ruta limpia equivalente.
    if (legacyAdminPath) {
      const clean = pathname.slice("/admin".length) || "/";
      return NextResponse.redirect(absoluteOnRequestHost(request, `${clean}${search}`), 308);
    }
    // Rutas viejas del panel (issue #56) → su canónica, sin renderizar el shell.
    const legacy = legacyPanelRedirect(request, pathname);
    if (legacy) return legacy;
    // El panel siempre se sirve en el host admin; el resto (API, assets, archivos) pasa igual.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = PANEL_HOME;
      return NextResponse.rewrite(url);
    }
    return pass();
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
    return pass();
  }

  if (onDemoHost) {
    // Demo pública (issues #15 y #53): la entrada se sirve en `/` con rewrite a
    // `/demo` (igual que el host admin con `/dashboard`), así la URL visible
    // nunca muestra el segmento. `/demo` (links viejos y compartidos) queda
    // como canónica de la raíz; los links profundos siguen entrando igual.
    // Rutas viejas del panel (issue #56) → su canónica, sin renderizar el shell.
    const legacy = legacyPanelRedirect(request, pathname);
    if (legacy) return legacy;
    // En el paso interno del rewrite (`x-demo-original-path`) no se canonicaliza:
    // el destino ya es la entrada de la demo.
    if ((pathname === "/demo" || pathname.startsWith("/demo/")) && !demoRootPath) {
      const clean = pathname.slice("/demo".length) || "/";
      return NextResponse.redirect(absoluteOnRequestHost(request, `${clean}${search}`), 308);
    }
    // El layout del panel lee `x-pathname` (seteado arriba) para devolver al
    // visitante a la misma pantalla después de crear la sesión demo (links
    // profundos incluidos) y para distinguir la entrada a la demo del resto de
    // las pantallas sin sesión, que van al login (issue #51).
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/demo";
      const rootHeaders = new Headers(requestHeaders);
      rootHeaders.set("x-demo-original-path", `${pathname}${search}`);
      return NextResponse.rewrite(url, { request: { headers: rootHeaders } });
    }
    return pass();
  }

  // Host público: en desarrollo el panel se sirve sin subdominio, así que las
  // rutas viejas también redirigen acá (en producción el panel va al host admin).
  if (process.env.NODE_ENV !== "production") {
    const legacy = legacyPanelRedirect(request, pathname);
    if (legacy) return legacy;
  }

  // Host público: el panel solo vive en el subdominio de la app (en producción).
  // La demo y la landing de EventOS tienen su propio host. El paso interno del
  // rewrite de la raíz de la demo no rebota acá (evita un bucle si el host real
  // no llegara en los headers del rewrite).
  if (process.env.NODE_ENV === "production" && pathname === "/demo" && !demoRootPath) {
    return NextResponse.redirect(new URL("/", DEMO_URL), 308);
  }
  if (process.env.NODE_ENV === "production" && (pathname === "/producto" || pathname.startsWith("/producto/"))) {
    // El prefijo interno de la superficie de EventOS no se sirve en el host
    // público: va a su URL limpia en el host del producto (issue #168).
    const clean = pathname === "/producto" ? "/" : pathname.slice("/producto".length);
    return NextResponse.redirect(new URL(`${clean}${search}`, PRODUCT_URL), 308);
  }
  if (process.env.NODE_ENV === "production" && (legacyAdminPath || isAdminRoute(pathname))) {
    const clean = legacyAdminPath ? pathname.slice("/admin".length) || "/" : pathname;
    return NextResponse.redirect(new URL(`${clean}${search}`, ADMIN_URL), 308);
  }

  return pass();
}

/**
 * `api/admin/import` queda FUERA del middleware a propósito: «Importar catálogo» sube un ZIP de
 * fotos de hasta 60 MB y, si el middleware corre, Next bufferea el cuerpo (tope por defecto 10 MB)
 * y lo trunca. Subir el tope con `experimental.middlewareClientMaxBodySize` es global (cualquier
 * POST, también los públicos), así que se excluye solo esta ruta. Verificado: para ese path el
 * middleware solo haría `pass()` —la auth del panel y los permisos los resuelve la propia ruta con
 * `requireAdminContext`, el rewrite de host solo toca `/`, los redirects de host son de páginas y
 * `x-pathname` lo leen layouts, no las API—. Si algún día el middleware necesita actuar acá,
 * hay que subir el ZIP en partes en vez de volver a quitar esta exclusión.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/admin/import(?:/|$)).*)"],
};
