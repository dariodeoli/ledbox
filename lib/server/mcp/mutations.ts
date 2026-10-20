import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { recordAudit } from "@/lib/server/audit";
import { withIdempotency } from "@/lib/server/idempotency";
import { roleCan, type AdminCapability } from "@/lib/server/permissions";

type PricePreviewInput = { productId: string; price: number; currency: string; audience: "RETAIL" | "WHOLESALE"; minimumUnits: number };
type ConfirmInput = { previewId: string; idempotencyKey: string };
const PREVIEW_SCOPE = "mcp:preview:prices:v1";
const PREVIEW_TTL_MS = 60 * 60 * 1000;

function blocked(context: AdminContext): boolean {
  return context.demo || context.sandbox;
}

function requireCapability(context: AdminContext, capability: AdminCapability) {
  if (!roleCan(context.role, capability)) throw new Error("FORBIDDEN");
}

/** Persist the reviewed sales-price change in the existing tenant-bound idempotency store. */
export async function previewSalesPrice(context: AdminContext, input: PricePreviewInput) {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "budgets.write");
  const product = await db.salesProduct.findFirst({
    where: { id: input.productId, organizationId: context.organizationId, archivedAt: null },
    select: { id: true, sku: true, name: true },
  });
  if (!product) throw new Error("NOT_FOUND");
  const current = await db.salesProductPriceTier.findFirst({
    where: { organizationId: context.organizationId, productId: product.id, audience: input.audience, minimumUnits: input.minimumUnits },
    select: { amount: true, currency: true },
  });
  const previewId = randomUUID();
  const payload = {
    kind: "sales-price",
    actorId: context.user.id,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    audience: input.audience,
    minimumUnits: input.minimumUnits,
    before: { amount: current?.amount?.toString() ?? null, currency: current?.currency ?? null },
    after: { amount: input.price.toString(), currency: input.currency.toUpperCase() },
  };
  await db.idempotencyKey.create({
    data: {
      id: randomUUID(), organizationId: context.organizationId, scope: PREVIEW_SCOPE, key: previewId,
      requestHash: "mcp-preview-v1", status: 200, response: payload as Prisma.InputJsonObject,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    },
  });
  return { previewId, expiresInSeconds: PREVIEW_TTL_MS / 1000, changes: payload };
}

