import "server-only";
import { db } from "../db";
import { requireAdminContext } from "../tenancy";
import { PagaYaRepository, PagaYaPersistenceError } from "./repository";
import { PagaYaError } from "./pagaya-server.mjs";
import { PagaYaConfigurationError } from "./config";
import { createPagaYaServerClient } from "./client";
import type { PagaYaBillingContext } from "./catalog-checkout";

export function pagayaJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache" } });
}

export async function requirePagaYaContext(): Promise<{ ok: true; context: PagaYaBillingContext } | { ok: false; response: Response }> {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth;
  // Service API actors are synthetic and must never own a user enrollment.
  const membership = await db.adminMembership.findFirst({ where: {
    organizationId: auth.context.organizationId, adminUserId: auth.context.user.id, active: true,
    user: { active: true }, organization: { active: true },
  }, select: { id: true } });
  if (!membership) return { ok: false, response: pagayaJson({ error: "Forbidden" }, 403) };
  const client = createPagaYaServerClient();
  return { ok: true, context: { client, repository: new PagaYaRepository(db), owner: {
    organizationId: auth.context.organizationId, adminUserId: auth.context.user.id,
    appId: client.config.appId, mode: client.config.mode,
  } } };
}

export function pagayaFailure(error: unknown): Response {
  if (error instanceof PagaYaConfigurationError) return pagayaJson({ error: "pagaya_not_configured" }, 503);
  if (error instanceof PagaYaPersistenceError) return pagayaJson({ error: error.code }, error.status);
  if (error instanceof PagaYaError) return pagayaJson({ error: error.code, outcomeUnknown: error.outcomeUnknown,
    retryAfterSeconds: error.retryAfterSeconds }, error.status >= 400 && error.status <= 599 ? error.status : 502);
  // Never log raw provider responses, credentials or ephemeral portal URLs.
  return pagayaJson({ error: "pagaya_unavailable" }, 503);
}

export async function pagayaBody(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new PagaYaError("invalid_request", { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new PagaYaError("invalid_request", { status: 400 });
  }
  return body as Record<string, unknown>;
}

export function pagayaText(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 160) throw new PagaYaError("invalid_request", { status: 400 });
  return value;
}
