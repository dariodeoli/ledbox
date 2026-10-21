import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import { clientRucPatch, signRucConfirmation } from "../lib/server/ruc-confirmation";
import { lookupOwnData, mapOwnDataRucResponse, ownDataAdapters, ownDataConfig, OwnDataLookupError, ownDataRucValid, type OwnDataResult } from "../lib/server/ruc-owndata";

// Fixture CONTRACTUAL DEMO. No contribuyente, publicación ni consulta real.
export const demoEnvelope = {
  data: { ruc: "1234567", dv: 0, fullRuc: "1234567-0", nameOfficial: "RAZÓN SOCIAL DEMO EAS", equivalenceRaw: null, stateRaw: "DEMO", sourcePartition: 0 },
  requestId: "qa-demo", meta: { environment: "test", quota: { limit: 10, used: 1, remaining: 9, day: "2030-01-01", resetAfter: 60 }, provenance: { source: "dnit_official_snapshot", sourcePage: "urn:ledbox:test-fixture", publicationDate: "2030-01-01", publishedText: "", importedAt: "2030-01-01T12:00:00Z", snapshotHash: "a".repeat(64) } },
};
export const demoResult: OwnDataResult = {
  name: demoEnvelope.data.nameOfficial, fullRuc: demoEnvelope.data.fullRuc, reviewRequired: true,
  ownData: { ...demoEnvelope.data, environment: "test", quota: demoEnvelope.meta.quota, provenance: { ...demoEnvelope.meta.provenance, source: "dnit_official_snapshot" } },
};

test("el parser no depende de status/stateRaw y nunca los publica", () => {
  for (const metadata of [{ status: "ACTIVO" }, { status: "INACTIVO" }, { status: "SUSPENDIDO" }, { stateRaw: "LEGACY" }, {}]) {
    const envelope = { ...demoEnvelope, data: { ...demoEnvelope.data, ...metadata } };
    const result = mapOwnDataRucResponse(envelope, "1234567-0");
    assert.equal(result.fullRuc, "1234567-0");
    assert.equal(result.ownData.nameOfficial, "RAZÓN SOCIAL DEMO EAS");
    assert.equal(Object.prototype.propertyIsEnumerable.call(result.ownData, "status"), false);
    assert.equal(Object.prototype.propertyIsEnumerable.call(result.ownData, "stateRaw"), false);
    assert.equal("status" in result.ownData, false);
    assert.equal(JSON.stringify(result).includes("ACTIVO"), false);
    assert.equal(JSON.stringify(result).includes("stateRaw"), false);
  }
  const { equivalenceRaw: _ignored, ...withoutOptionalEquivalence } = demoEnvelope.data;
  assert.equal(mapOwnDataRucResponse({ ...demoEnvelope, data: withoutOptionalEquivalence }, "1234567-0").ownData.equivalenceRaw, null);
});

test("la vista de persona usa namePresentation.values.full solo con confirmación explícita", async () => {
  const env = { OWNDATA_API_ORIGIN: "https://example.invalid", OWNDATA_API_KEY: "qa-only", OWNDATA_ENVIRONMENT: "test" };
  const presentation = { values: { full: "Dario Alfonso De Oliveira Ortigoza" }, status: "parsed" };
  const fetcher: typeof fetch = async (url) => {
    assert.equal(new URL(String(url)).search, "?nameMethods=full&subjectKind=individual");
    return Response.json({ ...demoEnvelope, data: { ...demoEnvelope.data, nameOfficial: "DE OLIVEIRA ORTIGOZA,DARIO ALFONSO" }, namePresentation: presentation });
  };
  const result = await lookupOwnData("1234567-0", { env, subjectKind: "individual", fetch: fetcher });
  assert.equal(result.name, "DE OLIVEIRA ORTIGOZA,DARIO ALFONSO");
  assert.equal(result.namePresentationFull, "Dario Alfonso De Oliveira Ortigoza");
});

