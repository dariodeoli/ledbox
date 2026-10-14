import { requirePlatformAdmin } from "@/lib/platform/guard";
import { parsePeriod, resolvePeriod } from "@/lib/platform/periods";
import { EMPRESA_SORTS, loadEmpresas, loadPlanOptions } from "@/lib/platform/queries/empresas";
import { EXPORT_LIMIT, EXPORT_MAX_ROWS, parseTableParams, searchAllowed } from "@/lib/platform/tablas";
import { csvResponse, tooManyResponse } from "@/lib/platform/csv-response";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** CSV de empresas con los mismos filtros que la tabla. Guard + límite antes de consultar. */
export async function GET(request: Request) {
  const { userId } = await requirePlatformAdmin();
  const limit = await rateLimit(`superadmin:exportar:${userId}`, EXPORT_LIMIT);
  if (!limit.allowed) return tooManyResponse(limit.retryAfter);
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const plans = await loadPlanOptions();
  const table = parseTableParams(params, { sorts: EMPRESA_SORTS, filterOptions: { activa: ["si", "no"], plan: plans.map((p) => p.code) } });
  if (!(await searchAllowed(userId, table.q, rateLimit))) return tooManyResponse(900);
  const range = resolvePeriod(parsePeriod(params.p));
  const data = await loadEmpresas(range, { ...table, page: 1 }, { pageSize: EXPORT_MAX_ROWS });
  return csvResponse(
    "empresas.csv",
    ["Empresa", "Slug", "Plan", "Activa", "Alta", "Miembros", "Eventos", `Monto aprobado ${range.label} (Gs)`, "Última actividad"],
    data.rows.map((r) => [r.name, r.slug, r.plan ?? "Sin asignar", r.active ? "Sí" : "No", r.createdAt.toISOString(), r.members, r.events, r.approved, r.lastActivity ? r.lastActivity.toISOString() : ""]),
  );
}
