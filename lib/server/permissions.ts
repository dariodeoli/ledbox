import type { AdminRole } from "@prisma/client";

/**
 * Fuente única de la matriz de permisos del panel (server-side).
 *
 * El rol efectivo de un usuario es el de su membresía (`AdminMembership.role`) en
 * la empresa activa. Todo endpoint mutante de `app/api/admin/*` declara su
 * capacidad y la resuelve con `requireAdminContext`, que responde 403 si el rol
 * no la tiene. `VIEWER` no tiene ninguna capacidad de escritura.
 */
export type AdminCapability =
  // Perfil propio (nombre, contraseña y avatar): cualquier rol, incluido VIEWER.
  | "profile.write"
  // Nombre y logos de la empresa activa.
  | "org.manage"
  // Clientes, oportunidades y datos comerciales de contacto.
  | "clients.write"
  // Eventos, checklist operativo y asignaciones/verificación de inventario.
  | "events.write"
  // Alta y edición de ítems de inventario.
  | "inventory.write"
  // Alta y edición de promotoras.
  | "promoters.write"
  // Presupuestos e ítems.
  | "budgets.write"
  // Cobros de clientes y trabajos/pagos de proveedores.
  | "finance.write"
  // Alta y edición del directorio de proveedores.
  | "suppliers.write"
  // Usuarios y accesos de la empresa activa.
  | "users.manage";

export const ADMIN_CAPABILITIES: readonly AdminCapability[] = [
  "profile.write",
  "org.manage",
  "clients.write",
  "events.write",
  "inventory.write",
  "promoters.write",
  "budgets.write",
  "finance.write",
  "suppliers.write",
  "users.manage",
];

const VIEWER_CAPABILITIES: readonly AdminCapability[] = [
  // El perfil propio es de cada usuario: VIEWER edita su nombre, su contraseña y
  // su avatar (nunca los datos de la empresa ni de otros usuarios).
  "profile.write",
];

const OPERATIONS_CAPABILITIES: readonly AdminCapability[] = [
  "profile.write",
  "clients.write",
  "events.write",
  "inventory.write",
  "promoters.write",
];

const FINANCE_CAPABILITIES: readonly AdminCapability[] = [
  "profile.write",
  "budgets.write",
  "finance.write",
  "suppliers.write",
];

/** OWNER y ADMIN pueden todo dentro de su empresa. */
const FULL_CAPABILITIES: readonly AdminCapability[] = ADMIN_CAPABILITIES;

export const ROLE_CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
  OWNER: FULL_CAPABILITIES,
  ADMIN: FULL_CAPABILITIES,
  FINANCE: FINANCE_CAPABILITIES,
  OPERATIONS: OPERATIONS_CAPABILITIES,
  VIEWER: VIEWER_CAPABILITIES,
};

export const ADMIN_ROLES: readonly AdminRole[] = ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"];

/** Roles que se pueden asignar desde el panel (OWNER solo nace del seed/backfill). */
export const ASSIGNABLE_ROLES: readonly AdminRole[] = ["ADMIN", "FINANCE", "OPERATIONS", "VIEWER"];

export function roleCan(role: AdminRole, capability: AdminCapability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
