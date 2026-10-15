/**
 * Política del panel: navegación y permisos de UI (fuente única).
 * El API revalida rol por endpoint; acá solo se decide qué se muestra y qué se puede accionar.
 */

import type { AdminIconName, AdminRole, MessageTemplateCategoryValue } from "./admin-types";

export const ADMIN_ROLES: readonly AdminRole[] = ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"];

/** Contadores del menú (`/api/admin/nav-counts`): solo los ítems de Ventas llevan uno. */
export type AdminNavCountKey = "leads" | "budgets" | "events";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: AdminIconName;
  roles?: readonly AdminRole[];
  /** Rutas hijas que viven dentro de este ítem (p. ej. Firmas dentro de Presupuestos): lo marcan activo. */
  also?: readonly string[];
  /** Pendiente real que se dibuja como contador junto al ítem; sin dato no se dibuja. */
  countKey?: AdminNavCountKey;
  /** Qué cuenta el contador (para el `title`/lector de pantalla). */
  countHint?: string;
};
export type AdminNavGroup = {
  label: string;
  items: readonly AdminNavItem[];
  /** Sin encabezado ni acordeón: ítems sueltos (Inicio, Clientes). */
  bare?: boolean;
  /** Etapas de un flujo: se dibujan unidas por una línea vertical (Ventas). */
  flow?: boolean;
};

/**
 * Módulos restringidos: mismo criterio que el API (empresa, correo, usuarios,
 * estado y auditoría: OWNER/ADMIN). El resto se ve siempre; las acciones se
 * gatean por capacidad. Plan (issue #42) se ve en todos los roles: el consumo y
 * los topes son información de la empresa; solo OWNER/ADMIN piden el cambio
 * (`org.manage`). Los `href` son los de la navegación consolidada (issue #56):
 * cada sección de Ajustes/Estado tiene su propia clave.
 */
const RESTRICTED_MODULES: Record<string, readonly AdminRole[]> = {
  "/ajustes/empresa": ["OWNER", "ADMIN"],
  "/ajustes/correo": ["OWNER", "ADMIN"],
  "/ajustes/alquileres": ["OWNER", "ADMIN"],
  "/ajustes/tienda": ["OWNER", "ADMIN"],
  "/ajustes/usuarios": ["OWNER", "ADMIN"],
  // Papelera (docs/PAPELERA.md): `trash.manage` en el API, solo OWNER y ADMIN.
  "/ajustes/eliminados": ["OWNER", "ADMIN"],
  "/estado/sistema": ["OWNER", "ADMIN"],
  "/estado/auditoria": ["OWNER", "ADMIN"],
};

/** Títulos de páginas que no viven en el sidebar (se llega desde el chip de usuario). */
const PAGE_TITLES: Record<string, string> = {
  "/perfil": "Mi perfil",
  "/demo": "Demo",
  // Firmas vive dentro de Presupuestos y Plantillas dentro de Ajustes: siguen
  // siendo rutas propias, pero ya no son ítems del menú.
  "/firmas": "Firmas",
  "/plantillas": "Plantillas",
};

/**
 * Navegación del panel por etapas (orden fijado en `docs/DISENO-PANEL.md` §6).
 *
 * Inicio · **Ventas** (Leads → Presupuestos → Eventos, el flujo del negocio) ·
 * Clientes · **Operación** · **Plata** · **Sistema**. Firmas es una pestaña de
 * Presupuestos y Plantillas una de Ajustes (`/firmas` y `/plantillas` siguen
 * respondiendo). Los contadores de Ventas salen de datos reales
 * (`/api/admin/nav-counts`). Las secciones de Ajustes/Estado siguen consolidadas
 * (issue #56) y sus rutas viejas entran con redirect.
 */
export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    label: "Inicio",
    bare: true,
    items: [{ href: "/dashboard", label: "Inicio", icon: "overview" }],
  },
  {
    label: "Ventas",
    flow: true,
    items: [
      { href: "/leads", label: "Leads", icon: "leads", countKey: "leads", countHint: "leads nuevos sin contactar" },
      {
        href: "/presupuestos",
        label: "Presupuestos",
        icon: "budgets",
        // Firma de documentos (issue #81): el listado global es una pestaña de Presupuestos.
        also: ["/firmas"],
        countKey: "budgets",
        countHint: "presupuestos enviados o en negociación",
      },
      { href: "/eventos", label: "Eventos", icon: "events", countKey: "events", countHint: "eventos en los próximos 7 días" },
    ],
  },
  {
    label: "Clientes",
    bare: true,
    items: [{ href: "/clientes", label: "Clientes", icon: "clients" }],
  },
  {
    label: "Operación",
    items: [
      { href: "/inventario", label: "Inventario", icon: "inventory" },
      { href: "/proveedores", label: "Proveedores", icon: "suppliers" },
      { href: "/promotoras", label: "Promotoras", icon: "promoters" },
    ],
  },
  {
    label: "Plata",
    items: [
      { href: "/finanzas", label: "Finanzas", icon: "finance" },
      { href: "/facturacion", label: "Facturación", icon: "receipt" },
    ],
  },
  {
    label: "Sistema",
    items: [
      // Plantillas (issue #35) es una sección de Ajustes.
      { href: "/ajustes", label: "Ajustes", icon: "settings", also: ["/plantillas"] },
      { href: "/estado", label: "Estado", icon: "database", roles: RESTRICTED_MODULES["/estado/sistema"] },
    ],
  },
];

