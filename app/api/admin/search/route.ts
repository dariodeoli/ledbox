import { adminRoleLabel, budgetStatusLabel, clientTypeLabel, eventStatusLabel, formatDate, formatMoney, normalizeContactPhone } from "@/lib/admin-format";
import { SEARCH_LIMIT_PER_TYPE, SEARCH_MIN_QUERY, type AdminSearchResult } from "@/lib/admin-search";
import { db } from "@/lib/server/db";
import { roleCan } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/search?q=<texto>`: buscador global del panel (⌘/Ctrl + K).
 *
 * Busca en la **empresa activa** y devuelve resultados planos
 * `{ type, id, title, subtitle, href }`:
 *
 * - clientes: nombre, empresa, RUC, correo, teléfono, persona encargada y sus
 *   contactos directos (teléfono, WhatsApp, Instagram y sitio —guardados
 *   normalizados, issue #36);
 * - presupuestos: título y datos del cliente;
 * - eventos: nombre, lugar, **ciudad** (issue #67) y datos del cliente;
 * - usuarios del equipo: solo para los roles con `users.manage` (OWNER/ADMIN),
 *   siempre con membresía en la empresa activa.
 *
 * Límite por tipo (`SEARCH_LIMIT_PER_TYPE`) y con menos de
 * `SEARCH_MIN_QUERY` caracteres no busca: devuelve la lista vacía y el mínimo,
 * así la UI puede decir «seguí escribiendo» sin inventar resultados. Sin sesión
 * responde 401; VIEWER ve solo lectura (nunca usuarios).
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId, role } = auth.context;

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length < SEARCH_MIN_QUERY) {
    return Response.json({ query, minQuery: SEARCH_MIN_QUERY, results: [] });
  }

  const contains = { contains: query, mode: "insensitive" as const };
  const canSeeUsers = roleCan(role, "users.manage");
  /**
   * Teléfonos: la persona los escribe como los conoce («0981 222 333») pero se
   * guardan normalizados («+595 981222333»); se busca también esa forma.
   */
  const phoneQuery = /\d{6,}/.test(query.replace(/[^\d]/g, "")) ? normalizeContactPhone(query) : "";
  const phoneContains = phoneQuery && phoneQuery !== query ? { contains: phoneQuery, mode: "insensitive" as const } : null;

  const [clients, budgets, events, users] = await Promise.all([
    db.client.findMany({
      where: {
        organizationId,
        OR: [
          { name: contains },
          { company: contains },
          { ruc: contains },
          { email: contains },
          { phone: contains },
          { contactName: contains },
          { contactEmail: contains },
          { contactPhone: contains },
          { whatsapp: contains },
          { instagram: contains },
          { website: contains },
          ...(phoneContains ? [{ phone: phoneContains }, { whatsapp: phoneContains }, { contactPhone: phoneContains }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: SEARCH_LIMIT_PER_TYPE,
      select: { id: true, name: true, company: true, type: true },
    }),
    db.budget.findMany({
      where: {
        organizationId,
        OR: [
          { title: contains },
          { client: { name: contains } },
          { client: { company: contains } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: SEARCH_LIMIT_PER_TYPE,
      select: {
        id: true,
        title: true,
        total: true,
        status: true,
        client: { select: { name: true } },
      },
    }),
    db.event.findMany({
      where: {
        organizationId,
        OR: [
          { name: contains },
          { location: contains },
          { city: contains },
          { client: { name: contains } },
          { client: { company: contains } },
        ],
      },
      orderBy: [{ startsAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: SEARCH_LIMIT_PER_TYPE,
      select: {
        id: true,
        name: true,
        location: true,
        city: true,
        startsAt: true,
        status: true,
        client: { select: { name: true } },
      },
    }),
    canSeeUsers
      ? db.adminUser.findMany({
          where: {
            memberships: { some: { organizationId } },
            OR: [{ name: contains }, { email: contains }],
          },
          orderBy: { name: "asc" },
          take: SEARCH_LIMIT_PER_TYPE,
          select: {
            id: true,
            name: true,
            email: true,
            memberships: { where: { organizationId }, select: { role: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const results: AdminSearchResult[] = [
    ...clients.map((client) => ({
      type: "client" as const,
      id: client.id,
      title: client.name,
      subtitle: [client.company, clientTypeLabel(client.type)].filter(Boolean).join(" · "),
      href: "/clientes",
    })),
    ...budgets.map((budget) => ({
      type: "budget" as const,
      id: budget.id,
      title: budget.title,
      subtitle: [budget.client.name, formatMoney(budget.total), budgetStatusLabel(budget.status)].join(" · "),
      href: "/presupuestos",
    })),
    ...events.map((event) => {
      // Lugar y ciudad juntos cuando existen: el buscador ahora también entra
      // por ciudad (issue #67), así el resultado muestra por qué apareció.
      const place = [event.location, event.city].filter(Boolean).join(", ");
      return {
        type: "event" as const,
        id: event.id,
        title: event.name,
        subtitle: [
          event.client.name,
          [event.startsAt ? formatDate(event.startsAt) : "", place].filter(Boolean).join(" · "),
          eventStatusLabel(event.status),
        ]
          .filter(Boolean)
          .join(" · "),
        href: "/eventos",
      };
    }),
    ...users.map((user) => ({
      type: "user" as const,
      id: user.id,
      title: user.name,
      subtitle: [user.email, adminRoleLabel(user.memberships[0]?.role)].filter(Boolean).join(" · "),
      href: "/ajustes/usuarios",
    })),
  ];

  return Response.json({ query, minQuery: SEARCH_MIN_QUERY, results });
}
