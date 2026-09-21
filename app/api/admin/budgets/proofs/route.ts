import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope de presupuestos por consulta (una sola llamada para todo el módulo). */
const MAX_BUDGET_FILTERS = 50;
/** Tope de comprobantes devueltos (solo metadatos, sin el binario). */
const MAX_ROWS = 200;

/**
 * `GET /api/admin/budgets/proofs` (issue #17): comprobantes de pago recibidos
 * del portal, **solo metadatos** (id, presupuesto, cobro, quién lo subió, tipo,
 * tamaño y fecha). El archivo se sirve aparte, con sesión, en
 * `/api/admin/budgets/proofs/[id]`.
 *
 * `?budgetId=` filtra uno o varios presupuestos separados por coma; sin
 * parámetro devuelve los últimos comprobantes de la empresa activa (200). Nunca
 * cruza empresas y lo puede leer cualquier rol, incluido VIEWER.
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const url = new URL(request.url);
  const budgetIds = [
    ...new Set(
      url.searchParams
        .getAll("budgetId")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (budgetIds.length > MAX_BUDGET_FILTERS) {
    return jsonError(`Consultá hasta ${MAX_BUDGET_FILTERS} presupuestos por vez.`, 400);
  }

  const proofs = await db.budgetPaymentProof.findMany({
    where: { organizationId, ...(budgetIds.length > 0 ? { budgetId: { in: budgetIds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    select: {
      id: true,
      budgetId: true,
      paymentId: true,
      uploadedByName: true,
      mime: true,
      size: true,
      createdAt: true,
    },
  });
  return Response.json({ proofs });
}
