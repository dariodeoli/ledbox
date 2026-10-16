import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AdminContext } from "./tenancy";
import { roleCan, type AdminCapability } from "./permissions";
import { jsonError } from "./http";
import type { TrashEntityType } from "../trash-shared";
const LIMIT = 200;
const CAPS: Partial<Record<TrashEntityType, AdminCapability>> = { InventoryItem: "inventory.write", Client: "clients.write", Supplier: "suppliers.write", Promoter: "promoters.write", Event: "events.write", Budget: "budgets.write" };
export class BulkSelectionError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export const bulkSelectionErrorResponse = (error: unknown) => error instanceof BulkSelectionError ? jsonError(error.message, error.status) : null;

/** Cursor firmado de descubrimiento, no permiso para mutar ni promesa de repeatable-read. */
export async function readBulkSelection(request: Request | undefined, context: AdminContext, type: TrashEntityType) {
  if (!request || new URL(request.url).searchParams.get("fields") !== "bulk-selection") return null;
  const capability = CAPS[type];
  if (!capability || !roleCan(context.role, capability)) throw new BulkSelectionError("Forbidden", 403);
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor"); params.delete("cursor"); params.sort();
  const filter = createHash("sha256").update(params.toString()).digest("hex");
  const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new BulkSelectionError("La selección completa no está configurada.", 503);
  const key = new TextEncoder().encode(secret);
  let at = new Date(), after: string | null = null, total: number | null = null;
  if (cursor) {
    if (cursor.length > 4096) throw new BulkSelectionError("Cursor inválido.");
    try {
      const { payload } = await jwtVerify(cursor, key, { algorithms: ["HS256"], issuer: "ledbox:bulk-selection", audience: "ledbox:bulk-selection", maxTokenAge: "30m" });
      if (payload.org !== context.organizationId || payload.actor !== context.user.id || payload.type !== type || payload.filter !== filter || typeof payload.at !== "string" || typeof payload.after !== "string" || !Number.isSafeInteger(payload.total) || Number(payload.total) < 0) throw new Error("scope");
      at = new Date(payload.at); if (!Number.isFinite(at.getTime())) throw new Error("date");
      after = payload.after; total = Number(payload.total);
    } catch { throw new BulkSelectionError("La selección venció o cambió el filtro/empresa. Volvé a seleccionar todos.", 409); }
  }
  const snapshotAt = at.toISOString();
  async function finishKnown<T extends { id: string }>(items: T[], totalCount: number, next: string | null) {
    const nextCursor = next ? await new SignJWT({ org: context.organizationId, actor: context.user.id, type, filter, at: snapshotAt, after: next, total: totalCount }).setProtectedHeader({ alg: "HS256" }).setIssuer("ledbox:bulk-selection").setAudience("ledbox:bulk-selection").setIssuedAt().setExpirationTime("30m").sign(key) : null;
    return { items, meta: { total: totalCount, snapshotAt, nextCursor, complete: !nextCursor } };
  }
  return { at, after, total, limit: LIMIT, watermark: { createdAt: { lte: at } },
    where: { createdAt: { lte: at }, ...(after ? { id: { gt: after } } : {}) },
    finishKnown,
    finish: async <T extends { id: string }>(fetched: T[], totalCount: number) => { const items = fetched.slice(0, LIMIT); return finishKnown(items, totalCount, fetched.length > LIMIT ? items.at(-1)!.id : null); },
  };
}
