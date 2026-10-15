import { withQuoteApproval, withQuoteCommercialEdit, QuoteComparisonError } from "@/lib/server/quote-comparison";
import { randomUUID } from "node:crypto";
import { stableOrderBudgetItems } from "@/lib/budget-item-order";
import { budgetItemError } from "@/lib/budget-items";
import { budgetMoneyValid, defaultDepositPlanRows, resolveBudgetPaymentPlan } from "@/lib/budget-payment-plan";
import { newBudgetDefaults, securityDepositPublic } from "@/lib/budget-security-deposit";
import { getRentalSettings } from "@/lib/server/rental-settings";
import { suggestDepositForOrder } from "@/lib/server/rental-settlement";
import { isDepositPurpose } from "@/lib/rental-charges";
import { SecurityDepositError, equipmentReturnByEvent, setBudgetSecurityDeposit, transitionBudgetSecurityDeposit } from "@/lib/server/security-deposit";
import { assertBudgetPlanLedger, recalculateBudgetPaymentPlan, validateBudgetPlanAccounts } from "@/lib/server/budget-payment-plan";
import { CommercialStatus, Prisma } from "@prisma/client";
import { budgetStatusLabel } from "@/lib/admin-format";
import { INVOICE_TAX_TYPES } from "@/lib/fiscal";
import type { AdminInvoiceTaxType } from "@/lib/admin-types";
import { requireAdminContext, type AdminContext } from "@/lib/server/tenancy";
import { roleCan } from "@/lib/server/permissions";
import { findMatchingClient, leadStatusAfterBudget, resolveClientFromLead } from "@/lib/server/lead-client";
import { db } from "@/lib/server/db";
import { assertLive, trashErrorResponse } from "@/lib/server/trash";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { readRentalDays, snapshotsForLines } from "@/lib/server/line-pricing";
import { parseInstallments as readStoredInstallments } from "@/lib/server/budget-portal";
import { dayKeyOf, isValidDayKey } from "@/lib/server/notifications";
import { syncBudgetExpectedPayments } from "@/lib/server/expected-payments";
import {
  budgetCommercialChanges,
  budgetCommercialGuard,
  touchesBudgetClientFields,
  type BudgetCommercialSnapshot,
} from "@/lib/budget-commercial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TERMS = 600;
/** Campos del cliente (issue #65). */
const MAX_WARRANTY = 400;
const MAX_NOTES = 2000;

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
const INVENTORY_LINK_SELECT = { id: true, name: true, sku: true, category: true, quantity: true, status: true, billingUnit: true, imageUrl: true, imageMime: true, updatedAt: true, listPrice: true, priceTiers: { where: { audience: "RETAIL" as const }, select: { audience: true, fromDays: true, mode: true, price: true }, orderBy: { fromDays: "asc" as const } }, _count: { select: { components: true } } } as const;

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
  const [rental, budgets, budgetRequests] = await Promise.all([
    getRentalSettings(organizationId),
    db.budget.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        client: { include: { logo: { select: { updatedAt: true } } } },
        event: true,
        lead: { select: { id: true, createdAt: true } },
        items: { include: { inventory: { select: INVENTORY_LINK_SELECT } } },
        expectedPayments: { where: { status: { not: "CANCELLED" } }, orderBy: [{ installmentNumber: "asc" }, { createdAt: "asc" }], select: { status: true, concept: true, label: true, amount: true, paidAmount: true } },
        payments: true,
        // Adjuntos internos (issue #65): metadatos, el binario se sirve aparte
        // con sesión (`/api/admin/budgets/attachments/[id]`).
        referenceLinks: { where: { organizationId }, orderBy: { createdAt: "asc" } },
        attachments: {
          orderBy: { createdAt: "desc" },
          select: { clientVisible: true, id: true, budgetId: true, name: true, mime: true, size: true, uploadedByName: true, createdAt: true },
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
            client: { select: { name: true, company: true, tradeName: true, legalName: true } },
            items: { select: { id: true, sortOrder: true, name: true, quantity: true, days: true, unitPrice: true, excluded: true } },
          },
        },
      },
    }),
  ]);
  const returns = await equipmentReturnByEvent(organizationId, [...new Set(budgets.flatMap((budget) => (budget.eventId && budget.securityDeposit ? [budget.eventId] : [])))]);
  return Response.json({ rentalDefaults: { depositPercent: rental.depositPercent, securityDepositDefault: rental.securityDepositDefault, securityDepositMode: rental.securityDepositMode, securityDepositCalc: rental.securityDepositCalc, securityDepositPercent: rental.securityDepositPercent }, budgets: budgets.map((budget) => {
    const { logo, ...client } = budget.client;
    return { ...budget, equipmentReturn: budget.eventId ? returns.get(budget.eventId) ?? null : null, client: { ...client, logoUpdatedAt: logo?.updatedAt.toISOString() ?? null }, items: stableOrderBudgetItems(budget.items) };
  }), budgetRequests: budgetRequests.map((request) => ({ ...request, budget: { ...request.budget, items: stableOrderBudgetItems(request.budget.items) } })) });
}