test("el parser rechaza únicamente identidad, nombre, procedencia o metadata inválidos", () => {
  assert.throws(() => mapOwnDataRucResponse({ ...demoEnvelope, data: { ...demoEnvelope.data, nameOfficial: "" } }, "1234567-0"));
  assert.throws(() => mapOwnDataRucResponse({ ...demoEnvelope, data: { ...demoEnvelope.data, fullRuc: "1234567-9" } }, "1234567-0"));
  assert.throws(() => mapOwnDataRucResponse({ ...demoEnvelope, meta: { ...demoEnvelope.meta, provenance: { ...demoEnvelope.meta.provenance, sourcePage: "http://insecure.example" } } }, "1234567-0"));
  assert.throws(() => mapOwnDataRucResponse({ ...demoEnvelope, meta: { ...demoEnvelope.meta, quota: { ...demoEnvelope.meta.quota, remaining: 99 } } }, "1234567-0"));
  assert.throws(() => mapOwnDataRucResponse(demoEnvelope, "1234567-9"));
});

test("configuración incompleta/insegura y kit antiguo: manual, cero llamadas", async () => {
  for (const env of [{}, { OWNDATA_API_URL: "https://example.invalid", OWNDATA_API_KEY: "qa-only" }, { OWNDATA_API_URL: "http://example.invalid", OWNDATA_API_KEY: "qa-only", OWNDATA_ENVIRONMENT: "test" }, { OWNDATA_API_URL: "https://user:secret@example.invalid", OWNDATA_API_KEY: "qa-only", OWNDATA_ENVIRONMENT: "test" }]) {
    assert.equal(ownDataConfig(env), null);
    await assert.rejects(lookupOwnData("1234567-0", { env, fetch: async () => { assert.fail("no fetch without valid configuration"); } }), (error: unknown) => error instanceof OwnDataLookupError && error.status === 503);
  }
  const env = { OWNDATA_API_URL: "https://example.invalid", OWNDATA_API_KEY: "qa-only", OWNDATA_ENVIRONMENT: "test" };
  await assert.rejects(lookupOwnData("1234567-0", { env, adapters: null, fetch: async () => { assert.fail("no fetch without canonical adapters"); } }), (error: unknown) => error instanceof OwnDataLookupError && error.code === "OWNDATA_ADAPTER_UNAVAILABLE");
  for (const ruc of ["012345", "1-00", "1234567890", "123 456", "-1"]) assert.equal(ownDataRucValid(ruc), false);
  assert.equal(ownDataRucValid("123456789"), true);
});

test("OwnData requiere URL raíz HTTPS, sin duplicar path /api/v1", async () => {
  const env = { OWNDATA_API_URL: "https://example.invalid/api/v1", OWNDATA_API_KEY: "qa-only", OWNDATA_ENVIRONMENT: "test" };
  assert.equal(ownDataConfig(env), null);
  await assert.rejects(lookupOwnData("1234567-0", { env, fetch: async () => { assert.fail("URL inválida no permite transporte"); } }), (error: unknown) => error instanceof OwnDataLookupError && error.code === "OWNDATA_NOT_CONFIGURED");
  assert.equal(ownDataConfig({ ...env, OWNDATA_API_URL: "https://example.invalid/" })?.base, "https://example.invalid");
});

test("snapshot firmado: sólo fiscal, actor/empresa, edición manual invalida procedencia", async () => {
  process.env.AUTH_SECRET = "identity-qa-test-secret-no-production";
  const signed = await signRucConfirmation(demoResult, "org-a", "actor-a");
  const body = { confirmRuc: true, rucConfirmationToken: signed.confirmationToken, tradeName: "FANTASÍA DEMO" };
  const patch = await clientRucPatch(body, "org-a", "actor-a");
  assert.equal(patch.ruc, "1234567-0");
  assert.equal(patch.legalName, "RAZÓN SOCIAL DEMO EAS");
  assert.equal("tradeName" in patch, false);
  assert.equal("name" in patch, false);
  assert.equal("contactName" in patch, false);
  const snapshot = patch.rucSnapshot as Record<string, unknown>;
  assert.equal(snapshot.lookedUpAt, signed.lookedUpAt);
  assert.deepEqual(snapshot.provenance, demoEnvelope.meta.provenance);
  assert.equal(snapshot.sourcePartition, 0);
  await assert.rejects(clientRucPatch(body, "org-b", "actor-a"));
  await assert.rejects(clientRucPatch(body, "org-a", "actor-b"));
  await assert.rejects(clientRucPatch({ ...body, confirmRuc: false }, "org-a", "actor-a"));
  await assert.rejects(clientRucPatch({ ...body, ruc: "7654321-0" }, "org-a", "actor-a"));
  await assert.rejects(clientRucPatch({ ...body, rucConfirmationToken: signed.confirmationToken.slice(0, -10) + "tampered" }, "org-a", "actor-a"));
  await assert.rejects(clientRucPatch({ rucSnapshot: snapshot }, "org-a", "actor-a"));
  assert.deepEqual(await clientRucPatch({ tradeName: "Otra fantasía" }, "org-a", "actor-a", { ruc: "1234567-0", legalName: "RAZÓN SOCIAL DEMO EAS" }), {});
  assert.ok((await clientRucPatch({ legalName: "Cambio manual" }, "org-a", "actor-a", { ruc: "1234567-0", legalName: "RAZÓN SOCIAL DEMO EAS" })).rucSnapshot);
  const expired = await new SignJWT({ organizationId: "org-a", actorId: "actor-a", snapshot }).setProtectedHeader({ alg: "HS256" }).setIssuer("ledbox:ruc").setAudience("ledbox:ruc-confirmation").setExpirationTime(1).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  await assert.rejects(clientRucPatch({ ...body, rucConfirmationToken: expired }, "org-a", "actor-a"));
});

