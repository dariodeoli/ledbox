import { db } from "@/lib/server/db";
import { approvalEvidence, loadPublicBudget, portalBudgetOpen } from "@/lib/server/budget-portal";
import { jsonError, readJson } from "@/lib/server/http";
import { getClientIp, rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { normalizeBudgetCode } from "@/lib/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 120;
const MAX_NOTE = 600;

/**
 * `POST /api/portal/budget/[token]/approve`: aprobación digital del cliente
 * (issue #12). Registra nombre, consentimiento explícito, fecha/hora, IP y
 * user-agent como evidencia y deja el presupuesto en `APPROVED`.
 *
 * Es idempotente: una sola aprobación por presupuesto. Si ya estaba aprobado
 * (por el portal o por el panel) el reintento devuelve la aprobación original
 * sin pisarla.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`portal:approve:${getClientIp(request)}`, 20);
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
  if (!portalBudgetOpen(budget.status)) return jsonError("Este presupuesto ya no está disponible para aprobar.", 409);

  const body = (await readJson(request)) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!body.consent || body.consent !== true) return jsonError("Necesitamos tu consentimiento para registrar la aprobación.", 400);
  if (name.length < 3) return jsonError("Ingresá tu nombre y apellido.", 400);
  if (name.length > MAX_NAME) return jsonError(`El nombre no puede superar los ${MAX_NAME} caracteres.`, 400);
  if (note.length > MAX_NOTE) return jsonError(`El comentario no puede superar los ${MAX_NOTE} caracteres.`, 400);

  // Solo la primera aprobación escribe: el `where` con `approvedAt: null` evita
  // que dos pedidos simultáneos se pisen (el segundo recibe la ya registrada).
  const evidence = approvalEvidence(request);
  const updated = await db.budget.updateMany({
    where: { id: budget.id, approvedAt: null },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedByName: name,
      approvalMethod: "digital",
      approvalIp: evidence.ip,
      approvalUserAgent: evidence.userAgent,
      approvalNote: note || null,
    },
  });

  const payload = await loadPublicBudget(code);
  if (!payload) return jsonError("No encontramos ese presupuesto.", 404);
  return Response.json({ budget: payload, alreadyApproved: updated.count === 0 });
}
