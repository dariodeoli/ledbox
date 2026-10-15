import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

/**
 * Links privados del catálogo mayorista (tienda web por empresa).
 *
 * - Un link identifica a UN cliente de UNA empresa: no usa cuentas. El token plano
 *   (`lbxw_…`) se muestra una sola vez al generarlo; en la base vive solo su hash
 *   SHA-256, igual que las API keys (#69).
 * - Se revoca desde la ficha del cliente. Generar uno nuevo revoca los anteriores
 *   del mismo cliente (el viejo no se puede recuperar de todos modos).
 * - Un token revocado, desconocido o de otra empresa no existe para el público (404).
 */

export const CATALOG_TOKEN_PREFIX = "lbxw_";
const TOKEN_PATTERN = /^lbxw_[A-Za-z0-9_-]{20,80}$/;
const LAST_USED_THROTTLE_MS = 10 * 60_000;

export const catalogTokenValue = (): string => `${CATALOG_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
export const catalogTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const isCatalogTokenShape = (token: unknown): token is string => typeof token === "string" && TOKEN_PATTERN.test(token);

export type CatalogAccessStatus = {
  active: { createdAt: string; lastUsedAt: string | null } | null;
  /** Links revocados o reemplazados antes (solo el conteo; el token no se conserva). */
  revoked: number;
};

/** Estado del link mayorista de un cliente de ESTA empresa; `null` si el cliente no existe acá. */
export async function catalogAccessStatus(organizationId: string, clientId: string): Promise<CatalogAccessStatus | null> {
  const client = await db.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } });
  if (!client) return null;
  const rows = await db.catalogAccessToken.findMany({
    where: { organizationId, clientId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  const active = rows.find((row) => !row.revokedAt);
  return {
    active: active ? { createdAt: active.createdAt.toISOString(), lastUsedAt: active.lastUsedAt?.toISOString() ?? null } : null,
    revoked: rows.filter((row) => row.revokedAt).length,
  };
}

/** Genera un link nuevo para el cliente (revoca los vigentes). `null` si el cliente no existe o está inactivo. */
export async function issueCatalogAccess(
  organizationId: string,
  clientId: string,
  priceList: "WHOLESALE" | "RETAIL" = "WHOLESALE",
): Promise<{ token: string; id: string } | null> {
  const client = await db.client.findFirst({ where: { id: clientId, organizationId, active: true }, select: { id: true } });
  if (!client) return null;
  return db.$transaction((tx) => issueCatalogAccessTx(tx, organizationId, clientId, priceList));
}

/** Igual que `issueCatalogAccess`, dentro de la transacción del llamador (sin chequear el cliente). */
export async function issueCatalogAccessTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  clientId: string,
  priceList: "WHOLESALE" | "RETAIL" = "WHOLESALE",
): Promise<{ token: string; id: string }> {
  const token = catalogTokenValue();
  const id = randomUUID();
  await tx.catalogAccessToken.updateMany({ where: { organizationId, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  await tx.catalogAccessToken.create({ data: { id, organizationId, clientId, tokenHash: catalogTokenHash(token), priceList } });
  return { token, id };
}

/** Revoca el link vigente del cliente; devuelve cuántos revocó (0 = no había). */
export async function revokeCatalogAccess(organizationId: string, clientId: string): Promise<number> {
  const result = await db.catalogAccessToken.updateMany({ where: { organizationId, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count;
}

export type ResolvedCatalogAccess = {
  id: string;
  /** Lista de precios que abre el link (WHOLESALE = los de siempre; RETAIL = acceso de cliente final). */
  priceList: "WHOLESALE" | "RETAIL";
  organization: { id: string; name: string; slug: string };
  client: { id: string; displayName: string };
};

/**
 * Resuelve el link: token con formato válido, no revocado, de una empresa activa
 * cuyo slug coincide con el de la URL, y de un cliente activo. Todo lo demás es `null`.
 */
export async function resolveCatalogAccess(slug: string, token: string): Promise<ResolvedCatalogAccess | null> {
  if (!isCatalogTokenShape(token)) return null;
  const normalized = slug.trim().toLowerCase();
  if (!normalized || normalized.length > 80) return null;
  const row = await db.catalogAccessToken.findUnique({
    where: { tokenHash: catalogTokenHash(token) },
    select: {
      id: true,
      priceList: true,
      revokedAt: true,
      lastUsedAt: true,
      organization: { select: { id: true, name: true, slug: true, active: true } },
      client: { select: { id: true, name: true, company: true, tradeName: true, active: true, deletedAt: true, organizationId: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  if (!row.organization.active || row.organization.slug !== normalized) return null;
  if (!row.client.active || row.client.deletedAt || row.client.organizationId !== row.organization.id) return null;
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    // La traza de uso no puede romper la página, pero un fallo no se traga en silencio.
    await db.catalogAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch((error) => {
      console.error("catalog-access: no se pudo registrar lastUsedAt", error);
    });
  }
  const displayName = (row.client.tradeName || row.client.company || row.client.name).trim();
  return { id: row.id, priceList: row.priceList === "RETAIL" ? "RETAIL" : "WHOLESALE", organization: { id: row.organization.id, name: row.organization.name, slug: row.organization.slug }, client: { id: row.client.id, displayName } };
}
