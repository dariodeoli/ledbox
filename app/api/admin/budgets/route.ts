import { randomUUID } from "node:crypto";
import { CommercialStatus, type Prisma } from "@prisma/client";
import { budgetStatusLabel } from "@/lib/admin-format";
import { INVOICE_TAX_TYPES } from "@/lib/fiscal";
import type { AdminInvoiceTaxType } from "@/lib/admin-types";
import { requireAdminContext, type AdminContext } from "@/lib/server/tenancy";
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
/** Campos del cliente (issue #65). */
const MAX_WARRANTY = 400;
const MAX_NOTES = 2000;

/** Monto entero ≥ 0 (PYG) del body; `null` si no vino. */
function moneyField(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, Math.round(amount));
}

/** Día `YYYY-MM-DD` del body a fecha real (mediodía de Asunción); `null` si no vino. */
function dayField(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null };
  if (value === null || value === "") return { ok: true, value: null };
  const text = typeof value === "string" ? value.trim() : "";
  if (!isValidDayKey(text)) return { ok: false };
  return { ok: true, value: new Date(`${text}T12:00:00.000Z`) };
}

/** Condición de IVA del presupuesto (issue #65): la misma lista del registro fiscal. */
function ivaField(value: unknown): AdminInvoiceTaxType | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (INVOICE_TAX_TYPES as readonly string[]).includes(text) ? (text as AdminInvoiceTaxType) : undefined;
}

/** Texto recortado a un tope; `null` si queda vacío. */
function textField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

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
        // Adjuntos internos (issue #65): metadatos, el binario se sirve aparte
        // con sesión (`/api/admin/budgets/attachments/[id]`).
        attachments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, budgetId: true, name: true, mime: true, size: true, uploadedByName: true, createdAt: true },
        },
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

type ParsedBudgetItem = {
  /** Id del ítem existente cuando el body lo manda (PATCH de ítems); `null` si es nuevo. */
  id: string | null;
  name: string;
  quantity: number;
  days: number;
  unitPrice: number;
  costPrice: number;
  subtotal: number;
  inventoryId: string | null;
};

/**
 * Ítems del presupuesto desde el body (issue #65): lo usan el alta y el PATCH de
 * ítems. El id se conserva solo si viene como texto (el PATCH lo valida contra
 * los ítems reales del presupuesto).
 */
function parseBudgetItems(rawItems: unknown[], validInventoryIds: Set<string>): ParsedBudgetItem[] {
  return rawItems.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const quantity = Number(value.quantity || 1);
    const days = Number(value.days || 1);
    const unitPrice = Number(value.unitPrice || 0);
    const costPrice = Number(value.costPrice || 0);
    const inventoryId = typeof value.inventoryId === "string" && validInventoryIds.has(value.inventoryId.trim()) ? value.inventoryId.trim() : null;
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
    if (!name || !Number.isFinite(quantity) || !Number.isFinite(days) || !Number.isFinite(unitPrice)) return [];
    return [{
      id,
      name,
      quantity: Math.max(1, quantity),
      days: Math.max(1, days),
      unitPrice: Math.max(0, unitPrice),
      costPrice: Math.max(0, costPrice),
      subtotal: Math.max(0, quantity * days * unitPrice),
      inventoryId,
    }];
  });
}

