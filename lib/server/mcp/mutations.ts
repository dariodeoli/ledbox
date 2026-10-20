import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { recordAudit } from "@/lib/server/audit";
import { requestHashOf, withIdempotency } from "@/lib/server/idempotency";
import { roleCan, type AdminCapability } from "@/lib/server/permissions";
import { parseImageUpload } from "@/lib/server/branding";

type PricePreviewInput = { productId: string; price: number; currency: string; audience: "RETAIL" | "WHOLESALE"; minimumUnits: number };
type ConfirmInput = { previewId: string; idempotencyKey: string };
const PREVIEW_SCOPE = "mcp:preview:prices:v1";
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const RENTAL_PREVIEW_SCOPE = "mcp:preview:rental-prices:v1";
const COMPANY_PREVIEW_SCOPE = "mcp:preview:company:v1";
const PHOTO_PREVIEW_SCOPE = "mcp:preview:photos:v1";
const BUDGET_PREVIEW_SCOPE = "mcp:preview:budgets:v1";

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

type JsonObject = Record<string, unknown>;
async function storePreview(context: AdminContext, scope: string, value: JsonObject) {
  const previewId = randomUUID();
  await db.idempotencyKey.create({ data: { id: randomUUID(), organizationId: context.organizationId, scope, key: previewId, requestHash: "mcp-preview-v1", status: 200, response: value as Prisma.InputJsonObject, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) } });
  return { previewId, expiresInSeconds: PREVIEW_TTL_MS / 1000, changes: value };
}

export async function previewRentalPrice(context: AdminContext, input: { productId: string; price: number }) {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "budgets.write");
  const item = await db.inventoryItem.findFirst({ where: { id: input.productId, organizationId: context.organizationId, archivedAt: null }, select: { id: true, name: true, listPrice: true, comboIncomplete: true, _count: { select: { components: true } } } });
  if (!item) throw new Error("NOT_FOUND");
  if (item.comboIncomplete || item._count.components > 0) throw new Error("COMBO_STOCK_BLOCKED");
  return storePreview(context, RENTAL_PREVIEW_SCOPE, { kind: "rental-price", actorId: context.user.id, productId: item.id, name: item.name, before: item.listPrice, after: input.price });
}

export async function confirmRentalPrice(context: AdminContext, input: ConfirmInput): Promise<unknown> {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "budgets.write");
  return confirmMcpPreview(context, input, RENTAL_PREVIEW_SCOPE, "mcp:rental-prices:confirm:v1", async (tx, preview) => {
    const item = await tx.inventoryItem.findFirst({ where: { id: String(preview.productId), organizationId: context.organizationId, archivedAt: null }, select: { id: true, name: true, listPrice: true, comboIncomplete: true, _count: { select: { components: true } } } });
    if (!item) return { code: "NOT_FOUND" };
    if (item.listPrice !== preview.before) return { code: "PREVIEW_STALE" };
    if (item.comboIncomplete || item._count.components > 0) return { code: "COMBO_STOCK_BLOCKED" };
    await tx.inventoryItem.update({ where: { id: item.id }, data: { listPrice: Number(preview.after) } });
    await recordAudit({ context, action: "update", entity: "InventoryItem", entityId: item.id, summary: `Actualizó la tarifa de alquiler de «${item.name}»`, detail: { changes: { listPrice: { from: preview.before, to: preview.after } } } }, tx);
    return { ok: true, productId: item.id, rentalPrice: Number(preview.after) };
  });
}

export async function previewCompanyProfile(context: AdminContext, input: { name?: string; publicPhone?: string | null; publicEmail?: string | null; website?: string | null; tagline?: string | null; accent?: string | null }) {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "org.manage");
  const org = await db.organization.findFirst({ where: { id: context.organizationId, active: true }, select: { id: true, name: true, profile: true } });
  if (!org) throw new Error("NOT_FOUND");
  const settings = await db.organizationRentalSettings.findUnique({ where: { organizationId: context.organizationId }, select: { storefrontTagline: true, storefrontAccent: true } });
  const oldProfile = org.profile && typeof org.profile === "object" && !Array.isArray(org.profile) ? org.profile as JsonObject : {};
  const oldContact = oldProfile.contact && typeof oldProfile.contact === "object" && !Array.isArray(oldProfile.contact) ? oldProfile.contact as JsonObject : {};
  const before = { name: org.name, publicPhone: oldContact.phone ?? null, publicEmail: oldContact.email ?? null, website: oldContact.website ?? null, tagline: settings?.storefrontTagline ?? null, accent: settings?.storefrontAccent ?? null };
  const after = { ...before, ...input };
  return storePreview(context, COMPANY_PREVIEW_SCOPE, { kind: "company-profile", actorId: context.user.id, before, after });
}

