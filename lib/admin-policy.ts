/**
 * Política del panel: navegación y permisos de UI (fuente única).
 * El API revalida rol por endpoint; acá solo se decide qué se muestra y qué se puede accionar.
 */

import type { AdminIconName, AdminRole } from "./admin-types";

export const ADMIN_ROLES: readonly AdminRole[] = ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"];

export type AdminNavItem = { href: string; label: string; icon: AdminIconName; roles?: readonly AdminRole[] };
export type AdminNavGroup = { label: string; items: readonly AdminNavItem[] };

/** Módulos restringidos: mismo criterio que el API (usuarios: OWNER/ADMIN). El resto se ve siempre; las acciones se gatean por capacidad. */
const RESTRICTED_MODULES: Record<string, readonly AdminRole[]> = {
  "/usuarios": ["OWNER", "ADMIN"],
};

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    label: "General",
    items: [
      { href: "/dashboard", label: "Resumen", icon: "overview" },
      { href: "/eventos", label: "Eventos", icon: "events" },
      { href: "/calendario", label: "Calendario", icon: "calendar" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/clientes", label: "Clientes", icon: "clients" },
      { href: "/leads", label: "Leads", icon: "leads" },
      { href: "/presupuestos", label: "Presupuestos", icon: "budgets" },
      { href: "/finanzas", label: "Finanzas", icon: "finance" },
    ],
  },
  {
    label: "Recursos",
    items: [
      { href: "/inventario", label: "Inventario", icon: "inventory" },
      { href: "/proveedores", label: "Proveedores", icon: "suppliers" },
      { href: "/promotoras", label: "Promotoras", icon: "promoters" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios", icon: "users", roles: RESTRICTED_MODULES["/usuarios"] },
      { href: "/auditoria", label: "Auditoría", icon: "audit", roles: RESTRICTED_MODULES["/usuarios"] },
    ],
  },
];

export function asAdminRole(value: unknown): AdminRole {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : "VIEWER";
}

export function isAdminNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function adminNavLabel(pathname: string): string {
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (isAdminNavActive(pathname, item.href)) return item.label;
    }
  }
  return "Panel";
}

export function adminNavGroups(role: AdminRole | null | undefined): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !item.roles || (role ? item.roles.includes(role) : false)),
  })).filter((group) => group.items.length > 0);
}

export function adminModuleVisible(href: string, role: AdminRole | null | undefined): boolean {
  const allowed = RESTRICTED_MODULES[href];
  if (!allowed) return true;
  return role ? allowed.includes(role) : false;
}

/** Rol desconocido (sesión cargando) queda sin acciones mutantes; VIEWER nunca las ve. */
export function canWrite(role: AdminRole | null | undefined): boolean {
  return role !== null && role !== undefined && role !== "VIEWER";
}

export function canWriteFinance(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "FINANCE";
}

/** Checklist operativo y asignaciones de equipos (`/api/admin/event-ops`). */
export function canWriteOperations(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPERATIONS";
}

/**
 * Cartera comercial: mismo alcance que `clients.write` en el API (`/api/leads`
 * PATCH). FINANCE no mueve leads, así que tampoco ve acciones de pipeline.
 */
export function canWriteClients(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPERATIONS";
}

export function canManageUsers(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Filtro genérico de búsqueda: compara en minúsculas contra los valores dados. */
export function matchesQuery(query: string, values: Array<string | number | null | undefined>): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(term));
}