/** Atomically applies only a previously persisted, unexpired, actor-bound sales-price preview. */
export async function confirmSalesPrice(context: AdminContext, input: ConfirmInput): Promise<unknown> {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "budgets.write");
  const request = new Request("https://mcp.internal/prices/confirm", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ previewId: input.previewId, idempotencyKey: input.idempotencyKey }),
  });
  const response = await withIdempotency({
    request, organizationId: context.organizationId, scope: "mcp:prices:confirm:v1",
    body: { previewId: input.previewId, idempotencyKey: input.idempotencyKey },
  }, async (tx) => {
    // Serialize all attempts to consume the same preview, even when clients send different keys.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-preview:${context.organizationId}:${PREVIEW_SCOPE}:${input.previewId}`}, 0))::text AS locked`;
    const row = await tx.idempotencyKey.findFirst({
      where: { organizationId: context.organizationId, scope: PREVIEW_SCOPE, key: input.previewId, expiresAt: { gt: new Date() } },
      select: { id: true, response: true },
    });
    if (!row || !row.response || typeof row.response !== "object" || Array.isArray(row.response)) {
      return Response.json({ code: "PREVIEW_EXPIRED", message: "The preview is missing or expired; no change was made." }, { status: 409 });
    }
    const preview = row.response as Record<string, unknown>;
    if (preview.kind !== "sales-price" || preview.actorId !== context.user.id || typeof preview.productId !== "string" || typeof preview.audience !== "string" || typeof preview.minimumUnits !== "number" || !preview.after || typeof preview.after !== "object") {
      return Response.json({ code: "PREVIEW_INVALID", message: "The preview is not valid for this actor; no change was made." }, { status: 403 });
    }
    const after = preview.after as Record<string, unknown>;
    const before = preview.before as Record<string, unknown>;
    if (typeof after.amount !== "string" || typeof after.currency !== "string") {
      return Response.json({ code: "PREVIEW_INVALID", message: "The preview is incomplete; no change was made." }, { status: 409 });
    }
    const product = await tx.salesProduct.findFirst({
      where: { id: preview.productId, organizationId: context.organizationId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!product) return Response.json({ code: "NOT_FOUND", message: "The product is not available in the active company." }, { status: 404 });
    const current = await tx.salesProductPriceTier.findFirst({
      where: { organizationId: context.organizationId, productId: product.id, audience: preview.audience as "RETAIL" | "WHOLESALE", minimumUnits: preview.minimumUnits },
      select: { id: true, amount: true, currency: true },
    });
    const currentAmount = current?.amount?.toString() ?? null;
    const currentCurrency = current?.currency ?? null;
    if (currentAmount !== (before.amount as string | null) || currentCurrency !== (before.currency as string | null)) {
      return Response.json({ code: "PREVIEW_STALE", message: "The current price changed after preview; review a new preview." }, { status: 409 });
    }
    const amount = new Prisma.Decimal(after.amount);
    if (current) {
      await tx.salesProductPriceTier.update({ where: { id: current.id }, data: { amount, currency: after.currency } });
    } else {
      await tx.salesProductPriceTier.create({ data: {
        id: randomUUID(), organizationId: context.organizationId, productId: product.id,
        audience: preview.audience as "RETAIL" | "WHOLESALE", minimumUnits: preview.minimumUnits,
        amount, currency: after.currency,
      } });
    }
    await recordAudit({
      context, action: "update", entity: "SalesProduct", entityId: product.id,
      summary: `Actualizó el precio comercial de «${product.name}»`,
      detail: { changes: { price: { from: before, to: after } } },
    }, tx);
    await tx.idempotencyKey.delete({ where: { id: row.id } });
    return { status: 200, body: { ok: true, productId: product.id, audience: preview.audience, minimumUnits: preview.minimumUnits, price: after } };
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(String((body as Record<string, unknown>).code ?? "MUTATION_FAILED")), { status: response.status });
  return body;
}

const QUANTITY_PREVIEW_SCOPE = "mcp:preview:quantities:v1";

export async function previewInventoryQuantity(context: AdminContext, input: { productId: string; quantity: number; reason: string }) {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "inventory.write");
  const product = await db.inventoryItem.findFirst({ where: { id: input.productId, organizationId: context.organizationId, archivedAt: null }, select: { id: true, name: true, quantity: true, comboIncomplete: true, _count: { select: { components: true } } } });
  if (!product) throw new Error("NOT_FOUND");
  if (product.comboIncomplete || product._count.components > 0) throw new Error("COMBO_STOCK_BLOCKED");
  if (input.quantity < product.quantity) throw new Error("QUANTITY_DECREASE_BLOCKED");
  const previewId = randomUUID();
  const payload = { kind: "inventory-count", actorId: context.user.id, productId: product.id, name: product.name, before: product.quantity, after: input.quantity, reason: input.reason };
  await db.idempotencyKey.create({ data: { id: randomUUID(), organizationId: context.organizationId, scope: QUANTITY_PREVIEW_SCOPE, key: previewId, requestHash: "mcp-preview-v1", status: 200, response: payload as Prisma.InputJsonObject, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) } });
  return { previewId, expiresInSeconds: PREVIEW_TTL_MS / 1000, changes: payload };
}

export async function confirmInventoryQuantity(context: AdminContext, input: ConfirmInput): Promise<unknown> {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "inventory.write");
  const { confirmInventoryCount } = await import("@/lib/server/inventory-stock-count");
  const { lockInventoryItems } = await import("@/lib/server/inventory-availability");
  const body = { previewId: input.previewId, idempotencyKey: input.idempotencyKey };
  const response = await withIdempotency({
    request: new Request("https://mcp.internal/quantities/confirm", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(body) }),
    organizationId: context.organizationId, scope: "mcp:quantities:confirm:v1", body,
  }, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-preview:${context.organizationId}:${QUANTITY_PREVIEW_SCOPE}:${input.previewId}`}, 0))::text AS locked`;
    const row = await tx.idempotencyKey.findFirst({ where: { organizationId: context.organizationId, scope: QUANTITY_PREVIEW_SCOPE, key: input.previewId, expiresAt: { gt: new Date() } }, select: { id: true, response: true } });
    if (!row?.response || typeof row.response !== "object" || Array.isArray(row.response)) return Response.json({ code: "PREVIEW_EXPIRED" }, { status: 409 });
    const preview = row.response as Record<string, unknown>;
    if (preview.kind !== "inventory-count" || preview.actorId !== context.user.id || typeof preview.productId !== "string" || typeof preview.before !== "number" || typeof preview.after !== "number") return Response.json({ code: "PREVIEW_INVALID" }, { status: 403 });
    await lockInventoryItems(tx, context.organizationId, [preview.productId]);
    const current = await tx.inventoryItem.findFirst({ where: { id: preview.productId, organizationId: context.organizationId, archivedAt: null }, select: { id: true, quantity: true } });
    if (!current) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (current.quantity !== preview.before) return Response.json({ code: "PREVIEW_STALE" }, { status: 409 });
    if (preview.after < current.quantity) return Response.json({ code: "QUANTITY_DECREASE_BLOCKED" }, { status: 409 });
    const result = await confirmInventoryCount(tx, context, current.id, preview.after);
    await tx.idempotencyKey.delete({ where: { id: row.id } });
    return { status: 200, body: { ok: true, ...result } };
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String((responseBody as Record<string, unknown>).code ?? "MUTATION_FAILED"));
  return responseBody;
}