async function confirmMcpPreview(context: AdminContext, input: ConfirmInput, previewScope: string, confirmScope: string, apply: (tx: Prisma.TransactionClient, preview: JsonObject) => Promise<JsonObject>) {
  const body = { previewId: input.previewId };
  const response = await withIdempotency({ request: new Request("https://mcp.internal/confirm", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(body) }), organizationId: context.organizationId, scope: confirmScope, body: { ...body, idempotencyKey: input.idempotencyKey } }, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-preview:${context.organizationId}:${previewScope}:${input.previewId}`}, 0))::text AS locked`;
    const row = await tx.idempotencyKey.findFirst({ where: { organizationId: context.organizationId, scope: previewScope, key: input.previewId, expiresAt: { gt: new Date() } }, select: { id: true, response: true } });
    if (!row?.response || typeof row.response !== "object" || Array.isArray(row.response)) return Response.json({ code: "PREVIEW_EXPIRED" }, { status: 409 });
    const preview = row.response as JsonObject;
    if (preview.actorId !== context.user.id || typeof preview.kind !== "string") return Response.json({ code: "PREVIEW_INVALID" }, { status: 403 });
    const result = await apply(tx, preview);
    if (typeof result.code === "string") return Response.json(result, { status: result.code === "NOT_FOUND" ? 404 : 409 });
    await tx.idempotencyKey.delete({ where: { id: row.id } });
    return { status: 200, body: result };
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(String((result as JsonObject).code ?? "MUTATION_FAILED")), { status: response.status });
  return result;
}

export async function confirmCompanyProfile(context: AdminContext, input: ConfirmInput): Promise<unknown> {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "org.manage");
  return confirmMcpPreview(context, input, COMPANY_PREVIEW_SCOPE, "mcp:company:confirm:v1", async (tx, preview) => {
    if (preview.kind !== "company-profile" || !preview.before || !preview.after || typeof preview.before !== "object" || typeof preview.after !== "object") return { code: "PREVIEW_INVALID" };
    const before = preview.before as JsonObject; const after = preview.after as JsonObject;
    const org = await tx.organization.findFirst({ where: { id: context.organizationId, active: true }, select: { id: true, name: true, profile: true } });
    if (!org) return { code: "NOT_FOUND" };
    const existing = org.profile && typeof org.profile === "object" && !Array.isArray(org.profile) ? org.profile as JsonObject : {};
    const contact = existing.contact && typeof existing.contact === "object" && !Array.isArray(existing.contact) ? existing.contact as JsonObject : {};
    const current = { name: org.name, publicPhone: contact.phone ?? null, publicEmail: contact.email ?? null, website: contact.website ?? null };
    for (const key of Object.keys(current)) if ((current as JsonObject)[key] !== before[key]) return { code: "PREVIEW_STALE" };
    if ("tagline" in after || "accent" in after) {
      const settings = await tx.organizationRentalSettings.findUnique({ where: { organizationId: org.id }, select: { storefrontTagline: true, storefrontAccent: true } });
      if ((settings?.storefrontTagline ?? null) !== before.tagline || (settings?.storefrontAccent ?? null) !== before.accent) return { code: "PREVIEW_STALE" };
    }
    const changedFields = Object.keys(after).filter((key) => after[key] !== before[key]);
    await tx.organization.update({ where: { id: org.id }, data: { name: String(after.name), profile: { ...existing, contact: { ...contact, phone: after.publicPhone, email: after.publicEmail, website: after.website } } as Prisma.InputJsonObject } });
    if (changedFields.includes("tagline") || changedFields.includes("accent")) await tx.organizationRentalSettings.upsert({ where: { organizationId: org.id }, create: { id: randomUUID(), organizationId: org.id, storefrontTagline: (after.tagline as string | null) ?? null, storefrontAccent: (after.accent as string | null) ?? null }, update: { storefrontTagline: (after.tagline as string | null) ?? null, storefrontAccent: (after.accent as string | null) ?? null } });
    await recordAudit({ context, action: "update", entity: "Organization", entityId: org.id, summary: `Actualizó el perfil público de «${org.name}»`, detail: { changes: Object.fromEntries(changedFields.map((key) => [key, { from: before[key], to: after[key] }])) } }, tx);
    return { ok: true, organizationId: org.id, updatedFields: changedFields };
  });
}

