import { randomUUID } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { apiTokenHash, apiTokenPrefix, apiTokenValue } from "@/lib/api-tokens";
import { db } from "./db";
import type { AdminContext } from "./tenancy";

/**
 * API keys de servicio (issue #69) — capa de datos.
 *
 * - El token plano se genera acá y **solo se devuelve una vez**; en la base vive
 *   su hash SHA-256 (`tokenHash`, único) y el prefijo para listarlo.
 * - `verifyApiToken` resuelve el token y distingue inválido / revocado / empresa
 *   inactiva; nunca expone el hash ni el motivo en las respuestas HTTP.
 * - `lastUsedAt` se toca con throttle (1 minuto) para no escribir en cada request.
 * - La revocación es inmediata: la próxima resolución ya no lo acepta.
 *
 * El store es inyectable para los tests (`tests/api-tokens.test.ts`): ahí se
 * prueban token inválido, revocado y scoping por empresa sin base.
 */

/** Roles asignables a un token: nunca OWNER (las claves no administran claves). */
export const API_TOKEN_ROLES: readonly AdminRole[] = ["ADMIN", "FINANCE", "OPERATIONS"];

export type ApiTokenOrganization = {
  id: string;
  name: string;
  slug: string;
  planId: string | null;
};

export type ApiTokenIdentity = {
  id: string;
  organizationId: string;
  name: string;
  role: AdminRole;
  prefix: string;
  createdById: string;
  createdByName: string;
  createdByEmail: string | null;
  lastUsedAt: Date | null;
  organization: ApiTokenOrganization;
};

export type ApiTokenLookupRow = ApiTokenIdentity & {
  revokedAt: Date | null;
  /** La empresa del token está activa (una empresa dada de baja no autentica). */
  organizationActive: boolean;
};

export type ApiTokenStore = {
  findByHash(hash: string): Promise<ApiTokenLookupRow | null>;
  touch(id: string, at: Date): Promise<void>;
};

export type ApiTokenVerification =
  | { ok: true; token: ApiTokenIdentity }
  | { ok: false; reason: "invalid" | "revoked" | "inactive" };

/** Resuelve un token plano contra el store. No lanza por tokens inválidos. */
export async function verifyApiToken(token: string, store: ApiTokenStore = dbApiTokenStore()): Promise<ApiTokenVerification> {
  const row = await store.findByHash(apiTokenHash(token));
  if (!row) return { ok: false, reason: "invalid" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (!row.organizationActive) return { ok: false, reason: "inactive" };
  const { revokedAt: _revokedAt, organizationActive: _organizationActive, ...identity } = row;
  return { ok: true, token: identity };
}

const LAST_USED_THROTTLE_MS = 60_000;

/** Marca el uso del token; a lo sumo una escritura por minuto. Best-effort. */
export async function touchApiToken(token: ApiTokenIdentity, store: ApiTokenStore = dbApiTokenStore()): Promise<void> {
  const now = new Date();
  if (token.lastUsedAt && now.getTime() - token.lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;
  try {
    await store.touch(token.id, now);
  } catch {
    /* la traza de uso no puede romper el request */
  }
}

export function dbApiTokenStore(): ApiTokenStore {
  return {
    async findByHash(hash) {
      const row = await db.apiToken.findUnique({
        where: { tokenHash: hash },
        select: {
          id: true,
          organizationId: true,
          name: true,
          role: true,
          prefix: true,
          createdById: true,
          createdByName: true,
          createdByEmail: true,
          lastUsedAt: true,
          revokedAt: true,
          organization: { select: { id: true, name: true, slug: true, planId: true, active: true } },
        },
      });
      if (!row) return null;
      const { organization, ...rest } = row;
      const { active: organizationActive, ...organizationInfo } = organization;
      return { ...rest, organization: organizationInfo, organizationActive };
    },
    async touch(id, at) {
      await db.apiToken.update({ where: { id }, data: { lastUsedAt: at } });
    },
  };
}

export type ApiTokenSummary = Omit<ApiTokenIdentity, "organization"> & {
  revokedAt: Date | null;
  createdAt: Date;
};

/** Tokens de la empresa (incluye revocados, para poder mostrarlos y auditarlos). */
export async function listApiTokens(organizationId: string): Promise<ApiTokenSummary[]> {
  return db.apiToken.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      name: true,
      role: true,
      prefix: true,
      createdById: true,
      createdByName: true,
      createdByEmail: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export type CreatedApiToken = {
  /** Token plano: viaja una sola vez en la respuesta de creación. */
  token: string;
  record: ApiTokenSummary;
};

/**
 * Crea una clave para la empresa del contexto. El llamador (ruta) ya validó que
 * el rol del actor es OWNER y que el rol pedido está permitido.
 */
export async function createApiToken(
  context: Pick<AdminContext, "organizationId" | "user">,
  input: { name: string; role: AdminRole },
): Promise<CreatedApiToken> {
  const token = apiTokenValue();
  const record = await db.apiToken.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      name: input.name,
      role: input.role,
      tokenHash: apiTokenHash(token),
      prefix: apiTokenPrefix(token),
      createdById: context.user.id,
      createdByName: context.user.name,
      createdByEmail: context.user.email || null,
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      role: true,
      prefix: true,
      createdById: true,
      createdByName: true,
      createdByEmail: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return { token, record };
}

/** Revoca (idempotente) un token de la empresa. `null` si no existe. */
export async function revokeApiToken(organizationId: string, id: string): Promise<ApiTokenSummary | null> {
  const existing = await db.apiToken.findFirst({ where: { id, organizationId }, select: { id: true, revokedAt: true } });
  if (!existing) return null;
  if (!existing.revokedAt) {
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
  return db.apiToken.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      name: true,
      role: true,
      prefix: true,
      createdById: true,
      createdByName: true,
      createdByEmail: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}
