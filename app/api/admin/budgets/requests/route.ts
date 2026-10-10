import { selectionSubtotal } from "@/lib/quote-selection";
import { recalculateBudgetPaymentPlan } from "@/lib/server/budget-payment-plan";
import { withQuoteCommercialEdit, QuoteComparisonError } from "@/lib/server/quote-comparison";
import { db } from "@/lib/server/db";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { parseProposalPayload, portalBudgetOpen, resolveItemProposal } from "@/lib/server/budget-portal";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
import { clientDisplayName } from "@/lib/client-identity";
export const dynamic = "force-dynamic";

const MAX_NOTE = 600;

const KIND_LABEL: Record<string, string> = {
  items: "la propuesta de ítems",
  discount: "el pedido de rebaja",
  changes: "el pedido de cambios",
};

/**
 * `POST /api/admin/budgets/requests` (issue #14): el equipo resuelve una
 * solicitud del portal.
 *
 * - `accept` aplica el cambio al presupuesto: cantidades y días de los ítems
 *   (precio unitario fijo, subtotal y total recalculados según el descuento
 *   vigente) y/o el descuento. `counter` permite la contra-oferta: ítems
 *   ajustados por el equipo o el monto final de la rebaja. Todo en una
 *   transacción y auditado con el antes/después.
 * - `reject` no toca el presupuesto: deja la solicitud rechazada con la nota
 *   obligatoria que el cliente ve en su portal.
 *
 * Una solicitud resuelta no se vuelve a resolver (409). Nunca cruza empresas.
 */
export async function POST(request: Request) {
  try { return await resolveRequest(request); }
  catch (error) { if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status); throw error; }
}

