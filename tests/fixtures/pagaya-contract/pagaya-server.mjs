/** Copy this Node.js ESM module into your server. No npm package is published. */
import { createHmac, timingSafeEqual } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apiErrors = new Set([
  "invalid_api_key", "app_scope_required", "permission_denied", "not_found",
  "rate_limited", "invalid_request", "idempotency_key_required", "idempotency_conflict",
  "price_not_found", "app_not_found", "mode_mismatch", "merchant_payment_setup_incomplete",
  "checkout_in_progress", "checkout_terminal", "checkout_recovery_requires_review",
  "checkout_failed_new_key_required", "checkout_unconfirmed", "checkout_persistence_pending",
  "checkout_provider_unavailable", "stripe_not_configured", "stripe_live_not_enabled",
  "subscription_binding_unverified", "subscription_mutation_unavailable", "subscription_mutation_conflict",
  "portal_unavailable", "internal_error",
  "subscription_action_not_submitted", "subscription_action_unconfirmed",
  "subscription_failure_persistence_pending", "subscription_submission_persistence_pending",
]);

export class PagaYaError extends Error {
  constructor(code, { status = 0, outcomeUnknown = false, retryAfterSeconds = null } = {}) {
    super(code);
    this.name = "PagaYaError";
    this.code = code;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function id(value) {
  if (typeof value !== "string" || !uuid.test(value)) throw new PagaYaError("invalid_request");
  return value;
}

function commandKey(value) {
  if (typeof value !== "string" || !/^[\x21-\x7e]{8,160}$/.test(value)) {
    throw new PagaYaError("idempotency_key_required");
  }
  return value;
}

/** Server-only: never use NEXT_PUBLIC_/VITE_ variables or import into browser code. */
export function createPagaYaClient({ baseUrl, apiKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  let origin;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    origin = url.origin;
  } catch { throw new PagaYaError("invalid_configuration"); }
  if (typeof window !== "undefined" || typeof apiKey !== "string" || !/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(apiKey)
    || typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new PagaYaError("invalid_configuration");
  }

  async function request(path, body, key) {
    const write = body !== undefined;
    let response;
    try {
      response = await fetchImpl(`${origin}/api/v1/${path}`, {
        method: write ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`, Accept: "application/json",
          ...(write ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(write ? { body: JSON.stringify(body) } : {}),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new PagaYaError("transport_error", { outcomeUnknown: write }); }
    let result;
    try { result = await response.json(); }
    catch { throw new PagaYaError("invalid_response", { status: response.status, outcomeUnknown: write }); }
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const retryAfterSeconds = retry && /^\d{1,5}$/.test(retry) ? Number(retry) : null;
      throw new PagaYaError(apiErrors.has(result?.error) ? result.error : "api_error", {
        status: response.status, outcomeUnknown: write && response.status >= 500,
        retryAfterSeconds,
      });
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new PagaYaError("invalid_response", { status: response.status, outcomeUnknown: write });
    }
    return result;
  }

  return Object.freeze({
    getCatalog: () => request("catalog"),
    createCheckout: (input, idempotencyKey) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new PagaYaError("invalid_request");
      return request("checkouts", input, commandKey(idempotencyKey));
    },
    getCheckout: (checkoutId) => request(`checkouts/${id(checkoutId)}`),
    getSubscription: (subscriptionId) => request(`subscriptions/${id(subscriptionId)}`),
    setRenewal: (subscriptionId, cancelAtPeriodEnd, idempotencyKey) => {
      if (typeof cancelAtPeriodEnd !== "boolean") throw new PagaYaError("invalid_request");
      return request(`subscriptions/${id(subscriptionId)}`, { cancelAtPeriodEnd }, commandKey(idempotencyKey));
    },
    createPortalSession: (subscriptionId) => request(`subscriptions/${id(subscriptionId)}/portal`, {}),
  });
}

/** Verify ORIGINAL bytes before JSON parsing; deduplicate/persist the event separately. */
export function verifyPagaYaWebhook(rawBody, signature, secret, { nowMs = Date.now(), toleranceSeconds = 300 } = {}) {
  if ((typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) || typeof signature !== "string"
    || typeof secret !== "string" || !secret || !Number.isFinite(nowMs)
    || !Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 1 || toleranceSeconds > 300) return false;
  const match = /^t=([1-9]\d{0,15}),v1=([a-f0-9]{64})$/.exec(signature);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(match[1]).update(".").update(rawBody).digest();
  const supplied = Buffer.from(match[2], "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