type ParsedBudgetItem = {
  notes: string | null;
  /** Id del ítem existente cuando el body lo manda (PATCH de ítems); `null` si es nuevo. */
  id: string | null;
  name: string;
  quantity: number;
  days: number;
  unitPrice: number;
  costPrice: number;
  subtotal: number;
  inventoryId: string | null;
  /** Días reales del alquiler cuando el panel los manda con un producto (el escalón «total» guarda días = 1). */
  rentalDays: number | null;
};

/**
 * Ítems del presupuesto desde el body (issue #65): lo usan el alta y el PATCH de
 * ítems. El id se conserva solo si viene como texto (el PATCH lo valida contra
 * los ítems reales del presupuesto).
 */
function parseBudgetItems(rawItems: unknown[], links: InventoryLinks): ParsedBudgetItem[] {
  const validInventoryIds = links.valid;
  return rawItems.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if ([value.quantity, value.days, value.unitPrice, value.costPrice].some((field) => typeof field === "boolean")) return [];
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const quantity = Number(value.quantity ?? 1);
    const days = Number(value.days ?? 1);
    const unitPrice = Number(value.unitPrice ?? 0);
    const costPrice = Number(value.costPrice ?? 0);
    const inventoryId = typeof value.inventoryId === "string" && validInventoryIds.has(value.inventoryId.trim()) ? value.inventoryId.trim() : null;
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
    if (budgetItemError({ name, quantity, days, unitPrice, costPrice })) return [];
    // Producto «por evento»: una sola unidad de tiempo, sin importar lo que mande el cliente.
    const billed = inventoryId && links.perEvent.has(inventoryId) ? 1 : days;
    return [{
      notes: textField(value.notes, 400),
      id,
      name,
      quantity: Math.max(1, quantity),
      days: Math.max(1, billed),
      unitPrice: Math.max(0, unitPrice),
      costPrice: Math.max(0, costPrice),
      subtotal: Math.max(0, quantity * billed * unitPrice),
      inventoryId,
      rentalDays: inventoryId ? readRentalDays(value.rentalDays) : null,
    }];
  });
}

/** Vínculos de inventario válidos de la empresa activa para los ítems del body. */
type InventoryLinks = { valid: Set<string>; perEvent: Set<string> };