export function asAdminRole(value: unknown): AdminRole {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : "VIEWER";
}

export function isAdminNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** El ítem está activo en su ruta o en las rutas hijas que viven dentro de él. */
export function isAdminNavItemActive(pathname: string, item: Pick<AdminNavItem, "href" | "also">): boolean {
  return isAdminNavActive(pathname, item.href) || (item.also ?? []).some((href) => isAdminNavActive(pathname, href));
}

export function adminNavLabel(pathname: string): string {
  for (const [href, label] of Object.entries(PAGE_TITLES)) {
    if (isAdminNavActive(pathname, href)) return label;
  }
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (isAdminNavActive(pathname, item.href)) return item.label;
    }
  }
  return "Panel";
}

/** Páginas fuera del sidebar: mismo criterio de ícono que el resto del panel. */
const PAGE_ICONS: Record<string, AdminIconName> = {
  "/perfil": "user",
  "/demo": "overview",
  "/firmas": "pen",
  "/plantillas": "mail",
};

/**
 * Ícono del módulo para el título de la página (issue del 22-09-2026): sale del
 * mismo ítem de navegación que dibuja el sidebar, así el encabezado y el menú
 * nunca muestran íconos distintos. Sin coincidencia cae en la vista general.
 */
export function adminNavIcon(pathname: string): AdminIconName {
  for (const [href, icon] of Object.entries(PAGE_ICONS)) {
    if (isAdminNavActive(pathname, href)) return icon;
  }
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (isAdminNavActive(pathname, item.href)) return item.icon;
    }
  }
  return "overview";
}

export function adminNavGroups(role: AdminRole | null | undefined): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
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

/**
 * Presupuestos (`budgets.write` en el API): OWNER, ADMIN y FINANCE. VIEWER y
 * OPERATIONS no arman presupuestos, así que no ven «Armar presupuesto».
 */
export function canWriteBudgets(role: AdminRole | null | undefined): boolean {
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

/**
 * «Carga con IA» (issue #120): crea clientes, eventos y productos; el API
 * revalida cada alta con su capacidad (`clients.write`/`events.write`/
 * `inventory.write`), que este trío de roles tiene completa. FINANCE y VIEWER
 * no ven el asistente.
 */
export function canWriteCarga(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "OPERATIONS";
}

/** «Importar» de cada módulo (carga masiva): solo OWNER y ADMIN (el API exige además la escritura del módulo). */
export function canImportCatalog(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Ajustes → Eliminados (`trash.manage`): ver, restaurar, borrar definitivo y anonimizar. */
export function canManageTrash(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageUsers(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Plantillas de mensajes (issue #35): OWNER/ADMIN administran todas las
 * categorías; FINANCE solo cobranzas y OPERATIONS solo eventos. Es la misma
 * regla que revalida el API (`/api/admin/message-templates`), server-side.
 */
export function canWriteTemplateCategory(
  role: AdminRole | null | undefined,
  category: MessageTemplateCategoryValue,
): boolean {
  if (role === "OWNER" || role === "ADMIN") return true;
  if (role === "FINANCE") return category === "collection";
  if (role === "OPERATIONS") return category === "event";
  return false;
}

/** Nombre y logos de la empresa (`org.manage` en el API): OWNER y ADMIN. */
export function canManageOrganization(role: AdminRole | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Registro fiscal (issue #41): emisión de facturas, compras, saldado y cierre
 * mensual. Mismo alcance que `finance.write` en el API; VIEWER solo lee.
 */
export function canWriteFiscal(role: AdminRole | null | undefined): boolean {
  return canWriteFinance(role);
}

/** Datos fiscales de la empresa: `org.manage` en el API (OWNER y ADMIN). */
export function canManageFiscalProfile(role: AdminRole | null | undefined): boolean {
  return canManageOrganization(role);
}

/** Reapertura de un mes cerrado: solo OWNER (misma regla que revalida el API). */
export function canReopenFiscalPeriod(role: AdminRole | null | undefined): boolean {
  return role === "OWNER";
}

/** Filtro genérico de búsqueda: compara en minúsculas contra los valores dados. */
export function matchesQuery(query: string, values: Array<string | number | null | undefined>): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(term));
}