export async function previewCompanyPhoto(context: AdminContext, input: { resourceType: "product" | "company"; resourceId: string; variant?: "light" | "dark"; fileName: string; mimeType: string; byteLength: number; sha256: string; data: string }) {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, input.resourceType === "company" ? "org.manage" : "inventory.write");
  const parsed = parseImageUpload({ data: input.data, mime: input.mimeType });
  if (!parsed.ok || parsed.image.bytes.byteLength !== input.byteLength || createHash("sha256").update(parsed.image.bytes).digest("hex") !== input.sha256.toLowerCase()) throw new Error("PHOTO_INVALID");
  if (input.resourceType === "company") {
    if (!input.variant || !(await db.organization.findFirst({ where: { id: context.organizationId, active: true }, select: { id: true } }))) throw new Error("NOT_FOUND");
  } else if (!(await db.inventoryItem.findFirst({ where: { id: input.resourceId, organizationId: context.organizationId, archivedAt: null, visibleOnWeb: true }, select: { id: true } }))) throw new Error("NOT_FOUND");
  return storePreview(context, PHOTO_PREVIEW_SCOPE, { kind: "company-photo", actorId: context.user.id, resourceType: input.resourceType, resourceId: input.resourceId, variant: input.variant ?? null, fileName: input.fileName, mime: parsed.image.mime, width: parsed.image.width, height: parsed.image.height, byteLength: parsed.image.bytes.byteLength, sha256: input.sha256.toLowerCase(), data: Buffer.from(parsed.image.bytes).toString("base64") });
}

export async function confirmCompanyPhoto(context: AdminContext, input: ConfirmInput): Promise<unknown> {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  return confirmMcpPreview(context, input, PHOTO_PREVIEW_SCOPE, "mcp:photos:confirm:v1", async (tx, preview) => {
    const isCompany = preview.resourceType === "company";
    requireCapability(context, isCompany ? "org.manage" : "inventory.write");
    if (preview.kind !== "company-photo" || typeof preview.resourceId !== "string" || typeof preview.data !== "string" || typeof preview.mime !== "string") return { code: "PREVIEW_INVALID" };
    const bytes = Buffer.from(preview.data, "base64");
    if (bytes.byteLength !== preview.byteLength || createHash("sha256").update(bytes).digest("hex") !== preview.sha256) return { code: "PREVIEW_INVALID" };
    if (isCompany) {
      const variant = preview.variant === "light" || preview.variant === "dark" ? preview.variant : null;
      if (!variant || !(await tx.organization.findFirst({ where: { id: context.organizationId, active: true }, select: { id: true } }))) return { code: "NOT_FOUND" };
      await tx.organizationLogo.upsert({ where: { organizationId_variant: { organizationId: context.organizationId, variant } }, create: { id: randomUUID(), organizationId: context.organizationId, variant, mime: preview.mime, size: bytes.byteLength, width: typeof preview.width === "number" ? preview.width : null, height: typeof preview.height === "number" ? preview.height : null, data: bytes }, update: { mime: preview.mime, size: bytes.byteLength, width: typeof preview.width === "number" ? preview.width : null, height: typeof preview.height === "number" ? preview.height : null, data: bytes } });
    } else {
      const item = await tx.inventoryItem.findFirst({ where: { id: preview.resourceId, organizationId: context.organizationId, archivedAt: null, visibleOnWeb: true }, select: { id: true, name: true } });
      if (!item) return { code: "NOT_FOUND" };
      const lastImage = await tx.inventoryImage.findFirst({ where: { organizationId: context.organizationId, itemId: item.id }, orderBy: { position: "desc" }, select: { position: true } });
      await tx.inventoryImage.create({ data: { id: randomUUID(), organizationId: context.organizationId, itemId: item.id, position: (lastImage?.position ?? -1) + 1, alt: String(preview.fileName), mime: preview.mime, size: bytes.byteLength, data: bytes } });
    }
    await recordAudit({ context, action: "update", entity: isCompany ? "Organization" : "InventoryItem", entityId: isCompany ? context.organizationId : String(preview.resourceId), summary: isCompany ? "Actualizó un logo de empresa" : "Publicó una foto de producto", detail: { fields: { photo: "subida", mime: preview.mime, size: bytes.byteLength, sha256: preview.sha256 } } }, tx);
    return { ok: true, resourceType: preview.resourceType, resourceId: preview.resourceId, mime: preview.mime, byteLength: bytes.byteLength };
  });
}