test("transporte OwnData con helpers canónicos: identidad exacta, snapshot, cuotas y errores seguros", async (t) => {
  // Mientras panel actualiza el pin, se puede verificar el helper REAL del checkout
  // OwnCoding con una URI file: explícita, sin copiarlo ni alterar dependencias.
  const module = process.env.OWNDATA_TEST_UTILS_MODULE ? await import(process.env.OWNDATA_TEST_UTILS_MODULE) : null;
  const adapters = module ? { create: module.createOwnDataRucProvider, map: module.mapOwnDataRucResponse } : ownDataAdapters();
  if (!adapters) { t.skip("Pin actual sin helpers OwnData; gate manual verificado arriba"); return; }
  const env = { OWNDATA_API_ORIGIN: "https://example.invalid", OWNDATA_API_KEY: "qa-secret-not-real", OWNDATA_ENVIRONMENT: "test" };
  let calls = 0;
  const fetchFixture: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://example.invalid/api/v1/ruc/1234567-0");
    assert.equal((options?.headers as Record<string, string>)["X-API-Key"], "qa-secret-not-real");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    return Response.json(demoEnvelope);
  };
  const result = await lookupOwnData("1234567-0", { env, adapters, fetch: fetchFixture });
  assert.equal(calls, 1);
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.ownData.provenance, demoEnvelope.meta.provenance);
  assert.throws(() => adapters.map(demoEnvelope, "1234567-9"));
  assert.throws(() => adapters.map({ ...demoEnvelope, meta: {} }, "1234567-0"));
  for (const [code, status, expected] of [["DAILY_QUOTA_REACHED", 429, 429], ["REGISTERED_RUC_NOT_FOUND", 404, 404], ["API_KEY_INVALID", 401, 401], ["API_KEY_REVOKED", 401, 401], ["API_KEY_EXPIRED", 401, 401], ["INSUFFICIENT_SCOPE", 403, 403], ["PLAN_REQUIRED", 403, 403], ["COMMERCIAL_API_DISABLED", 503, 503]] as const) {
    calls = 0;
    await assert.rejects(lookupOwnData("1234567-0", { env, adapters, fetch: async () => { calls++; return Response.json({ error: { code, message: "INTERNAL SECRET qa-secret-not-real" }, retryAfter: 45 }, { status }); } }), (error: unknown) => {
      assert.ok(error instanceof OwnDataLookupError); assert.equal(error.status, expected); assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /SECRET|qa-secret/);
      if (code === "DAILY_QUOTA_REACHED") assert.equal(error.retryAfter, 45);
      return true;
    });
    assert.equal(calls, 1, "sin retry");
  }
  await assert.rejects(lookupOwnData("1234567-0", { env, adapters, fetch: async () => Response.json({ ...demoEnvelope, meta: { ...demoEnvelope.meta, environment: "live" } }) }), (error: unknown) => error instanceof OwnDataLookupError && error.code === "API_KEY_ENVIRONMENT_MISMATCH");
  await assert.rejects(lookupOwnData("1234567-0", { env, adapters, fetch: async () => { throw new Error("INTERNAL SECRET"); } }), (error: unknown) => error instanceof OwnDataLookupError && !error.message.includes("SECRET"));
});
