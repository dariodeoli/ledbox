import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { parseInstallments as readStoredInstallments } from "@/lib/server/budget-portal";
import { isValidDayKey } from "@/lib/server/notifications";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TERMS = 600;
const MAX_INSTALLMENTS = 12;
const MAX_INSTALLMENT_LABEL = 60;

/** Datos del artículo de inventario que el panel dibuja junto al ítem del presupuesto. */
const INVENTORY_LINK_SELECT = { id: true, name: true, sku: true, category: true, quantity: true, status: true } as const;

/**
 * `GET /api/admin/budgets`: presupuestos de la empresa activa. Los escalares
 * incluyen el estado del portal (issue #12) — `publicToken`,
 * `publicTokenCreatedAt`, `approvedAt`, `approvedByName`, `approvalMethod`,
 * `approvalNote`, `revisionRequestedAt` y `revisionNote`— y el plan de pagos
 * (issue #14: `advanceAmount`, `paymentTerms`, `installmentsJson`).
 * `approvalIp` y `approvalUserAgent` quedan disponibles para el historial, pero
 * la lista no los dibuja. Nada de otra empresa entra en la respuesta.
 *
 * Los ítems viajan con su vínculo de inventario (`inventoryId` + el artículo
 * embebido, issue #18): el panel muestra qué ítem reserva stock al aprobar.
 *
 * La misma respuesta trae `budgetRequests`: las solicitudes del portal
 * (issue #14) con su presupuesto embebido, para que el módulo muestre la cola
 * de pendientes sin una segunda llamada.
 */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const [budgets, budgetRequests] = await Promise.all([
    db.budget.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        client: true,
        event: true,
        items: { include: { inventory: { select: INVENTORY_LINK_SELECT } } },
        payments: true,
      },
    }),
    db.budgetChangeRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        budget: {
          select: {
            id: true,
            title: true,
            status: true,
            subtotal: true,
            discount: true,
            total: true,
            client: { select: { name: true, company: true } },
            items: { select: { id: true, name: true, quantity: true, days: true, unitPrice: true } },
          },
        },
      },
    }),
  ]);
  return Response.json({ budgets, budgetRequests });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.clientId !== "string" || typeof body.title !== "string") return jsonError("Client and title are required.", 400);
  const client = await db.client.findFirst({ where: { id: body.clientId, organizationId }, select: { id: true } });
  if (!client) return jsonError("Client not found.", 404);
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  if (eventId) {
    const event = await db.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
    if (!event) return jsonError("Event not found.", 404);
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  // Vínculo con inventario (issue #18): solo artículos de la empresa activa.
  const inventoryIds = [...new Set(
    rawItems.flatMap((item) => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>).inventoryId : null;
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }),
  )];
  const inventoryItems = inventoryIds.length > 0
    ? await db.inventoryItem.findMany({ where: { id: { in: inventoryIds }, organizationId }, select: { id: true } })
    : [];
  const validInventoryIds = new Set(inventoryItems.map((item) => item.id));
  if (inventoryIds.some((id) => !validInventoryIds.has(id))) {
    return jsonError("El artículo de inventario vinculado no existe en esta empresa.", 400);
  }
  const items = rawItems.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const quantity = Number(value.quantity || 1);
    const days = Number(value.days || 1);
    const unitPrice = Number(value.unitPrice || 0);
    const costPrice = Number(value.costPrice || 0);
    const inventoryId = typeof value.inventoryId === "string" && validInventoryIds.has(value.inventoryId.trim()) ? value.inventoryId.trim() : null;
    if (!name || !Number.isFinite(quantity) || !Number.isFinite(days) || !Number.isFinite(unitPrice)) return [];
    return [{ id: randomUUID(), name, quantity: Math.max(1, quantity), days: Math.max(1, days), unitPrice: Math.max(0, unitPrice), costPrice: Math.max(0, costPrice), subtotal: Math.max(0, quantity * days * unitPrice), inventoryId }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Math.max(0, Number(body.discount || 0));
  const total = Math.max(0, subtotal - discount);
  const costEstimate = items.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  const budget = await db.budget.create({
    data: {
      id: randomUUID(),
      organizationId,
      clientId: client.id,
      eventId: eventId || undefined,
      title: body.title.trim(),
      status: "DRAFT",
      subtotal,
      discount,
      total,
      costEstimate,
      notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
      items: { create: items },
    },
    include: { client: true, event: true, items: { include: { inventory: { select: INVENTORY_LINK_SELECT } } } },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Budget",
    entityId: budget.id,
    summary: `Creó el presupuesto «${budget.title}» del cliente «${budget.client.name}»`,
    detail: {
      fields: {
        ...auditPick(budget, ["title", "status", "subtotal", "discount", "total", "costEstimate", "validUntil", "eventId"]),
        items: budget.items.length,
        ...(budget.items.some((item) => item.inventoryId)
          ? { inventario: budget.items.filter((item) => item.inventory?.name).map((item) => `${item.name} → ${item.inventory?.name}`) }
          : {}),
      },
    },
  });
  return Response.json({ budget }, { status: 201 });
}