type BudgetDraftInput = {
  clientId?: string;
  title: string;
  currency: string;
  validUntil?: string | null;
  lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number }>;
};
const BUDGET_MAX_INT = 2_147_483_647;

/** Build a reviewable snapshot from a tenant client and optional tenant inventory items. */
export async function previewBudgetDraft(context: AdminContext, input: BudgetDraftInput) {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "budgets.write");
  if (!input.clientId) throw new Error("CLIENT_REQUIRED");
  if (input.currency.toUpperCase() !== "PYG") throw new Error("INVALID_CURRENCY");
  if (input.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) throw new Error("INVALID_BUDGET_LINE");
  const subtotal = input.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > BUDGET_MAX_INT) throw new Error("INVALID_BUDGET_TOTAL");
  const client = await db.client.findFirst({
    where: { id: input.clientId, organizationId: context.organizationId, archivedAt: null, deletedAt: null },
    select: { id: true, name: true, company: true, email: true, phone: true, updatedAt: true },
  });
  if (!client) throw new Error("NOT_FOUND");
  const productIds = [...new Set(input.lines.flatMap((line) => line.productId ? [line.productId] : []))];
  const products = productIds.length ? await db.inventoryItem.findMany({
    where: { id: { in: productIds }, organizationId: context.organizationId, archivedAt: null, deletedAt: null },
    select: {
      id: true, name: true, billingUnit: true, listPrice: true, listFromDays: true, listFromPrice: true,
      priceTiers: { where: { audience: "RETAIL" }, orderBy: { fromDays: "asc" }, select: { fromDays: true, mode: true, price: true } },
      updatedAt: true,
    },
  }) : [];
  if (products.length !== productIds.length) throw new Error("NOT_FOUND");
  const productsById = new Map(products.map((product) => [product.id, product]));
  const lines = input.lines.map((line) => {
    const source = line.productId ? productsById.get(line.productId) : undefined;
    return {
      productId: source?.id ?? null, name: line.description.trim(), quantity: line.quantity, days: 1,
      unitPrice: line.unitPrice, subtotal: line.quantity * line.unitPrice,
      // Keep the reviewed amount as the future rental editor's commercial basis.
      pricingSnapshot: source ? { v: 1, audience: "RETAIL", billingUnit: source.billingUnit === "EVENT" ? "EVENT" : "DAILY", base: line.unitPrice, minimum: 0, tiers: [], rentalDays: 1 } : null,
      source: source ? {
        id: source.id, name: source.name, billingUnit: source.billingUnit, listPrice: source.listPrice,
        listFromDays: source.listFromDays, listFromPrice: source.listFromPrice,
        priceTiers: source.priceTiers, updatedAt: source.updatedAt.toISOString(),
      } : null,
    };
  });
  const title = input.title.trim();
  const validUntil = input.validUntil ?? null;
  const commercialInput = { clientId: client.id, title, currency: "PYG", validUntil, lines: lines.map(({ source: _source, pricingSnapshot: _pricingSnapshot, ...line }) => line) };
  const payload = {
    kind: "budget-draft", actorId: context.user.id, inputHash: requestHashOf(commercialInput),
    client: { id: client.id, name: client.name, company: client.company, email: client.email, phone: client.phone, updatedAt: client.updatedAt.toISOString() },
    title, currency: "PYG", validUntil, subtotal, total: subtotal, lines,
  };
  const previewId = randomUUID();
  await db.idempotencyKey.create({ data: {
    id: randomUUID(), organizationId: context.organizationId, scope: BUDGET_PREVIEW_SCOPE, key: previewId,
    requestHash: payload.inputHash, status: 200, response: payload as Prisma.InputJsonObject,
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  } });
  return {
    previewId, expiresInSeconds: PREVIEW_TTL_MS / 1000,
    draft: { client: payload.client, title, currency: "PYG", validUntil, subtotal, total: subtotal, lines: lines.map(({ source: _source, ...line }) => line) },
  };
}