async function resolveRequest(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const decision = body.decision === "accept" ? "accept" : body.decision === "reject" ? "reject" : "";
  const note = typeof body.responseNote === "string" ? body.responseNote.trim() : "";
  if (!requestId || !decision) return jsonError("Falta la solicitud o la decisión.", 400);
  if (note.length > MAX_NOTE) return jsonError(`La nota no puede superar los ${MAX_NOTE} caracteres.`, 400);
  if (decision === "reject" && note.length < 3) return jsonError("Indicá la nota del rechazo.", 400);

  const changeRequest = await db.budgetChangeRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      budget: {
        select: {
          id: true,
          title: true,
          status: true,
          subtotal: true,
          approvedAt: true,
          discount: true,
          total: true,
          revisionRequestedAt: true,
          client: { select: { name: true, company: true, tradeName: true, legalName: true } },
          items: { select: { id: true, name: true, quantity: true, days: true, unitPrice: true, excluded: true, subtotal: true } },
        },
      },
    },
  });
  if (!changeRequest) return jsonError("No encontramos esa solicitud.", 404);
  if (changeRequest.status !== "pending") return jsonError("Esta solicitud ya fue resuelta.", 409);

  const budget = changeRequest.budget;
  const clientLabel = clientDisplayName(budget.client);
  const kindLabel = KIND_LABEL[changeRequest.kind] ?? "la solicitud del portal";

  if (decision === "reject") {
    await withQuoteCommercialEdit(budget.id, organizationId, false, async (tx) => {
      const rejected = await tx.budgetChangeRequest.updateMany({
        where: { id: changeRequest.id, status: "pending" },
        data: { status: "rejected", resolvedAt: new Date(), resolvedByName: user.name, responseNote: note },
      });
      if (!rejected.count) throw new QuoteComparisonError(409, "Esta solicitud ya fue resuelta.");
      // Un pedido de cambios rechazado deja de estar pendiente para el cliente.
      if (changeRequest.kind === "changes" && budget.revisionRequestedAt) {
        await tx.budget.update({ where: { id: budget.id }, data: { revisionRequestedAt: null } });
      }
    });
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Budget",
      entityId: budget.id,
      summary: `Rechazó ${kindLabel} de «${clientLabel}» para el presupuesto «${budget.title}»: ${note}`,
      detail: { fields: { solicitud: changeRequest.kind, rechazo: note } },
    });
  } else {
    if (!portalBudgetOpen(budget.status)) {
      return jsonError("El presupuesto no está vigente: la solicitud no se puede aplicar.", 409);
    }
    const payload = parseProposalPayload(changeRequest.payload);
    const counter = body.counter && typeof body.counter === "object" && !Array.isArray(body.counter)
      ? (body.counter as Record<string, unknown>)
      : {};

    // Ítems: la propuesta (o la contra-oferta del equipo) se cruza contra los
    // ítems reales; el precio unitario lo pone el presupuesto, nunca el cliente.
    const appliedItems: Array<{ id: string; quantity: number; days: number; subtotal: number; excluded: boolean; name: string }> = [];
    if (changeRequest.kind === "items" || payload.items.length > 0) {
      const rawItems = counter.items !== undefined ? counter.items : payload.items;
      const proposal = resolveItemProposal(budget.items, rawItems, { requireChange: false });
      if (!proposal.ok) return jsonError(proposal.error, 400);
      const byId = new Map(budget.items.map((item) => [item.id, item]));
      for (const row of proposal.value) {
        const item = byId.get(row.id);
        if (!item) continue;
        appliedItems.push({ id: item.id, quantity: row.quantity, days: row.days, excluded: row.excluded, subtotal: selectionSubtotal({ ...item, ...row }), name: item.name });
      }
    }
    const appliedById = new Map(appliedItems.map((item) => [item.id, item]));
    const nextSubtotal = budget.items.reduce((sum, item) => sum + (appliedById.get(item.id)?.subtotal ?? item.subtotal), 0);

    // Descuento: la contra-oferta manda; si no, se recalcula el pedido contra
    // el subtotal que queda después de aplicar los ítems.
    let nextDiscount = Math.min(budget.discount, nextSubtotal);
    let appliedDiscount: number | null = null;
    const counterAmountRaw = counter.discountAmount;
    if (counterAmountRaw !== undefined) {
      const counterAmount = Number(counterAmountRaw);
      if (!Number.isInteger(counterAmount) || counterAmount <= 0) {
        return jsonError("La contra-oferta del descuento debe ser un monto entero mayor a cero.", 400);
      }
      if (counterAmount > nextSubtotal) return jsonError("La contra-oferta no puede superar el subtotal del presupuesto.", 400);
      nextDiscount = counterAmount;
      appliedDiscount = counterAmount;
    } else if (payload.discount) {
      const amount = payload.discount.type === "percent"
        ? Math.round((nextSubtotal * payload.discount.value) / 100)
        : Math.min(payload.discount.amount, nextSubtotal);
      if (amount <= 0) return jsonError("El descuento pedido no alcanza un monto válido.", 400);
      nextDiscount = amount;
      appliedDiscount = amount;
    }

    const nextTotal = Math.max(0, nextSubtotal - nextDiscount);
    const changesOffer = appliedItems.length > 0 || appliedDiscount !== null;
    const resolvesRevision = changeRequest.kind === "changes";
    const nextStatus = changesOffer && budget.status !== "APPROVED" ? "NEGOTIATING" : budget.status;

    await withQuoteCommercialEdit(budget.id, organizationId, true, async (tx) => {
      const fresh = await tx.budget.findUniqueOrThrow({ where: { id: budget.id }, select: { subtotal: true, discount: true, items: { select: { id: true, name: true, quantity: true, days: true, unitPrice: true, excluded: true, subtotal: true } } } });
      const stable = (rows: typeof fresh.items) => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
      if (fresh.subtotal !== budget.subtotal || fresh.discount !== budget.discount || stable(fresh.items) !== stable(budget.items)) throw new QuoteComparisonError(409, "El presupuesto cambió. Actualizá la solicitud antes de resolverla.");
      const freshRequest = await tx.budgetChangeRequest.findUniqueOrThrow({ where: { id: changeRequest.id }, select: { status: true, payload: true } });
      if (freshRequest.status !== "pending" || JSON.stringify(freshRequest.payload) !== JSON.stringify(changeRequest.payload)) throw new QuoteComparisonError(409, "La selección cambió. Actualizá la solicitud antes de resolverla.");
      const claimed = await tx.budgetChangeRequest.updateMany({ where: { id: changeRequest.id, status: "pending" }, data: { status: "accepted" } });
      if (!claimed.count) throw new QuoteComparisonError(409, "Esta solicitud ya fue resuelta.");
      for (const item of appliedItems) {
        await tx.budgetItem.update({
          where: { id: item.id },
          data: { quantity: item.quantity, days: item.days, excluded: item.excluded, subtotal: item.subtotal },
        });
      }
      await tx.budget.update({
        where: { id: budget.id },
        data: {
          status: nextStatus,
          ...(changesOffer ? { subtotal: nextSubtotal, total: nextTotal } : {}),
          ...(changesOffer ? { discount: nextDiscount } : {}),
          ...(resolvesRevision ? { revisionRequestedAt: null } : {}),
        },
      });
      await recalculateBudgetPaymentPlan(tx, budget.id);
      await tx.budgetChangeRequest.update({
        where: { id: changeRequest.id },
        data: { status: "accepted", resolvedAt: new Date(), resolvedByName: user.name, responseNote: note || null },
      });
    });

    const changes = auditChanges(
      { subtotal: budget.subtotal, discount: budget.discount, total: budget.total, status: budget.status },
      { subtotal: nextSubtotal, discount: nextDiscount, total: nextTotal, status: nextStatus },
      ["subtotal", "discount", "total", "status"],
    );
    const itemSummary = appliedItems.map((item) => `${item.name} ${item.excluded ? "Retirado / no incluido" : `${item.quantity}×${item.days}d`}`).join(" · ");
    const changeSummary = [
      nextSubtotal !== budget.subtotal ? `subtotal ${budget.subtotal} → ${nextSubtotal}` : null,
      nextDiscount !== budget.discount ? `descuento ${budget.discount} → ${nextDiscount}` : null,
      nextTotal !== budget.total ? `total ${budget.total} → ${nextTotal}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(", ");
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Budget",
      entityId: budget.id,
      summary: `Aceptó ${kindLabel} de «${clientLabel}» para el presupuesto «${budget.title}»${
        changeSummary ? ` (${changeSummary})` : ""
      }`,
      detail: {
        ...(changes ? { changes } : {}),
        fields: {
          solicitud: changeRequest.kind,
          ...(appliedItems.length > 0 ? { items: itemSummary } : {}),
          ...(note ? { respuesta: note } : {}),
        },
      },
    });
  }

  const [updatedRequest, updatedBudget] = await Promise.all([
    db.budgetChangeRequest.findUnique({
      where: { id: changeRequest.id },
      select: {
        id: true,
        budgetId: true,
        kind: true,
        status: true,
        payload: true,
        note: true,
        requestedByName: true,
        requestedByEmail: true,
        createdAt: true,
        resolvedAt: true,
        resolvedByName: true,
        responseNote: true,
      },
    }),
    db.budget.findUnique({
      where: { id: budget.id },
      select: {
        id: true,
        status: true,
        subtotal: true,
        discount: true,
        total: true,
        advanceAmount: true,
        paymentTerms: true,
        installmentsJson: true,
        revisionRequestedAt: true,
        items: { select: { id: true, name: true, quantity: true, days: true, unitPrice: true, excluded: true, subtotal: true } },
      },
    }),
  ]);
  return Response.json({ request: updatedRequest, budget: updatedBudget });
}
