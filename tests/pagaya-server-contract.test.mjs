import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const snapshotURL = new URL("./fixtures/pagaya-contract/pagaya-server.mjs", import.meta.url);
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/pagaya-contract/snapshot.json", import.meta.url)));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pagaya-contract/contracts.json", import.meta.url)));
const expectedOfficialSHA = "b4fb131e3676898312bcb20f94280f3b2aced8e8bde5c4d1d8eb07abf1dbeb45";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const officialBytes = readFileSync(snapshotURL);
// Seal BEFORE importing; no network fallback or silent snapshot regeneration.
assert.equal(snapshot.sourceSHA256, expectedOfficialSHA);
assert.equal(hash(officialBytes), expectedOfficialSHA);
assert.equal(officialBytes.length, snapshot.sourceBytes);
const official = await import(snapshotURL.href);
const receiptPath = process.env.PAGAYA_FIN_SOURCE_RECEIPT;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Unexpected outbound fetch in offline contract suite"); };
after(() => { globalThis.fetch = originalFetch; });

test("public source snapshot has the independently pinned expected byte digest", () => {
  assert.equal(hash(officialBytes), expectedOfficialSHA);
  assert.equal(snapshot.integrationProof, false);
  assert.equal(snapshot.deliveryProof, false);
});

let actualCopy;
test("actual closed FIN copied connector source — NOT_RUN without owner receipt", {
  skip: receiptPath ? false : "NOT_RUN: missing PAGAYA_FIN_SOURCE_RECEIPT (repository/sourceSHA/sourceTree/connectorPath/connectorSHA256/officialSourceSHA256)",
}, async () => {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  for (const key of ["repository", "connectorPath"]) assert.equal(typeof receipt[key], "string", key);
  for (const key of ["sourceSHA", "sourceTree"]) assert.match(receipt[key], /^[a-f0-9]{40}$/, key);
  assert.equal(receipt.officialSourceSHA256, expectedOfficialSHA);
  assert.equal(receipt.connectorSHA256, expectedOfficialSHA);
  assert.equal(isAbsolute(receipt.connectorPath), false);
  const path = resolve(receipt.repository, receipt.connectorPath), rel = relative(resolve(receipt.repository), path);
  assert.ok(rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel), "connector inside supplied repository");
  const git = (...args) => execFileSync("git", args, { cwd: receipt.repository, maxBuffer: 1024 * 1024 });
  assert.equal(git("rev-parse", `${receipt.sourceSHA}^{tree}`).toString().trim(), receipt.sourceTree);
  const blob = git("show", `${receipt.sourceSHA}:${receipt.connectorPath}`), bytes = readFileSync(path);
  assert.equal(hash(blob), expectedOfficialSHA); assert.deepEqual(bytes, blob);
  actualCopy = await import(pathToFileURL(path).href);
});

