/**
 * Rutas del panel (host admin). Se mantiene acá para que el middleware del host
 * público sepa qué paths pertenecen al panel. Al crear un módulo nuevo del panel,
 * sumarlo a esta lista.
 */
export const ADMIN_ROUTES = [
  "/login",
  "/recuperar",
  "/reset-password",
  "/dashboard",
  "/eventos",
  "/clientes",
  "/presupuestos",
  "/finanzas",
  "/inventario",
  "/proveedores",
  "/promotoras",
  "/usuarios",
] as const;

export function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
