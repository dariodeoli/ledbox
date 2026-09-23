import assert from "node:assert/strict";
import { test } from "node:test";
import { apiTokenHash, apiTokenPrefix, apiTokenValue, parseBearerToken } from "../lib/api-tokens";
import { API_TOKEN_ROLES, verifyApiToken, type ApiTokenLookupRow, type ApiTokenStore } from "../lib/server/api-tokens";
import { roleCan } from "../lib/server/permissions";

/**
 * API keys de servicio (issue #69): formato/hash del token, resolución de
 * inválidos y revocados, scoping por empresa y que solo OWNER administre claves.
 * La resolución usa un store inyectado: no toca base.
 */

function rowFor(token: string, overrides: Partial<ApiTokenLookupRow> = {}): ApiTokenLookupRow {
  return {
    id: "tok_1",
    organizationId: "org_a",
    name: "Automatización ventas",
    role: "OPERATIONS",
    prefix: apiTokenPrefix(token),
    createdById: "user_1",
    createdByName: "Dario",
    createdByEmail: "dario@ledbox.online",
    lastUsedAt: null,
    organization: { id: "org_a", name: "LedBox", slug: "ledbox", planId: "plan_inicial" },
    revokedAt: null,
    organizationActive: true,
    ...overrides,
  };
}

function storeFor(token: string, overrides: Partial<ApiTokenLookupRow> = {}): ApiTokenStore {
  const row = rowFor(token, overrides);
  return {
    async findByHash(hash) {
      return hash === apiTokenHash(token) ? row : null;
    },
    async touch() {
      /* sin efecto */
    },
  };
}

test("el token tiene forma lbx_, se hashea y el prefijo no lo expone entero", () => {
  const token = apiTokenValue();
  assert.match(token, /^lbx_[A-Za-z0-9_-]{40,}$/);
  assert.equal(apiTokenHash(token), apiTokenHash(token));
  assert.notEqual(apiTokenHash(token), token);
  assert.equal(apiTokenHash(token).length, 64);
  assert.equal(apiTokenPrefix(token).length, 12);
  assert.ok(token.startsWith(apiTokenPrefix(token)));
  // Dos tokens distintos nunca comparten hash.
  assert.notEqual(apiTokenHash(apiTokenValue()), apiTokenHash(apiTokenValue()));
});

test("Bearer: solo el header Authorization con formato válido entra", () => {
  assert.equal(parseBearerToken("Bearer lbx_abc"), "lbx_abc");
  assert.equal(parseBearerToken("bearer lbx_abc"), "lbx_abc");
  assert.equal(parseBearerToken("  Bearer   lbx_abc  "), "lbx_abc");
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken(""), null);
  assert.equal(parseBearerToken("Basic lbx_abc"), null);
  assert.equal(parseBearerToken("Bearer"), null);
  assert.equal(parseBearerToken("Bearer a b"), null);
});

test("token inválido y revocado no resuelven; el válido conserva su empresa", async () => {
  const token = apiTokenValue();

  const invalid = await verifyApiToken(apiTokenValue(), storeFor(token));
  assert.deepEqual(invalid, { ok: false, reason: "invalid" });

  const revoked = await verifyApiToken(token, storeFor(token, { revokedAt: new Date() }));
  assert.deepEqual(revoked, { ok: false, reason: "revoked" });

  const inactiveOrg = await verifyApiToken(token, storeFor(token, { organizationActive: false }));
  assert.deepEqual(inactiveOrg, { ok: false, reason: "inactive" });

  const ok = await verifyApiToken(token, storeFor(token));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.token.organizationId, "org_a");
    assert.equal(ok.token.organization.id, "org_a");
    assert.equal(ok.token.role, "OPERATIONS");
    assert.equal(ok.token.name, "Automatización ventas");
    assert.equal(ok.token.prefix, apiTokenPrefix(token));
  }
});

test("scoping por empresa: el hash de otra empresa no existe para este store", async () => {
  const tokenA = apiTokenValue();
  const tokenB = apiTokenValue();
  // El store busca por hash: un token de otra empresa (hash distinto) no resuelve.
  const store = storeFor(tokenA);
  assert.equal((await verifyApiToken(tokenA, store)).ok, true);
  assert.deepEqual(await verifyApiToken(tokenB, store), { ok: false, reason: "invalid" });
});

test("solo OWNER administra claves y las claves nunca son OWNER ni VIEWER", () => {
  assert.equal(roleCan("OWNER", "api-keys.manage"), true);
  assert.equal(roleCan("ADMIN", "api-keys.manage"), false);
  assert.equal(roleCan("FINANCE", "api-keys.manage"), false);
  assert.equal(roleCan("OPERATIONS", "api-keys.manage"), false);
  assert.equal(roleCan("VIEWER", "api-keys.manage"), false);

  assert.ok(API_TOKEN_ROLES.length > 0);
  assert.ok(!API_TOKEN_ROLES.includes("OWNER"));
  assert.ok(!API_TOKEN_ROLES.includes("VIEWER"));

  // El rol acotado sigue la misma matriz que la sesión: OPERATIONS no escribe
  // presupuestos y FINANCE no carga clientes (rol de token = rol de membresía).
  assert.equal(roleCan("OPERATIONS", "clients.write"), true);
  assert.equal(roleCan("OPERATIONS", "budgets.write"), false);
  assert.equal(roleCan("FINANCE", "budgets.write"), true);
  assert.equal(roleCan("FINANCE", "clients.write"), false);
});

test("la cookie sigue siendo el camino sin Bearer (el header no la reemplaza en el panel)", () => {
  // El panel manda cookie y no manda Authorization: el parser no debe interceptar.
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(""), null);
});