function contracts(label, load, skip = false) {
  const options = { skip };
  const secret = "local-synthetic-webhook-secret-not-a-credential";
  const now = 1800000000;
  const raw = Buffer.from('{ "id": "fixture-event", "type": "subscription.updated", "note": "á" }\n');
  const sign = (bytes = raw, timestamp = String(now)) => `t=${timestamp},v1=${createHmac("sha256", secret).update(timestamp).update(".").update(bytes).digest("hex")}`;
  const mock = (module, result = {}, status = 200, extraHeaders = {}) => {
    const calls = [];
    const client = module.createPagaYaClient({ baseUrl: "https://pagaya.test.invalid", apiKey: "pk_test_LOCAL_FIXTURE_ONLY",
      fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(result), { status, headers: extraHeaders }); } });
    return { calls, client };
  };
  const expectError = (module, code, status, unknown = false) => error => {
    assert.ok(error instanceof module.PagaYaError); assert.equal(error.code, code);
    assert.equal(error.status, status); assert.equal(error.outcomeUnknown, unknown); return true;
  };

  test(`${label}: HMAC verifies exact raw bytes, not reserialized JSON or wrong secret`, options, () => {
    const { verifyPagaYaWebhook: verify } = load();
    assert.equal(verify(raw, sign(), secret, { nowMs: now * 1000 }), true);
    assert.equal(verify(new Uint8Array(raw), sign(), secret, { nowMs: now * 1000 }), true);
    assert.equal(verify(Buffer.from(JSON.stringify(JSON.parse(raw))), sign(), secret, { nowMs: now * 1000 }), false);
    assert.equal(verify(raw, sign(), "wrong", { nowMs: now * 1000 }), false);
  });
  for (const delta of [-301, -300, 300, 301]) test(`${label}: timestamp boundary ${delta}s`, options, () => {
    assert.equal(load().verifyPagaYaWebhook(raw, sign(raw, String(now + delta)), secret, { nowMs: now * 1000 }), Math.abs(delta) <= 300);
  });
  test(`${label}: rejects duplicate/malformed signature headers`, options, () => {
    for (const signature of [null, `${sign()},${sign()}`, `${sign()},v1=${"a".repeat(64)}`, `t=${now},t=${now},v1=${"a".repeat(64)}`, ` ${sign()}`, sign().toUpperCase()])
      assert.equal(load().verifyPagaYaWebhook(raw, signature, secret, { nowMs: now * 1000 }), false);
  });
  test(`${label}: same envelope can verify with a fresh signature — verifier does not deduplicate`, options, () => {
    const verify = load().verifyPagaYaWebhook;
    assert.equal(verify(raw, sign(), secret, { nowMs: now * 1000 }), true);
    assert.equal(verify(raw, sign(raw, String(now + 10)), secret, { nowMs: (now + 10) * 1000 }), true);
  });
  test(`${label}: catalog/checkout/subscription read/write route, no cache or redirect following`, options, async () => {
    const module = load(), { calls, client } = mock(module);
    await client.getCatalog(); await client.createCheckout(fixture.checkoutInput, fixture.commandKey);
    await client.getCheckout(fixture.checkoutId); await client.getSubscription(fixture.subscriptionId);
    await client.setRenewal(fixture.subscriptionId, true, fixture.commandKey);
    await client.setRenewal(fixture.subscriptionId, false, fixture.commandKey); await client.createPortalSession(fixture.subscriptionId);
    assert.deepEqual(calls.map(c => [c.url.replace("https://pagaya.test.invalid/api/v1/", ""), c.init.method]), [
      ["catalog", "GET"], ["checkouts", "POST"], [`checkouts/${fixture.checkoutId}`, "GET"],
      [`subscriptions/${fixture.subscriptionId}`, "GET"], [`subscriptions/${fixture.subscriptionId}`, "POST"],
      [`subscriptions/${fixture.subscriptionId}`, "POST"], [`subscriptions/${fixture.subscriptionId}/portal`, "POST"],
    ]);
    for (const { init } of calls) {
      assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer pk_test_LOCAL_FIXTURE_ONLY"); assert.ok(init.signal instanceof AbortSignal);
    }
    assert.equal(calls[1].init.body, JSON.stringify(fixture.checkoutInput));
    assert.equal(calls[1].init.headers["Idempotency-Key"], fixture.commandKey);
    assert.equal(calls[4].init.body, '{"cancelAtPeriodEnd":true}'); assert.equal(calls[5].init.body, '{"cancelAtPeriodEnd":false}');
  });
  test(`${label}: portal sends only empty body, ignores attempted caller override`, options, async () => {
    const { client, calls } = mock(load(), { url: "https://portal.test.invalid/ephemeral-fixture" });
    const result = await client.createPortalSession(fixture.subscriptionId, { returnUrl: "https://foreign.invalid", mode: "live", customer: "foreign" });
    assert.deepEqual(result, { url: "https://portal.test.invalid/ephemeral-fixture" });
    assert.equal(calls[0].init.body, "{}"); assert.equal(calls[0].init.headers["Idempotency-Key"], undefined);
  });
  test(`${label}: pending202 response stays pending, not an applied renewal`, options, async () => {
    const { client } = mock(load(), fixture.pendingRenewal, 202);
    const result = await client.setRenewal(fixture.subscriptionId, true, fixture.commandKey);
    assert.deepEqual(result, fixture.pendingRenewal); assert.equal(result.subscription.cancelAtPeriodEnd, false);
    assert.equal(result.mutation.awaitingWebhook, true);
  });
  test(`${label}: same immutable command/key explicitly replayed without connector automatic retry`, options, async () => {
    const { client, calls } = mock(load()); const input = structuredClone(fixture.checkoutInput), before = structuredClone(input);
    await client.createCheckout(input, fixture.commandKey); assert.equal(calls.length, 1);
    await client.createCheckout(input, fixture.commandKey); assert.equal(calls.length, 2);
    assert.deepEqual(input, before); assert.equal(calls[0].init.body, calls[1].init.body);
    assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
  });
  test(`${label}: invalid IDs and idempotency keys rejected before fetch`, options, () => {
    const module = load(), { client, calls } = mock(module);
    for (const key of ["", "short", "contains space", "a".repeat(161), "á".repeat(8)])
      assert.throws(() => client.createCheckout(fixture.checkoutInput, key), error => error.code === "idempotency_key_required");
    assert.throws(() => client.getSubscription("not-uuid")); assert.throws(() => client.setRenewal(fixture.subscriptionId, "true", fixture.commandKey));
    assert.equal(calls.length, 0);
  });
  test(`${label}: timeout is unknown for write, no automatic retry or replacement key`, options, async () => {
    const module = load(); let calls = 0, seen;
    const client = module.createPagaYaClient({ baseUrl: "https://pagaya.test.invalid", apiKey: "pk_test_LOCAL_FIXTURE_ONLY", timeoutMs: 1,
      fetch: async (_, init) => {
        calls++; seen = init;
        await new Promise((_, reject) => {
          const keepAlive = setTimeout(() => reject(new Error("mock timeout guard")), 100);
          init.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(init.signal.reason); }, { once: true });
        });
      } });
    await assert.rejects(client.createCheckout(fixture.checkoutInput, fixture.commandKey), expectError(module, "transport_error", 0, true));
    assert.equal(calls, 1); assert.equal(seen.headers["Idempotency-Key"], fixture.commandKey);
    assert.equal(seen.body, JSON.stringify(fixture.checkoutInput));
    await assert.rejects(client.getCatalog(), expectError(module, "transport_error", 0, false)); assert.equal(calls, 2);
  });
  for (const [status, code] of [[401, "invalid_api_key"], [403, "permission_denied"], [404, "not_found"], [409, "idempotency_conflict"], [429, "rate_limited"], [503, "portal_unavailable"]])
    test(`${label}: structured error ${status} preserved, sanitized and no retry`, options, async () => {
      const module = load(), { client, calls } = mock(module, { error: code, providerSecret: "DO_NOT_EXPOSE" }, status, { "retry-after": "12" });
      await assert.rejects(client.createCheckout(fixture.checkoutInput, fixture.commandKey), error => {
        expectError(module, code, status, status >= 500)(error); assert.equal(error.retryAfterSeconds, 12);
        assert.equal(error.message.includes("DO_NOT_EXPOSE"), false); return true;
      }); assert.equal(calls.length, 1);
    });
  test(`${label}: subscription GET and write independently propagate permission errors`, options, async () => {
    const module = load(), { client, calls } = mock(module, { error: "permission_denied" }, 403);
    await assert.rejects(client.getSubscription(fixture.subscriptionId), expectError(module, "permission_denied", 403));
    await assert.rejects(client.setRenewal(fixture.subscriptionId, true, fixture.commandKey), expectError(module, "permission_denied", 403));
    assert.deepEqual(calls.map(call => call.init.method), ["GET", "POST"]);
  });
  test(`${label}: catalog/checkout/portal cannot bypass app-scope permission errors`, options, async () => {
    const module = load(), { client, calls } = mock(module, { error: "app_scope_required" }, 403);
    for (const invoke of [() => client.getCatalog(), () => client.getCheckout(fixture.checkoutId), () => client.createPortalSession(fixture.subscriptionId)])
      await assert.rejects(invoke(), expectError(module, "app_scope_required", 403));
    assert.equal(calls.length, 3);
  });
  test(`${label}: unknown provider error/HTML sanitized, invalid response write remains unknown`, options, async () => {
    const module = load(), { client } = mock(module, { error: "<html>raw secret</html>" }, 500);
    await assert.rejects(client.createCheckout(fixture.checkoutInput, fixture.commandKey), expectError(module, "api_error", 500, true));
    const malformed = module.createPagaYaClient({ baseUrl: "https://pagaya.test.invalid", apiKey: "pk_test_LOCAL_FIXTURE_ONLY",
      fetch: async () => new Response("<html>raw secret</html>", { status: 502 }) });
    await assert.rejects(malformed.createCheckout(fixture.checkoutInput, fixture.commandKey), expectError(module, "invalid_response", 502, true));
  });
}

contracts("official public snapshot", () => official);
// Registered after the source qualification above. Missing actual source never becomes PASS.
contracts("actual FIN copy", () => actualCopy, receiptPath ? false : "NOT_RUN: closed FIN owner source receipt not supplied");
