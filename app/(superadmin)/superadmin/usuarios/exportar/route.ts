import { requirePlatformAdmin } from "@/lib/platform/guard";
import { USUARIO_SORTS, loadUsuarios } from "@/lib/platform/queries/usuarios";
import { EXPORT_LIMIT, EXPORT_MAX_ROWS, parseTableParams, searchAllowed } from "@/lib/platform/tablas";
import { csvResponse, tooManyResponse } from "@/lib/platform/csv-response";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** CSV de usuarios con los mismos filtros que la tabla. Nunca incluye hashes ni tokens. */
export async function GET(request: Request) {
  const { userId } = await requirePlatformAdmin();
  const limit = await rateLimit(`superadmin:exportar:${userId}`, EXPORT_LIMIT);
  if (!limit.allowed) return tooManyResponse(limit.retryAfter);
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const table = parseTableParams(params, { sorts: USUARIO_SORTS, filterOptions: { activa: ["si", "no"], verificado: ["si", "no"], pin: ["si", "no"] } });
  if (!(await searchAllowed(userId, table.q, rateLimit))) return tooManyResponse(900);
  const data = await loadUsuarios({ ...table, page: 1 }, { pageSize: EXPORT_MAX_ROWS });
  return csvResponse(
    "usuarios.csv",
    ["Nombre", "Correo", "Empresas y roles", "Activa", "Último ingreso", "Última actividad", "PIN", "Correo verificado"],
    data.rows.map((r) => [r.name, r.email, r.companies.map((c) => `${c.org} (${c.role})`).join("; "), r.active ? "Sí" : "No", r.lastLogin ? r.lastLogin.toISOString() : "", r.lastActive ? r.lastActive.toISOString() : "", r.hasPin ? "Sí" : "No", r.emailVerified ? "Sí" : "No"]),
  );
}
