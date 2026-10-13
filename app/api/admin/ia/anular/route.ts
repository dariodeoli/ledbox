import { db } from "@/lib/server/db";
import { annulInventoryItem } from "@/lib/server/trash-ops";
import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { rateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { requireAdminContext } from "@/lib/server/tenancy";
import type { AdminCapability } from "@/lib/server/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anulación de lo creado por la Carga con IA (issue #130, hallazgo IA-2).
 *
 * Solo para **clientes y productos sin historial** (los cobros se anulan con
 * la cancelación de Finanzas: `PATCH /api/admin/finance`). Los guardas son
 * estrictos: si el registro ya tiene eventos/presupuestos/cobros (cliente) o
 * asignaciones/vínculos de presupuesto (ítem), no se borra y se explica.
 * Todo queda auditado con el `lote` de la carga.
 */

const MAX_TEXTO = 120;

/** Capacidad que exige anular cada tipo (la misma del alta). */
const CAPACIDAD: Record<string, AdminCapability> = {
  cliente: "clients.write",
  producto: "inventory.write",
};

export async function POST(request: Request) {
  const body = (await readJson(request)) as Record<string, unknown>;
  const tipo = typeof body.tipo === "string" ? body.tipo : "";
  const id = typeof body.id === "string" ? body.id.trim().slice(0, MAX_TEXTO) : "";
  const lote = typeof body.lote === "string" ? body.lote.trim().slice(0, MAX_TEXTO) : "";
  if (!id) return jsonError("Falta el registro a anular.", 400);
  if (tipo !== "cliente" && tipo !== "producto") {
    return jsonError("Los cobros se anulan desde Finanzas.", 400);
  }

  const auth = await requireAdminContext(CAPACIDAD[tipo]);
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const limited = await rateLimit(`ia-anular:${organizationId}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  if (tipo === "cliente") {
    const cliente = await db.client.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        company: true,
        _count: { select: { events: true, budgets: true, payments: true, invoices: true } },
      },
    });
    if (!cliente) return jsonError("El cliente no existe en esta empresa.", 404);
    const historial = cliente._count;
    if (historial.events + historial.budgets + historial.payments + historial.invoices > 0) {
      return jsonError("El cliente ya tiene historial (eventos, presupuestos, cobros o facturas): no se anula.", 409);
    }
    await db.client.delete({ where: { id: cliente.id } });
    await recordAudit({
      context: auth.context,
      action: "delete",
      entity: "Client",
      entityId: cliente.id,
      summary: `Anuló el cliente «${cliente.company?.trim() || cliente.name}» creado por la Carga con IA`,
      detail: { fields: { nombre: cliente.name, empresa: cliente.company, lote: lote || null } },
    });
    return Response.json({ ok: true, tipo, id: cliente.id });
  }

  const outcome = await annulInventoryItem(id, lote, auth.context);
  if (outcome.status === 404) return jsonError("El ítem no existe en esta empresa.", 404);
  if (outcome.status === 409) {
    return Response.json({ error: "El ítem está en uso (asignaciones, incidentes, combos o presupuestos): no se anula.", blockers: outcome.blockers }, { status: 409 });
  }
  return Response.json({ ok: true, tipo, id: outcome.id });
}