type ParsedInstallments =
  | { ok: true; value: Array<{ label: string; amount: number; dueAt: string }> }
  | { ok: false; error: string };

/** Cuotas del plan de pagos: etiqueta, monto entero y vencimiento real (`YYYY-MM-DD`). */
function parseInstallments(raw: unknown): ParsedInstallments {
  if (!Array.isArray(raw)) return { ok: false, error: "Las cuotas deben venir en una lista." };
  if (raw.length > MAX_INSTALLMENTS) return { ok: false, error: `Podés cargar hasta ${MAX_INSTALLMENTS} cuotas.` };
  const value: Array<{ label: string; amount: number; dueAt: string }> = [];
  for (const [index, row] of raw.entries()) {
    const position = index + 1;
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, error: `La cuota ${position} tiene un formato inválido.` };
    const record = row as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!label) return { ok: false, error: `La cuota ${position} necesita una etiqueta.` };
    if (label.length > MAX_INSTALLMENT_LABEL) return { ok: false, error: `La etiqueta de la cuota ${position} no puede superar los ${MAX_INSTALLMENT_LABEL} caracteres.` };
    const amount = Number(record.amount);
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: `El monto de la cuota ${position} debe ser un entero mayor a cero.` };
    const dueAt = typeof record.dueAt === "string" ? record.dueAt.trim() : "";
    if (!isValidDayKey(dueAt)) return { ok: false, error: `El vencimiento de la cuota ${position} no es una fecha válida.` };
    value.push({ label, amount, dueAt });
  }
  return { ok: true, value };
}

/**
 * `PATCH /api/admin/budgets` (issues #14 y #18).
 *
 * - `kind: "item-link"`: vincula (o desvincula con `inventoryId: null`) un ítem
 *   del presupuesto con un artículo del inventario de la empresa activa. Solo el
 *   vínculo reserva stock al aprobar; sin vínculo el ítem no toca el inventario.
 * - Sin `kind`: plan de pagos del presupuesto. Anticipo (`advanceAmount`),
 *   condiciones (`paymentTerms`) y cuotas (`installmentsJson`, forma
 *   `[{ label, amount, dueAt }]`). El anticipo más las cuotas no pueden superar
 *   el total: el plan no promete más de lo que se cobra.
 */
