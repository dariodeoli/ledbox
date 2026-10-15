import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { budgetItemError } from "../budget-items";
import { BudgetCalculationError, calculateBudgetCommercial } from "../budget-commercial-calculation";
import { stableOrderBudgetItems } from "../budget-item-order";
import { budgetDayValid, budgetMoneyValid, resolveBudgetPaymentPlan } from "../budget-payment-plan";
import { INVOICE_TAX_TYPES } from "../fiscal";
import { auditChanges, recordAudit } from "./audit";
import { db } from "./db";
import { jsonError } from "./http";
import type { AdminContext } from "./tenancy";
import { QuoteComparisonError, withQuoteCommercialEdit } from "./quote-comparison";
import { readRentalDays, snapshotsForLines } from "./line-pricing";
import { recalculateBudgetPaymentPlan, validateBudgetPlanAccounts } from "./budget-payment-plan";

/** Atomic editor: item replacement, commercial fields and dynamic plan under the
 * existing signature/approval lock. A failed plan rolls back the entire edit.
 */
export async function saveBudgetEditor(context: AdminContext, budgetId: string, body: Record<string, unknown>) {
  const current = await db.budget.findFirst({ where: { id: budgetId, organizationId: context.organizationId }, include: { items: true } });
  if (!current) return jsonError("Presupuesto no encontrado.", 404);
  if (current.comparisonId && typeof body.clientId === "string" && body.clientId !== current.clientId) return jsonError("La comparación comparte un cliente. Conservá su identidad o usá el ciclo de revisión.", 409);
  if (["discount", "materialCost", "laborCost"].some((key) => body[key] !== undefined && typeof body[key] !== "number")) return jsonError("Los montos comerciales deben ser numéricos.", 400);
  if (typeof body.expectedUpdatedAt === "string" && body.expectedUpdatedAt !== current.updatedAt.toISOString()) return jsonError("El presupuesto cambió. Actualizá antes de guardar.", 409);
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return jsonError("El presupuesto necesita entre 1 y 100 ítems.", 400);
  if (raw.some((row) => !row || typeof row !== "object" || Array.isArray(row) || ["quantity", "days", "unitPrice", "costPrice"].some((field) => row[field] !== undefined && typeof row[field] !== "number"))) return jsonError("Las cantidades y montos deben ser numéricos, no texto ni booleanos.", 400);
  const items = raw.map((r: Record<string, unknown>) => ({
    id: typeof r?.id === "string" ? r.id : null,
    name: typeof r?.name === "string" ? r.name.trim() : "",
    quantity: Number(r?.quantity), days: Number(r?.days), unitPrice: Number(r?.unitPrice), costPrice: Number(r?.costPrice ?? 0),
    notes: typeof r?.notes === "string" ? r.notes.trim().slice(0, 400) : null,
    inventoryId: typeof r?.inventoryId === "string" && r.inventoryId ? r.inventoryId : null,
    rentalDays: readRentalDays(r?.rentalDays),
    freeOnPurpose: r?.freeOnPurpose === true && Number(r?.unitPrice) === 0,
  }));
  for (const item of items) { const error = budgetItemError(item); if (error) return jsonError(error, 400); }
  const existing = new Map(current.items.map((item) => [item.id, item]));
  if (items.some((item) => item.id && !existing.has(item.id))) return jsonError("El ítem no pertenece al presupuesto.", 400);
  const ids = items.flatMap((item) => item.id ? [item.id] : []);
  if (new Set(ids).size !== ids.length) return jsonError("No repitas el identificador de un ítem.", 400);
  // Excluded originals cannot disappear through the compact editor.
  if (current.items.some((item) => item.excluded && !ids.includes(item.id))) return jsonError("Conservá las líneas retiradas de la selección del cliente.", 409);
  const active = items.filter((item) => !item.id || !existing.get(item.id)?.excluded);
  const discount = Number(body.discount ?? current.discount);
  const materialCost = Number(body.materialCost ?? current.materialCost), laborCost = Number(body.laborCost ?? current.laborCost);
  const costEstimate = active.reduce((sum, item) => sum + item.quantity * item.days * item.costPrice, 0);
  if (![discount, materialCost, laborCost, costEstimate].every(budgetMoneyValid)) return jsonError("Revisá precio, descuento y costos: deben estar dentro del límite Int.", 400);
  const lineIds = items.map((item) => item.id ?? randomUUID());
  const dates: Record<string, Date | null> = {};
  for (const key of ["validUntil", "deliveryAt"] as const) {
    if (body[key] === undefined) continue;
    const day = body[key];
    if (day !== null && day !== "" && (typeof day !== "string" || !budgetDayValid(day))) return jsonError("Fecha comercial inválida.", 400);
    dates[key] = day ? new Date(`${day}T12:00:00Z`) : null;
  }
  if (body.ivaType && !(INVOICE_TAX_TYPES as readonly unknown[]).includes(body.ivaType)) return jsonError("IVA inválido.", 400);
  const title = typeof body.title === "string" ? body.title.trim() : current.title;
  if (!title || title.length > 160) return jsonError("Escribí un título de hasta 160 caracteres.", 400);
  const data = {
    title, materialCost, laborCost, costEstimate, ...dates,
    ...(body.ivaType !== undefined ? { ivaType: body.ivaType || null } : {}),
    ...(typeof body.warranty === "string" ? { warranty: body.warranty.trim().slice(0, 400) || null } : {}),
    ...(typeof body.notes === "string" ? { notes: body.notes.trim().slice(0, 2000) || null } : {}),
  } as Prisma.BudgetUpdateInput;
  const result = await withQuoteCommercialEdit(budgetId, context.organizationId, true, async (tx) => {
    const fresh = await tx.budget.findUniqueOrThrow({ where: { id: budgetId } });
    if (fresh.updatedAt.getTime() !== current.updatedAt.getTime()) throw new QuoteComparisonError(409, "El presupuesto cambió. Actualizá antes de guardar.");
    // Live legacy rows persist manual prices and a fixed global discount/advance.
    // Do not invent tariffs, service execution IDs or recognized costs from them.
    // Calculate once after the existing quote/signature lock and revision check.
    const commercial = (() => {
      try {
        return calculateBudgetCommercial(items.map((item, index) => ({
          id: lineIds[index], sortOrder: index, quantity: item.quantity, days: item.days, unitPrice: item.unitPrice,
          excluded: Boolean(item.id && existing.get(item.id)?.excluded),
          priceMode: null, tariffSnapshot: null, discountMode: null, discountValue: null, discountAmount: null,
        })), { discountMode: null, discountValue: null, advancePercentBps: null }, discount, fresh.advanceAmount);
      } catch (error) {
        if (error instanceof BudgetCalculationError) throw new QuoteComparisonError(400, error.message);
        throw error;
      }
    })();
    Object.assign(data, { subtotal: commercial.subtotal, discount: commercial.discount, total: commercial.total });
    if (typeof body.clientId === "string") {
      if (!await tx.client.findFirst({ where: { id: body.clientId, organizationId: context.organizationId } })) throw new QuoteComparisonError(400, "El cliente no existe en esta empresa.");
      data.client = { connect: { id: body.clientId } };
    }
    if (body.eventId !== undefined) {
      if (body.eventId === null || body.eventId === "") data.event = { disconnect: true };
      else if (typeof body.eventId === "string" && await tx.event.findFirst({ where: { id: body.eventId, organizationId: context.organizationId } })) data.event = { connect: { id: body.eventId } };
      else throw new QuoteComparisonError(400, "El evento no existe en esta empresa.");
    }
    const inventoryIds = [...new Set(items.flatMap((item) => item.inventoryId ? [item.inventoryId] : []))];
    if (await tx.inventoryItem.count({ where: { id: { in: inventoryIds }, organizationId: context.organizationId } }) !== inventoryIds.length) throw new QuoteComparisonError(400, "El producto no existe en esta empresa.");
    await tx.budgetItem.deleteMany({ where: { budgetId, id: { notIn: ids } } });
    // Snapshot de precios (escalones y paquete) de las líneas con producto y días del alquiler.
    const snapshots = await snapshotsForLines(context.organizationId, items.map((item, index) => ({
      key: String(index),
      inventoryId: Object.hasOwn(raw[index] as object, "inventoryId") ? item.inventoryId : (item.id ? existing.get(item.id)?.inventoryId ?? null : item.inventoryId),
      rentalDays: item.rentalDays,
    })), tx);
    for (const item of items) {
      const source = raw[items.indexOf(item)] as Record<string, unknown>;
      const inventoryId = Object.hasOwn(source, "inventoryId") ? item.inventoryId : (item.id ? existing.get(item.id)?.inventoryId ?? null : item.inventoryId);
      const calculated = commercial.items[items.indexOf(item)];
      const snapshot = snapshots.get(String(items.indexOf(item)));
      const itemData = { name: item.name, quantity: item.quantity, days: item.days, unitPrice: calculated.unitPrice, costPrice: item.costPrice, freeOnPurpose: item.freeOnPurpose, ...(Object.hasOwn(source, "notes") ? { notes: item.notes } : {}), inventoryId, subtotal: calculated.subtotal, ...(snapshot ? { pricingSnapshot: snapshot } : {}) };
      const orderedItemData = { ...itemData, sortOrder: items.indexOf(item) };
      if (item.id) await tx.budgetItem.update({ where: { id: item.id }, data: orderedItemData });
      else await tx.budgetItem.create({ data: { id: calculated.id, budgetId, ...orderedItemData } });
    }
    if (body.installmentsJson !== undefined) {
      const plan = resolveBudgetPaymentPlan(body.installmentsJson, commercial.total, fresh.advanceAmount);
      if (!plan.ok) throw new QuoteComparisonError(400, plan.error);
      await validateBudgetPlanAccounts(tx, context.organizationId, plan.rows);
      data.installmentsJson = plan.rows as unknown as Prisma.InputJsonValue;
    }
    await tx.budget.update({ where: { id: budgetId }, data });
    await recalculateBudgetPaymentPlan(tx, budgetId);
    return tx.budget.findUniqueOrThrow({ where: { id: budgetId }, include: { items: true } });
  });
  await recordAudit({ context, action: "update", entity: "Budget", entityId: budgetId, summary: `Editó el presupuesto «${result.title}»`, detail: { changes: auditChanges(current, result, ["title", "subtotal", "discount", "total", "installmentsJson", "validUntil", "deliveryAt", "warranty", "notes"]) ?? {}, fields: { items: result.items.length } } });
  return Response.json({ budget: { ...result, items: stableOrderBudgetItems(result.items) } });
}