async function resolveInventoryLinks(rawItems: unknown[], organizationId: string): Promise<InventoryLinks | null> {
  const inventoryIds = [...new Set(
    rawItems.flatMap((item) => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>).inventoryId : null;
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }),
  )];
  const inventoryItems = inventoryIds.length > 0
    ? await db.inventoryItem.findMany({ where: { id: { in: inventoryIds }, organizationId }, select: { id: true, billingUnit: true } })
    : [];
  const valid = new Set(inventoryItems.map((item) => item.id));
  const perEvent = new Set(inventoryItems.filter((item) => item.billingUnit === "EVENT").map((item) => item.id));
  return inventoryIds.some((id) => !valid.has(id)) ? null : { valid, perEvent };
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  const discount = body.discount === undefined ? 0 : body.discount;
  if (typeof discount !== "number" || !budgetMoneyValid(discount)) return jsonError("El descuento debe ser un entero no negativo en guaraníes dentro del límite Int.", 400);
  const materialCost = body.materialCost === undefined ? 0 : body.materialCost;
  const laborCost = body.laborCost === undefined ? 0 : body.laborCost;
  if (typeof materialCost !== "number" || !budgetMoneyValid(materialCost) || typeof laborCost !== "number" || !budgetMoneyValid(laborCost)) return jsonError("Los costos deben ser enteros no negativos en guaraníes dentro del límite Int.", 400);
  const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
  const clientIdInput = typeof body.clientId === "string" ? body.clientId : "";
  if ((!clientIdInput && !leadId) || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 160) {
    return jsonError("Elegí el cliente y escribí el título del presupuesto.", 400);
  }
  // Lead → Presupuesto: el lead debe ser de la empresa activa (404 si no lo es).
  const lead = leadId ? await db.lead.findFirst({ where: { id: leadId, organizationId } }) : null;
  if (leadId && !lead) return jsonError("El lead no existe en esta empresa.", 404);
  // Sin `clientId`, el cliente sale del lead (se reutiliza o se crea, sin duplicar).
  // Crear el cliente exige además `clients.write`.
  if (!clientIdInput && lead && !roleCan(auth.context.user.role, "clients.write")) {
    const known = await db.client.findMany({ where: { organizationId, OR: [{ email: { not: null } }, { phone: { not: null } }] }, take: 1000, select: { id: true, name: true, company: true, email: true, phone: true } });
    if (!findMatchingClient(known, lead)) return jsonError("El lead todavía no es cliente: pedí a alguien con permiso de clientes que lo convierta.", 403);
  }
  if (clientIdInput) {
    const client = await db.client.findFirst({ where: { id: clientIdInput, organizationId }, select: { id: true } });
    if (!client) return jsonError("El cliente no existe en esta empresa.", 404);
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  if (eventId) {
    const event = await db.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
    if (!event) return jsonError("El evento no existe en esta empresa.", 404);
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  // Vínculo con inventario (issue #18): solo artículos de la empresa activa.
  const validInventoryIds = await resolveInventoryLinks(rawItems, organizationId);
  if (!validInventoryIds) {
    return jsonError("El artículo de inventario vinculado no existe en esta empresa.", 400);
  }
  const items = parseBudgetItems(rawItems, validInventoryIds).map((item) => ({ ...item, id: randomUUID() }));
  const snapshots = await snapshotsForLines(organizationId, items.map((item) => ({ key: item.id, inventoryId: item.inventoryId, rentalDays: item.rentalDays })));
  // Sin ítems no hay presupuesto (issue #132): el required del form se puede
  // saltear y el API no puede aceptar un documento vacío.
  if (items.length === 0) {
    return jsonError("El presupuesto necesita al menos un ítem con nombre.", 400);
  }
  if (items.length !== rawItems.length) return jsonError("Completá nombre, cantidad, duración y montos válidos de todos los ítems.", 400);
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const total = subtotal - discount;
  if (!budgetMoneyValid(subtotal) || discount > subtotal) return jsonError("Subtotal o descuento inválido: revisá el límite Int.", 400);
  const costEstimate = items.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  if (!budgetMoneyValid(costEstimate)) return jsonError("El costo agregado de los ítems supera el límite Int.", 400);
  // Costos internos y campos del cliente (issue #65): el presupuesto nace en
  // Borrador con lo que cargó el dueño; el precio final se define antes de enviar.
  const delivery = dayField(body.deliveryAt);
  if (!delivery.ok) return jsonError("La fecha de entrega no es válida.", 400);
  const valid = dayField(body.validUntil);
  if (!valid.ok) return jsonError("La vigencia no es válida.", 400);
  const ivaType = ivaField(body.ivaType);
  if (body.ivaType !== undefined && ivaType === undefined) return jsonError("La condición de IVA no es válida.", 400);
  const title = body.title.trim();
  // Seña por empresa: sin plan en el body, nace «Seña N %» + «Saldo» con el
  // porcentaje de Ajustes (o el `depositPercent` que eligió la persona). Un
  // `installmentsJson` explícito (o `null` = sin plan) se respeta tal cual.
  const rental = await getRentalSettings(organizationId);
  // Garantía según la política de la empresa: solo se propone sola si es «siempre» (fijo, % o por producto).
  const autoDeposit = await suggestDepositForOrder(organizationId, { total, lines: items.map((item) => ({ inventoryId: item.inventoryId ?? null, quantity: item.quantity })) }, { auto: true });
  const defaults = newBudgetDefaults(body, total, { ...rental, securityDepositDefault: autoDeposit });
  if (!defaults.ok) return jsonError(defaults.error, 400);
  const installments = defaults.installments ? (defaults.installments as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  // Depósito de garantía: opcional, aparte del total; default de la empresa.
  const securityDeposit = defaults.securityDeposit;
  // Presupuestos que el lead ya tenía: no bloquean el alta, la UI los avisa.
  const existingBudgets = lead
    ? await db.budget.findMany({ where: { organizationId, leadId: lead.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, createdAt: true } })
    : [];
  const created = await db.$transaction(async (tx) => {
    let clientId = clientIdInput;
    let clientCreated: { id: string; name: string; company: string | null } | null = null;
    if (!clientId && lead) {
      const resolved = await resolveClientFromLead(tx, organizationId, lead, { allowCreate: roleCan(auth.context.user.role, "clients.write") });
      if (!resolved) throw new Error("lead-client-unresolved");
      clientId = resolved.client.id;
      if (resolved.created) clientCreated = resolved.client;
    }
    const row = await tx.budget.create({
      data: {
        id: randomUUID(),
        organizationId,
        clientId,
        eventId: eventId || undefined,
        leadId: lead?.id,
        title,
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
        installmentsJson: installments,
        securityDeposit,
        securityDepositStatus: securityDeposit ? "PENDING" : null,
        securityDepositPurpose: securityDeposit ? (isDepositPurpose(body.securityDepositPurpose) ? body.securityDepositPurpose : rental.securityDepositPurpose) : null,
        items: { create: items.map(({ rentalDays: _rentalDays, ...item }, sortOrder) => ({ ...item, sortOrder, ...(snapshots.has(item.id) ? { pricingSnapshot: snapshots.get(item.id) } : {}) })) },
      },
      include: { client: { include: { logo: { select: { updatedAt: true } } } }, event: true, items: { include: { inventory: { select: INVENTORY_LINK_SELECT } } } },
    });
    // Un lead nuevo o contactado pasa a Cotizado; uno ganado no baja.
    const nextStatus = lead ? leadStatusAfterBudget(lead.status) : null;
    if (lead && nextStatus && nextStatus !== lead.status) {
      await tx.lead.update({ where: { id: lead.id }, data: { status: nextStatus } });
    }
    return { budget: row, clientCreated, leadStatus: nextStatus };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "lead-client-unresolved") return null;
    throw error;
  });
  if (!created) return jsonError("Tu rol no puede crear clientes y este lead todavía no tiene uno. Pedile a un administrador que lo convierta en cliente.", 403);
  const { budget, clientCreated, leadStatus } = created;
  if (clientCreated) {
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Client",
      entityId: clientCreated.id,
      summary: `Creó el cliente «${clientCreated.name}» al armar un presupuesto desde el lead`,
      detail: { fields: { name: clientCreated.name, company: clientCreated.company, fromLeadId: lead?.id ?? null } },
    });
  }
  if (lead && leadStatus && leadStatus !== lead.status) {
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "Lead",
      entityId: lead.id,
      summary: `Cambió el estado del lead «${lead.name}» al armarle un presupuesto`,
      detail: { changes: { status: { from: lead.status, to: leadStatus } } },
    });
  }
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Budget",
    entityId: budget.id,
    summary: lead
      ? `Creó el presupuesto «${budget.title}» del cliente «${budget.client.name}» desde el lead «${lead.name}»`
      : `Creó el presupuesto «${budget.title}» del cliente «${budget.client.name}»`,
    detail: {
      fields: {
        ...auditPick(budget, ["title", "status", "subtotal", "discount", "total", "costEstimate", "materialCost", "laborCost", "deliveryAt", "validUntil", "ivaType", "eventId", "leadId", "securityDeposit", "securityDepositStatus"]),
        ...(budget.installmentsJson ? { plan: "Plan de pagos por defecto o definido al crear" } : {}),
        items: budget.items.length,
        ...(budget.items.some((item) => item.inventoryId)
          ? { inventario: budget.items.filter((item) => item.inventory?.name).map((item) => `${item.name} → ${item.inventory?.name}`) }
          : {}),
      },
    },
  });
  const { logo, ...clientRow } = budget.client;
  return Response.json({ budget: { ...budget, client: { ...clientRow, logoUpdatedAt: logo?.updatedAt.toISOString() ?? null }, items: stableOrderBudgetItems(budget.items) }, ...(lead ? { existingBudgets, leadStatus } : {}) }, { status: 201 });
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
  try { return await patchBudget(request); }
  catch (error) {
    if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

async function patchBudget(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  if (!budgetId) return jsonError("Falta el presupuesto.", 400);
  // Papelera: un presupuesto eliminado (o de otra empresa) responde 404 en toda edición por id.
  await assertLive("Budget", budgetId, organizationId);

  if (body.status !== undefined) {
    const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (!Object.values(CommercialStatus).includes(status as CommercialStatus)) return jsonError("El estado del presupuesto no es válido.", 400);
    const budget = await db.budget.findFirst({
      where: { id: budgetId, organizationId },
      select: { id: true, title: true, status: true, client: { select: { name: true, company: true, tradeName: true, legalName: true } } },
    });
    if (!budget) return jsonError("Presupuesto no encontrado.", 404);
    if (budget.status === status) {
      return Response.json({ budget: { id: budget.id, status: budget.status }, unchanged: true });
    }
    if (budget.status === "APPROVED" && status !== "APPROVED") return jsonError("El presupuesto ya está aprobado: no se puede reabrir para cambiar sus condiciones.", 409);
    let updated: { id: string; status: CommercialStatus };
    try {
      updated = status === "APPROVED"
        ? await withQuoteApproval(budget.id, organizationId, (tx) => tx.budget.update({ where: { id: budget.id }, data: { status: status as CommercialStatus }, select: { id: true, status: true } }))
        : await db.budget.update({ where: { id: budget.id }, data: { status: status as CommercialStatus }, select: { id: true, status: true } });
    } catch (error) {
      if (error instanceof QuoteComparisonError) return jsonError(error.message, error.status);
      throw error;
    }
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
    if (!itemId) return jsonError("Falta el ítem.", 400);
    const rawInventoryId = typeof body.inventoryId === "string" ? body.inventoryId.trim() : "";
    const budget = await db.budget.findFirst({
      where: { id: budgetId, organizationId },
      select: {
        id: true,
        title: true,
        client: { select: { name: true, company: true, tradeName: true, legalName: true } },
        items: { select: { id: true, name: true, inventoryId: true, inventory: { select: { name: true } } } },
      },
    });
    if (!budget) return jsonError("Presupuesto no encontrado.", 404);
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

  if (body.kind === "security-deposit" || body.kind === "security-deposit-status") {
    try {
      if (body.kind === "security-deposit") {
        const amount = body.securityDeposit === null || body.securityDeposit === 0 ? null : body.securityDeposit;
        if (amount !== null && typeof amount !== "number") return jsonError("La garantía debe ser un monto entero en guaraníes.", 400);
        let finalAmount = amount;
        if (body.suggest === true) {
          // «Calcular según Ajustes»: con la política y las líneas actuales del presupuesto.
          const current = await db.budget.findFirst({ where: { id: budgetId, organizationId }, select: { total: true, items: { where: { excluded: false }, select: { inventoryId: true, quantity: true } } } });
          if (!current) return jsonError("Presupuesto no encontrado.", 404);
          finalAmount = await suggestDepositForOrder(organizationId, { total: current.total, lines: current.items });
          if (finalAmount === null) return jsonError("Según Ajustes no hay una garantía para calcular: cargá el monto a mano o revisá la política en Ajustes → Alquileres.", 409);
        }
        const row = await setBudgetSecurityDeposit(auth.context, budgetId, finalAmount, body.purpose === undefined ? undefined : isDepositPurpose(body.purpose) ? body.purpose : null);
        return Response.json({ securityDeposit: securityDepositPublic(row), budgetId, ...(body.suggest === true ? { suggested: finalAmount } : {}) });
      }
      const to = typeof body.to === "string" ? body.to.toUpperCase() : "";
      const row = await transitionBudgetSecurityDeposit(auth.context, budgetId, {
        to: to as never,
        retainedAmount: typeof body.retainedAmount === "number" ? body.retainedAmount : undefined,
        reason: typeof body.reason === "string" ? body.reason : null,
      });
      return Response.json({ securityDeposit: securityDepositPublic(row), budgetId });
    } catch (error) {
      if (error instanceof SecurityDepositError) return jsonError(error.message, error.status);
      throw error;
    }
  }

  if (body.kind === "editor") {
    const { saveBudgetEditor } = await import("@/lib/server/budget-editor");
    return saveBudgetEditor(auth.context, budgetId, body);
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
      client: { select: { name: true, company: true, tradeName: true, legalName: true } },
    },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);

  const data: Prisma.BudgetUpdateInput = {};
  if (body.advanceAmount !== undefined) {
    const advance = Number(body.advanceAmount);
    if (typeof body.advanceAmount !== "number" || !budgetMoneyValid(advance)) return jsonError("El anticipo debe ser un entero en guaraníes.", 400);
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
    const parsed = resolveBudgetPaymentPlan(body.installmentsJson, budget.total, Number(body.advanceAmount ?? budget.advanceAmount));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    installments = parsed.rows;
    data.installmentsJson = parsed.rows as unknown as Prisma.InputJsonValue;
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
    JSON.stringify(rows);
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

  const updated = await withQuoteCommercialEdit(budget.id, organizationId, true, async (tx) => {
    const fresh = await tx.budget.findUniqueOrThrow({ where: { id: budget.id }, select: { total: true } });
    const checked = resolveBudgetPaymentPlan(installments, fresh.total, advance);
    if (!checked.ok) throw new QuoteComparisonError(400, checked.error);
    await validateBudgetPlanAccounts(tx, organizationId, checked.rows);
    await assertBudgetPlanLedger(tx, budget.id, fresh.total, advance, checked.rows);
    data.installmentsJson = checked.rows as unknown as Prisma.InputJsonValue;
    const saved = await tx.budget.update({
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
    await recalculateBudgetPaymentPlan(tx, budget.id);
    return saved;
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
      updatedAt: true,
      status: true,
      approvedAt: true,
      discount: true,
      subtotal: true,
      total: true,
      client: { select: { name: true, company: true, tradeName: true, legalName: true } },
      items: { select: { id: true, name: true, inventoryId: true, excluded: true } },
    },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);
  if (budget.approvedAt) return jsonError("El presupuesto ya está aprobado: sus ítems no se pueden cambiar.", 409);
  if (budget.status === "LOST" || budget.status === "CANCELLED") return jsonError("Este presupuesto ya no está en juego.", 409);

  const rawItems = Array.isArray(body.items) ? body.items : null;
  if (!rawItems) return jsonError("Mandá la lista de ítems del presupuesto.", 400);
  const validInventoryIds = await resolveInventoryLinks(rawItems, organizationId);
  if (!validInventoryIds) return jsonError("El artículo de inventario vinculado no existe en esta empresa.", 400);
  const parsed = parseBudgetItems(rawItems, validInventoryIds);
  if (parsed.length === 0) return jsonError("El presupuesto necesita al menos un ítem con nombre.", 400);
  if (parsed.length !== rawItems.length) return jsonError("Completá todos los ítems con cantidades y montos válidos.", 400);

  const existingIds = new Set(budget.items.map((item) => item.id));
  const suppliedIds = parsed.flatMap((item) => item.id ? [item.id] : []);
  if (new Set(suppliedIds).size !== suppliedIds.length) return jsonError("No repitas el identificador de un ítem.", 400);
  if (parsed.some((item) => item.id && !existingIds.has(item.id))) {
    return jsonError("Uno de los ítems no pertenece a este presupuesto.", 400);
  }

  const excludedIds = new Set(budget.items.filter((item) => item.excluded).map((item) => item.id));
  for (const item of parsed) if (item.id && excludedIds.has(item.id)) item.subtotal = 0;
  const subtotal = parsed.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Math.min(budget.discount, subtotal);
  const total = Math.max(0, subtotal - discount);
  if (!budgetMoneyValid(subtotal)) return jsonError("El subtotal supera el límite Int.", 400);
  const costEstimate = parsed.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  if (!budgetMoneyValid(costEstimate)) return jsonError("El costo agregado de los ítems supera el límite Int.", 400);
  const keepIds = new Set(parsed.flatMap((item) => (item.id ? [item.id] : [])));
  // El vínculo con el inventario se conserva si el payload no lo manda (el
  // diálogo de precios no edita ese vínculo): sin esto, guardar ítems
  // desvinculaba el stock del #18 y la imagen del portal (#107).
  const linksById = new Map(budget.items.map((item) => [item.id, item.inventoryId]));
  const snapshots = await snapshotsForLines(organizationId, parsed.map((item, index) => ({ key: String(index), inventoryId: item.inventoryId, rentalDays: item.rentalDays })));

  await withQuoteCommercialEdit(budget.id, organizationId, true, async (tx) => {
    const fresh = await tx.budget.findUniqueOrThrow({ where: { id: budget.id }, select: { updatedAt: true } });
    if (fresh.updatedAt.getTime() !== budget.updatedAt.getTime()) throw new QuoteComparisonError(409, "El presupuesto cambió. Actualizá los ítems antes de guardar.");
    await tx.budgetItem.deleteMany({ where: { budgetId: budget.id, id: { notIn: [...keepIds] } } });
    for (const item of parsed) {
      const raw = rawItems.find((row) => row && typeof row === "object" && (row as Record<string, unknown>).id === item.id) as Record<string, unknown> | undefined;
      const inventoryId = raw && Object.hasOwn(raw, "inventoryId") ? item.inventoryId : item.inventoryId ?? (item.id ? linksById.get(item.id) ?? null : null);
      const data = {
        ...(raw && Object.hasOwn(raw, "notes") ? { notes: item.notes } : {}),
        sortOrder: parsed.indexOf(item),
        name: item.name,
        quantity: item.quantity,
        days: item.days,
        unitPrice: item.unitPrice,
        costPrice: item.costPrice,
        subtotal: item.subtotal,
        inventoryId,
        ...(snapshots.has(String(parsed.indexOf(item))) ? { pricingSnapshot: snapshots.get(String(parsed.indexOf(item))) } : {}),
      };
      if (item.id && existingIds.has(item.id)) {
        await tx.budgetItem.update({ where: { id: item.id }, data });
      } else {
        await tx.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, ...data } });
      }
    }
    await tx.budget.update({ where: { id: budget.id }, data: { subtotal, discount, total, costEstimate } });
    await recalculateBudgetPaymentPlan(tx, budget.id);
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
  return Response.json({ budget: updated ? { ...updated, items: stableOrderBudgetItems(updated.items) } : updated });
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
      client: { select: { name: true, company: true, tradeName: true, legalName: true } },
    },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);

  // Qué se puede tocar: el precio y las condiciones del cliente quedan
  // congelados con la aprobación; los costos internos se corrigen siempre.
  const guard = budgetCommercialGuard({ approved: Boolean(budget.approvedAt), status: budget.status }, body);
  if (!guard.ok) return jsonError(guard.error, guard.status);

  // Valores propuestos ya normalizados (montos enteros, fechas como día).
  const patch: Partial<BudgetCommercialSnapshot> = {};
  const data: Prisma.BudgetUpdateInput = {};

  if (body.materialCost !== undefined) {
    const materialCost = body.materialCost;
    if (typeof materialCost !== "number" || !budgetMoneyValid(materialCost)) return jsonError("El costo de materiales debe ser un entero en guaraníes dentro del límite Int.", 400);
    patch.materialCost = materialCost;
    data.materialCost = materialCost;
  }
  if (body.laborCost !== undefined) {
    const laborCost = body.laborCost;
    if (typeof laborCost !== "number" || !budgetMoneyValid(laborCost)) return jsonError("El costo de mano de obra debe ser un entero en guaraníes dentro del límite Int.", 400);
    patch.laborCost = laborCost;
    data.laborCost = laborCost;
  }
  if (body.discount !== undefined) {
    const discount = body.discount;
    if (typeof discount !== "number" || !budgetMoneyValid(discount)) return jsonError("El descuento debe ser un entero no negativo en guaraníes dentro del límite Int.", 400);
    if (discount > budget.subtotal) {
      return jsonError("El precio final no puede quedar por debajo de cero: el descuento supera la suma de los ítems.", 400);
    }
    patch.discount = discount;
    data.discount = discount;
    data.total = Math.max(0, budget.subtotal - discount);
  }
  if (body.validUntil !== undefined) {
    const valid = dayField(body.validUntil);
    if (!valid.ok) return jsonError("La vigencia no es válida.", 400);
    patch.validUntil = valid.value ? dayKeyOf(valid.value) : null;
    data.validUntil = valid.value;
  }
  if (body.deliveryAt !== undefined) {
    const delivery = dayField(body.deliveryAt);
    if (!delivery.ok) return jsonError("La fecha de entrega no es válida.", 400);
    patch.deliveryAt = delivery.value ? dayKeyOf(delivery.value) : null;
    data.deliveryAt = delivery.value;
  }
  if (body.ivaType !== undefined) {
    const ivaType = ivaField(body.ivaType);
    if (ivaType === undefined) return jsonError("La condición de IVA no es válida.", 400);
    patch.ivaType = ivaType;
    data.ivaType = ivaType;
  }
  if (body.warranty !== undefined) {
    const warranty = textField(body.warranty, MAX_WARRANTY);
    patch.warranty = warranty;
    data.warranty = warranty;
  }
  if (body.notes !== undefined) {
    const notes = textField(body.notes, MAX_NOTES);
    patch.notes = notes;
    data.notes = notes;
  }

  // El `unchanged` sale de comparar TODOS los campos comerciales (issue #70):
  // cambiar solo las notas, la garantía o el IVA se guarda y se audita.
  const changes = budgetCommercialChanges(
    {
      materialCost: budget.materialCost,
      laborCost: budget.laborCost,
      discount: budget.discount,
      validUntil: budget.validUntil ? dayKeyOf(budget.validUntil) : null,
      deliveryAt: budget.deliveryAt ? dayKeyOf(budget.deliveryAt) : null,
      ivaType: budget.ivaType,
      warranty: budget.warranty,
      notes: budget.notes,
    },
    patch,
  );
  if (!changes) {
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

  const updated = await withQuoteCommercialEdit(budget.id, organizationId, touchesBudgetClientFields(body), async (tx) => {
    const updated = await tx.budget.update({
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
    await recalculateBudgetPaymentPlan(tx, budget.id);
    return updated;
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
