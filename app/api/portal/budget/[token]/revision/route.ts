import { db } from "@/lib/server/db";
import { loadPublicBudget, portalBudgetOpen } from "@/lib/server/budget-portal";
import { jsonError, readJson } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { normalizeBudgetCode } from "@/lib/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 120;
const MAX_NOTE = 1000;

/**
 * `POST /api/portal/budget/[token]/revision`: el cliente pide cambios con un
 * comentario (issue #12). No toca una aprobación ya registrada: si el
 * presupuesto está aprobado responde 409 y el panel debe gestionarlo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:revision:${getClientIp(request)}`, 20);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const { token } = await params;
  const code = normalizeBudgetCode(token);
  const budget = code
    ? await db.budget.findUnique({
        where: { publicToken: code },
        select: { id: true, status: true, approvedAt: true },
      })
    : null;
  if (!budget) return jsonError("No encontramos ese presupuesto.", 404);
  if (budget.approvedAt) return jsonError("Este presupuesto ya fue aprobado; el equipo de LedBox puede revisarlo.", 409);
  if (!portalBudgetOpen(budget.status)) return jsonError("Este presupuesto ya no está disponible.", 409);

  const body = (await readJson(request)) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return jsonError("Contanos qué cambios necesitás.", 400);
  if (note.length > MAX_NOTE) return jsonError(`El comentario no puede superar los ${MAX_NOTE} caracteres.`, 400);
  if (name.length > MAX_NAME) return jsonError(`El nombre no puede superar los ${MAX_NAME} caracteres.`, 400);

  await db.budget.update({
    where: { id: budget.id },
    data: {
      // Un pedido nuevo actualiza el comentario, pero nunca reabre una venta cerrada.
      status: budget.status === "APPROVED" ? budget.status : "NEGOTIATING",
      revisionRequestedAt: new Date(),
      revisionNote: name ? `${note} — ${name}` : note,
    },
  });

  const payload = await loadPublicBudget(code);
  if (!payload) return jsonError("No encontramos ese presupuesto.", 404);
  return Response.json({ budget: payload });
}