export async function PATCH(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  if (!budgetId) return jsonError("budgetId is required.", 400);

  if (body.kind === "item-link") {
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!itemId) return jsonError("itemId is required.", 400);
    const rawInventoryId = typeof body.inventoryId === "string" ? body.inventoryId.trim() : "";
    const budget = await db.budget.findFirst({
      where: { id: budgetId, organizationId },
      select: {
        id: true,
        title: true,
        client: { select: { name: true, company: true } },
        items: { select: { id: true, name: true, inventoryId: true, inventory: { select: { name: true } } } },
      },
    });
    if (!budget) return jsonError("Budget not found.", 404);
    const item = budget.items.find((row) => row.id === itemId);
    if (!item) return jsonError("El ítem no pertenece a este presupuesto.", 404);
    const inventory = rawInventoryId
      ? await db.inventoryItem.findFirst({ where: { id: rawInventoryId, organizationId }, select: { id: true, name: true } })
      : null;
    if (rawInventoryId && !inventory) return jsonError("El artículo de inventario no existe en esta empresa.", 404);
    if (item.inventoryId === (inventory?.id ?? null)) {
      return Response.json({ item: { id: item.id, inventoryId: item.inventoryId }, unchanged: true });
    }
    const updated = await db.budgetItem.update({
      where: { id: item.id },
      data: { inventoryId: inventory?.id ?? null },
      select: { id: true, name: true, inventoryId: true, inventory: { select: INVENTORY_LINK_SELECT } },
    });
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Budget",
      entityId: budget.id,
      summary: inventory
        ? `Vinculó «${item.name}» del presupuesto «${budget.title}» con «${inventory.name}» del inventario`
        : `Quitó el vínculo con inventario de «${item.name}» del presupuesto «${budget.title}»`,
      detail: {
        changes: {
          inventoryId: {
            from: item.inventory?.name ?? null,
            to: inventory?.name ?? null,
          },
        },
      },
    });
    return Response.json({ item: updated });
  }

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: {
      id: true,
      title: true,
      total: true,
      advanceAmount: true,
      paymentTerms: true,
      installmentsJson: true,
      client: { select: { name: true, company: true } },
    },
  });
  if (!budget) return jsonError("Budget not found.", 404);

  const data: Prisma.BudgetUpdateInput = {};
  if (body.advanceAmount !== undefined) {
    const advance = Number(body.advanceAmount);
    if (!Number.isInteger(advance) || advance < 0) return jsonError("El anticipo debe ser un entero en guaraníes.", 400);
    if (advance > budget.total) return jsonError("El anticipo no puede superar el total del presupuesto.", 400);
    data.advanceAmount = advance;
  }
  if (body.paymentTerms !== undefined) {
    const terms = typeof body.paymentTerms === "string" ? body.paymentTerms.trim() : "";
    if (terms.length > MAX_TERMS) return jsonError(`Las condiciones de pago no pueden superar los ${MAX_TERMS} caracteres.`, 400);
    data.paymentTerms = terms || null;
  }
  const storedInstallments = readStoredInstallments(budget.installmentsJson);
  let installments = storedInstallments;
  if (body.installmentsJson !== undefined) {
    const parsed = parseInstallments(body.installmentsJson);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    installments = parsed.value;
    data.installmentsJson = parsed.value as unknown as Prisma.InputJsonValue;
  }

  const advance = typeof data.advanceAmount === "number" ? data.advanceAmount : budget.advanceAmount;
  const scheduled = installments.reduce((sum, installment) => sum + installment.amount, 0);
  if (advance + scheduled > budget.total) {
    return jsonError("El plan de pagos (anticipo más cuotas) no puede superar el total del presupuesto.", 400);
  }

  // El plan se compara completo (etiqueta, monto y vencimiento de cada cuota):
  // cambiar solo una fecha también es un cambio de plan —la sincronización de
  // pagos esperados y la auditoría tienen que verlo—.
  const installmentsSignature = (rows: Array<{ label: string; amount: number; dueAt: string | null }>) =>
    rows.map((row) => `${row.label} ${row.amount} ${row.dueAt ?? "sin fecha"}`).join(" · ") || "sin cuotas";
  const nextTerms = data.paymentTerms === undefined ? budget.paymentTerms : data.paymentTerms;
  const changes = auditChanges(
    { advanceAmount: budget.advanceAmount, paymentTerms: budget.paymentTerms },
    { advanceAmount: advance, paymentTerms: nextTerms },
    ["advanceAmount", "paymentTerms"],
  ) ?? {};
  const storedSignature = installmentsSignature(storedInstallments);
  const nextSignature = installmentsSignature(installments);
  if (storedSignature !== nextSignature) {
    changes.installments = { from: storedSignature, to: nextSignature };
  }
  if (Object.keys(changes).length === 0) {
    const current = await db.budget.findUnique({
      where: { id: budget.id },
      select: { id: true, advanceAmount: true, paymentTerms: true, installmentsJson: true, total: true },
    });
    return Response.json({ budget: current, unchanged: true });
  }

  const updated = await db.budget.update({
    where: { id: budget.id },
    data,
    select: {
      id: true,
      advanceAmount: true,
      paymentTerms: true,
      installmentsJson: true,
      total: true,
    },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Budget",
    entityId: budget.id,
    summary: `Definió el plan de pagos del presupuesto «${budget.title}» del cliente «${budget.client.company?.trim() || budget.client.name}»`,
    detail: { changes },
  });
  // El plan cambió: se sincronizan los pagos esperados (issue #28). Un
  // presupuesto sin aprobar no genera nada; lo confirmado nunca se pisa.
  await syncBudgetExpectedPayments({
    organizationId,
    budgetId: budget.id,
    actor: auth.context,
    reason: "cambio de plan de pagos",
  });
  return Response.json({ budget: updated });
}