/** Vínculos de inventario válidos de la empresa activa para los ítems del body. */
async function resolveInventoryLinks(rawItems: unknown[], organizationId: string): Promise<Set<string> | null> {
  const inventoryIds = [...new Set(
    rawItems.flatMap((item) => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>).inventoryId : null;
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }),
  )];
  const inventoryItems = inventoryIds.length > 0
    ? await db.inventoryItem.findMany({ where: { id: { in: inventoryIds }, organizationId }, select: { id: true } })
    : [];
  const valid = new Set(inventoryItems.map((item) => item.id));
  return inventoryIds.some((id) => !valid.has(id)) ? null : valid;
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
  const validInventoryIds = await resolveInventoryLinks(rawItems, organizationId);
  if (!validInventoryIds) {
    return jsonError("El artículo de inventario vinculado no existe en esta empresa.", 400);
  }
  const items = parseBudgetItems(rawItems, validInventoryIds).map((item) => ({ ...item, id: randomUUID() }));
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Math.max(0, Number(body.discount || 0));
  const total = Math.max(0, subtotal - discount);
  const costEstimate = items.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  // Costos internos y campos del cliente (issue #65): el presupuesto nace en
  // Borrador con lo que cargó el dueño; el precio final se define antes de enviar.
  const materialCost = moneyField(body.materialCost) ?? 0;
  const laborCost = moneyField(body.laborCost) ?? 0;
  const delivery = dayField(body.deliveryAt);
  if (!delivery.ok) return jsonError("La fecha de entrega no es válida.", 400);
  const valid = dayField(body.validUntil);
  if (!valid.ok) return jsonError("La vigencia no es válida.", 400);
  const ivaType = ivaField(body.ivaType);
  if (body.ivaType !== undefined && ivaType === undefined) return jsonError("La condición de IVA no es válida.", 400);
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
      materialCost,
      laborCost,
      deliveryAt: delivery.value,
      validUntil: valid.value,
      ivaType: ivaType ?? undefined,
      warranty: textField(body.warranty, MAX_WARRANTY),
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
        ...auditPick(budget, ["title", "status", "subtotal", "discount", "total", "costEstimate", "materialCost", "laborCost", "deliveryAt", "validUntil", "ivaType", "eventId"]),
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
 * `PATCH /api/admin/budgets` (issues #14, #18 y #26).
 *
 * - `status`: estado comercial desde el tablero (issue #26). Set idempotente,
 *   con la capacidad `budgets.write` y auditoría; no toca la aprobación del
 *   portal (`approvedAt`/`approvalMethod`): la evidencia de aprobación sigue
 *   siendo del flujo de `/api/admin/budgets/approval` y del portal.
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

  if (body.status !== undefined) {
    const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (!Object.values(CommercialStatus).includes(status as CommercialStatus)) return jsonError("Invalid budget status.", 400);
    const budget = await db.budget.findFirst({
      where: { id: budgetId, organizationId },
      select: { id: true, title: true, status: true, client: { select: { name: true, company: true } } },
    });
    if (!budget) return jsonError("Budget not found.", 404);
    if (budget.status === status) {
      return Response.json({ budget: { id: budget.id, status: budget.status }, unchanged: true });
    }
    const updated = await db.budget.update({
      where: { id: budget.id },
      data: { status: status as CommercialStatus },
      select: { id: true, status: true },
    });
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Budget",
      entityId: budget.id,
      summary: `Cambió el estado del presupuesto «${budget.title}» del cliente «${budget.client.company?.trim() || budget.client.name}» a ${budgetStatusLabel(updated.status)}`,
      detail: { changes: { status: { from: budget.status, to: updated.status } } },
    });
    return Response.json({ budget: updated });
  }

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

  if (body.kind === "items") {
    return patchBudgetItems({ context: auth.context, organizationId, budgetId, body });
  }

  if (body.kind === "commercial") {
    return patchBudgetCommercial({ context: auth.context, organizationId, budgetId, body });
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

/**
 * `PATCH kind: "items"` (issue #65): reemplaza los ítems del presupuesto —nombre,
 * cantidades, días, precio y costo unitario— y recalcula subtotal, total y
 * `costEstimate`. El descuento vigente se mantiene; si ya no entra en la suma
 * nueva, se recorta para que el total no quede negativo (se informa en la
 * auditoría). Solo se puede tocar mientras el presupuesto esté en juego y sin
 * aprobar: lo aprobado por el cliente no se reescribe.
 */
async function patchBudgetItems(params: {
  context: AdminContext;
  organizationId: string;
  budgetId: string;
  body: Record<string, unknown>;
}): Promise<Response> {
  const { context, organizationId, budgetId, body } = params;
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      approvedAt: true,
      discount: true,
      subtotal: true,
      total: true,
      client: { select: { name: true, company: true } },
      items: { select: { id: true, name: true } },
    },
  });
  if (!budget) return jsonError("Budget not found.", 404);
  if (budget.approvedAt) return jsonError("El presupuesto ya está aprobado: sus ítems no se pueden cambiar.", 409);
  if (budget.status === "LOST" || budget.status === "CANCELLED") return jsonError("Este presupuesto ya no está en juego.", 409);

  const rawItems = Array.isArray(body.items) ? body.items : null;
  if (!rawItems) return jsonError("Mandá la lista de ítems del presupuesto.", 400);
  const validInventoryIds = await resolveInventoryLinks(rawItems, organizationId);
  if (!validInventoryIds) return jsonError("El artículo de inventario vinculado no existe en esta empresa.", 400);
  const parsed = parseBudgetItems(rawItems, validInventoryIds);
  if (parsed.length === 0) return jsonError("El presupuesto necesita al menos un ítem con nombre.", 400);

  const existingIds = new Set(budget.items.map((item) => item.id));
  if (parsed.some((item) => item.id && !existingIds.has(item.id))) {
    return jsonError("Uno de los ítems no pertenece a este presupuesto.", 400);
  }

  const subtotal = parsed.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Math.min(budget.discount, subtotal);
  const total = Math.max(0, subtotal - discount);
  const costEstimate = parsed.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  const keepIds = new Set(parsed.flatMap((item) => (item.id ? [item.id] : [])));

  await db.$transaction(async (tx) => {
    await tx.budgetItem.deleteMany({ where: { budgetId: budget.id, id: { notIn: [...keepIds] } } });
    for (const item of parsed) {
      const data = {
        name: item.name,
        quantity: item.quantity,
        days: item.days,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        subtotal: item.subtotal,
        inventoryId: item.inventoryId,
      };
      if (item.id && existingIds.has(item.id)) {
        await tx.budgetItem.update({ where: { id: item.id }, data });
      } else {
        await tx.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, ...data } });
      }
    }
    await tx.budget.update({ where: { id: budget.id }, data: { subtotal, discount, total, costEstimate } });
  });

  await recordAudit({
    context,
    action: "update",
    entity: "Budget",
    entityId: budget.id,
    summary: `Actualizó los ítems del presupuesto «${budget.title}» del cliente «${budget.client.company?.trim() || budget.client.name}»`,
    detail: {
      changes: {
        items: { from: budget.items.length, to: parsed.length },
        subtotal: { from: budget.subtotal, to: subtotal },
        discount: { from: budget.discount, to: discount },
        total: { from: budget.total, to: total },
      },
    },
  });

  const updated = await db.budget.findUnique({
    where: { id: budget.id },
    include: { items: { include: { inventory: { select: INVENTORY_LINK_SELECT } } } },
  });
  return Response.json({ budget: updated });
}