/** Confirm only creates a DRAFT. It never sends, approves, signs, charges, or reserves stock. */
export async function confirmBudgetDraft(context: AdminContext, input: ConfirmInput): Promise<unknown> {
  if (blocked(context)) throw new Error("MUTATION_BLOCKED");
  requireCapability(context, "budgets.write");
  const body = { previewId: input.previewId, idempotencyKey: input.idempotencyKey };
  const response = await withIdempotency({
    request: new Request("https://mcp.internal/budgets/confirm", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify(body) }),
    organizationId: context.organizationId, scope: "mcp:budgets:confirm:v1", body,
  }, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp-preview:${context.organizationId}:${BUDGET_PREVIEW_SCOPE}:${input.previewId}`}, 0))::text AS locked`;
    const previewRow = await tx.idempotencyKey.findFirst({ where: { organizationId: context.organizationId, scope: BUDGET_PREVIEW_SCOPE, key: input.previewId, expiresAt: { gt: new Date() } }, select: { id: true, response: true, requestHash: true } });
    if (!previewRow?.response || typeof previewRow.response !== "object" || Array.isArray(previewRow.response)) return Response.json({ code: "PREVIEW_EXPIRED" }, { status: 409 });
    const preview = previewRow.response as Record<string, any>;
    if (preview.kind !== "budget-draft" || preview.actorId !== context.user.id || typeof preview.inputHash !== "string" || previewRow.requestHash !== preview.inputHash || !Array.isArray(preview.lines)) return Response.json({ code: "PREVIEW_INVALID" }, { status: 403 });
    const client = await tx.client.findFirst({ where: { id: preview.client?.id, organizationId: context.organizationId, archivedAt: null, deletedAt: null }, select: { id: true, updatedAt: true } });
    if (!client) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (client.updatedAt.toISOString() !== preview.client.updatedAt) return Response.json({ code: "PREVIEW_STALE" }, { status: 409 });
    for (const line of preview.lines as Array<Record<string, any>>) {
      if (!line.productId) continue;
      const current = await tx.inventoryItem.findFirst({
        where: { id: line.productId, organizationId: context.organizationId, archivedAt: null, deletedAt: null },
        select: { id: true, name: true, billingUnit: true, listPrice: true, listFromDays: true, listFromPrice: true, updatedAt: true, priceTiers: { where: { audience: "RETAIL" }, orderBy: { fromDays: "asc" }, select: { fromDays: true, mode: true, price: true } } },
      });
      if (!current) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
      const source = { id: current.id, name: current.name, billingUnit: current.billingUnit, listPrice: current.listPrice, listFromDays: current.listFromDays, listFromPrice: current.listFromPrice, priceTiers: current.priceTiers, updatedAt: current.updatedAt.toISOString() };
      if (JSON.stringify(source) !== JSON.stringify(line.source)) return Response.json({ code: "PREVIEW_STALE" }, { status: 409 });
    }
    const budget = await tx.budget.create({
      data: {
        id: randomUUID(), organizationId: context.organizationId, clientId: client.id, title: preview.title,
        status: "DRAFT", subtotal: preview.subtotal, discount: 0, total: preview.total, costEstimate: 0,
        materialCost: 0, laborCost: 0, validUntil: preview.validUntil ? new Date(`${preview.validUntil}T12:00:00.000Z`) : null,
        items: { create: (preview.lines as Array<Record<string, any>>).map((line, sortOrder) => ({
          id: randomUUID(), sortOrder, name: line.name, quantity: line.quantity, days: line.days,
          unitPrice: line.unitPrice, subtotal: line.subtotal, costPrice: 0, inventoryId: line.productId,
          ...(line.pricingSnapshot ? { pricingSnapshot: line.pricingSnapshot } : {}),
        })) },
      },
      select: { id: true, title: true, status: true, subtotal: true, discount: true, total: true, validUntil: true, items: { select: { name: true, quantity: true, days: true, unitPrice: true, subtotal: true } }, client: { select: { name: true } } },
    });
    await recordAudit({ context, action: "create", entity: "Budget", entityId: budget.id, summary: `Creó el borrador «${budget.title}» por MCP`, detail: { fields: { title: budget.title, status: "DRAFT", subtotal: budget.subtotal, total: budget.total, items: budget.items.length, source: "MCP" } } }, tx);
    await tx.idempotencyKey.delete({ where: { id: previewRow.id } });
    return { status: 200, body: { ok: true, budget: { id: budget.id, title: budget.title, status: budget.status, currency: "PYG", subtotal: budget.subtotal, discount: budget.discount, total: budget.total, validUntil: budget.validUntil, clientName: budget.client.name, lines: budget.items } } };
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(String((result as Record<string, unknown>).code ?? "MUTATION_FAILED")), { status: response.status });
  return result;
}
