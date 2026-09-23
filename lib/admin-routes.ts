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
  "/calendario",
  "/clientes",
  "/leads",
  "/presupuestos",
  "/facturacion",
  "/finanzas",
  "/plantillas",
  "/inventario",
  "/proveedores",
  "/promotoras",
  // Navegación consolidada (issue #56): Ajustes (Empresa · Correo · Plan ·
  // Usuarios) y Estado (Sistema · Auditoría). Las rutas viejas siguen listadas
  // abajo porque redirigen a estas.
  "/ajustes",
  "/ajustes/empresa",
  "/ajustes/correo",
  "/ajustes/plan",
  "/ajustes/usuarios",
  "/estado",
  "/estado/sistema",
  "/estado/auditoria",
  "/usuarios",
  "/configuracion",
  "/empresa",
  "/plan",
  "/perfil",
  "/auditoria",
  "/sistema",
  "/demo",
  "/imprimir",
  // Aceptación pública de una invitación al equipo (issue #31): es del panel
  // (sin sesión) y vive en el host admin, como el login y la recuperación.
  "/invitacion",
] as const;

export function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