/**
 * `PATCH kind: "commercial"` (issue #65): precio final y datos de la versión que
 * ve el cliente. El **precio final** es `total`: se define con el descuento
 * (no puede superar la suma de ítems; para un precio mayor primero se ajustan
 * los precios unitarios con `kind: "items"`). Suma vigencia, fecha de entrega,
 * condición de IVA, garantía y observaciones. Los costos internos (materiales y
 * mano de obra) se pueden corregir siempre —son del dueño, no del cliente—; los
 * datos que el cliente ya vio quedan congelados una vez aprobado el presupuesto.
 */
async function patchBudgetCommercial(params: {
  context: AdminContext;
  organizationId: string;
  budgetId: string;
  body: Record<string, unknown>;
}): Promise<Response> {
  const { context, organizationId, budgetId, body } = params;
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      approvedAt: true,
      subtotal: true,
      discount: true,
      total: true,
      materialCost: true,
      laborCost: true,
      deliveryAt: true,
      validUntil: true,
      ivaType: true,
      warranty: true,
      notes: true,
      client: { select: { name: true, company: true } },
    },
  });
  if (!budget) return jsonError("Budget not found.", 404);

  const data: Prisma.BudgetUpdateInput = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  // Costos internos: siempre editables (registro del dueño).
  if (body.materialCost !== undefined) {
    const materialCost = moneyField(body.materialCost);
    if (materialCost === null) return jsonError("El costo de materiales debe ser un entero en guaraníes.", 400);
    data.materialCost = materialCost;
    if (materialCost !== budget.materialCost) changes.materialCost = { from: budget.materialCost, to: materialCost };
  }
  if (body.laborCost !== undefined) {
    const laborCost = moneyField(body.laborCost);
    if (laborCost === null) return jsonError("El costo de mano de obra debe ser un entero en guaraníes.", 400);
    data.laborCost = laborCost;
    if (laborCost !== budget.laborCost) changes.laborCost = { from: budget.laborCost, to: laborCost };
  }

  // Datos de la versión del cliente: se congelan con la aprobación registrada.
  const clientFields = ["discount", "validUntil", "deliveryAt", "ivaType", "warranty", "notes"] as const;
  const touchesClientFields = clientFields.some((field) => body[field] !== undefined);
  if (touchesClientFields) {
    if (budget.approvedAt) return jsonError("El presupuesto ya está aprobado: la versión del cliente no se cambia.", 409);
    if (budget.status === "LOST" || budget.status === "CANCELLED") return jsonError("Este presupuesto ya no está en juego.", 409);
  }

  if (body.discount !== undefined) {
    const discount = moneyField(body.discount);
    if (discount === null) return jsonError("El descuento debe ser un entero en guaraníes.", 400);
    if (discount > budget.subtotal) {
      return jsonError("El precio final no puede quedar por debajo de cero: el descuento supera la suma de los ítems.", 400);
    }
    data.discount = discount;
    data.total = Math.max(0, budget.subtotal - discount);
    if (discount !== budget.discount) changes.discount = { from: budget.discount, to: discount };
  }
  if (body.validUntil !== undefined) {
    const valid = dayField(body.validUntil);
    if (!valid.ok) return jsonError("La vigencia no es válida.", 400);
    data.validUntil = valid.value;
  }
  if (body.deliveryAt !== undefined) {
    const delivery = dayField(body.deliveryAt);
    if (!delivery.ok) return jsonError("La fecha de entrega no es válida.", 400);
    data.deliveryAt = delivery.value;
  }
  if (body.ivaType !== undefined) {
    const ivaType = ivaField(body.ivaType);
    if (ivaType === undefined) return jsonError("La condición de IVA no es válida.", 400);
    data.ivaType = ivaType;
  }
  if (body.warranty !== undefined) {
    data.warranty = textField(body.warranty, MAX_WARRANTY);
  }
  if (body.notes !== undefined) {
    data.notes = textField(body.notes, MAX_NOTES);
  }

  if (Object.keys(data).length === 0 || Object.keys(changes).length === 0) {
    const current = await db.budget.findUnique({
      where: { id: budget.id },
      select: {
        id: true,
        subtotal: true,
        discount: true,
        total: true,
        materialCost: true,
        laborCost: true,
        deliveryAt: true,
        validUntil: true,
        ivaType: true,
        warranty: true,
        notes: true,
      },
    });
    return Response.json({ budget: current, unchanged: true });
  }

  const updated = await db.budget.update({
    where: { id: budget.id },
    data,
    select: {
      id: true,
      subtotal: true,
      discount: true,
      total: true,
      materialCost: true,
      laborCost: true,
      deliveryAt: true,
      validUntil: true,
      ivaType: true,
      warranty: true,
      notes: true,
    },
  });
  await recordAudit({
    context,
    action: "update",
    entity: "Budget",
    entityId: budget.id,
    summary: `Definió el precio y las condiciones del presupuesto «${budget.title}» del cliente «${budget.client.company?.trim() || budget.client.name}»`,
    detail: { fields: changes },
  });
  return Response.json({ budget: updated });
}
