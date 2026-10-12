import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createPagaYaClient, PagaYaError, verifyPagaYaWebhook } from "../lib/server/pagaya/pagaya-server.mjs";

const id = "00000000-0000-0000-0000-000000000001";
const key = "offline-command-182";
const fixture = { baseUrl: "https://pagaya.invalid", apiKey: "pk_test_offline_fixture" };

test("#182 official copy has the pinned SHA256", () => {
  const bytes = readFileSync(new URL("../lib/server/pagaya/pagaya-server.mjs", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "b4fb131e3676898312bcb20f94280f3b2aced8e8bde5c4d1d8eb07abf1dbeb45");
});

test("#182 official checkout sends the supplied immutable key/body once without cache or redirect", async () => {
  const calls = [];
  const client = createPagaYaClient({ ...fixture, fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ checkout: { id, status: "pending" } });
  } });
  const input = { priceVersionId: id, externalReference: "offline-enrollment", customer: { name: "Offline", email: "offline@example.invalid", phone: "+595000000000" } };
  await client.createCheckout(input, key);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://pagaya.invalid/api/v1/checkouts");
  assert.equal(calls[0].options.headers["Idempotency-Key"], key);
  assert.equal(calls[0].options.body, JSON.stringify(input));
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
});

test("#182 transport uncertainty preserves unknown write outcome and never auto retries", async () => {
  let calls = 0;
  const client = createPagaYaClient({ ...fixture, fetch: async () => { calls++; throw new Error("private provider detail"); } });
  await assert.rejects(client.createCheckout({}, key), (error) => error instanceof PagaYaError && error.outcomeUnknown && error.code === "transport_error" && !error.message.includes("private"));
  assert.equal(calls, 1);
});

test("#182 renewal true means cancelAtPeriodEnd true and pending response is preserved", async () => {
  let body;
  const pending = { subscription: { id, cancelAtPeriodEnd: false }, mutation: { status: "processing", awaitingWebhook: true } };
  const client = createPagaYaClient({ ...fixture, fetch: async (url, options) => {
    assert.equal(url, `https://pagaya.invalid/api/v1/subscriptions/${id}`);
    assert.equal(options.headers["Idempotency-Key"], key);
    body = options.body;
    return Response.json(pending, { status: 202 });
  } });
  assert.deepEqual(await client.setRenewal(id, true, key), pending);
  assert.equal(body, '{"cancelAtPeriodEnd":true}');
});

test("#182 invalid IDs/command keys fail before mocked transport; errors stay sanitized and rate limits actionable", async () => {
  let calls = 0;
  const client = createPagaYaClient({ ...fixture, fetch: async () => { calls++; return Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "30" } }); } });
  assert.throws(() => client.getSubscription("foreign-browser-text"), PagaYaError);
  assert.throws(() => client.setRenewal(id, true, "bad key"), PagaYaError);
  assert.equal(calls, 0);
  await assert.rejects(client.getCatalog(), (error) => error.status === 429 && error.retryAfterSeconds === 30 && !error.outcomeUnknown);
  assert.equal(calls, 1);
});

test("#182 portal uses the original subscription path with empty body and no return/customer override", async () => {
  const client = createPagaYaClient({ ...fixture, fetch: async (url, options) => {
    assert.equal(url, `https://pagaya.invalid/api/v1/subscriptions/${id}/portal`);
    assert.equal(options.body, "{}");
    assert.equal(options.cache, "no-store");
    return Response.json({ url: "https://portal.example.invalid/ephemeral" });
  } });
  assert.deepEqual(await client.createPortalSession(id), { url: "https://portal.example.invalid/ephemeral" });
});

test("#182 raw-body HMAC rejects mutation, duplicate signature headers and expired timestamp", () => {
  const raw = new TextEncoder().encode('{"id":"offline-event"}');
  const timestamp = "1700000000";
  const secret = "offline-fixture-secret";
  const signature = `t=${timestamp},v1=${createHmac("sha256", secret).update(timestamp).update(".").update(raw).digest("hex")}`;
  const options = { nowMs: 1700000000000 };
  assert.equal(verifyPagaYaWebhook(raw, signature, secret, options), true);
  assert.equal(verifyPagaYaWebhook(raw, `${signature},${signature}`, secret, options), false);
  assert.equal(verifyPagaYaWebhook(new TextEncoder().encode('{ "id":"offline-event"}'), signature, secret, options), false);
  assert.equal(verifyPagaYaWebhook(raw, signature, secret, { nowMs: options.nowMs + 301000 }), false);
});
