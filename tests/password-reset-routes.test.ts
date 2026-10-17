import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const unavailableMessage = "El servidor no pudo completar la operación. Probá de nuevo en unos segundos.";
function compilePost(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(path, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(code, {
    module, exports: module.exports, Request, Response, Date, JSON, console,
    require: (specifier: string) => {
      if (specifier in mocks) return mocks[specifier];
      if (specifier === "node:crypto") return require("node:crypto");
      throw new Error(`Unexpected import in fixture: ${specifier}`);
    },
  });
  return module.exports.POST as (request: Request) => Promise<Response>;
}
function common(mocks: Record<string, unknown>) {
  return {
    "@/lib/server/rate-limit": { getClientIp: () => "198.51.100.10", rateLimit: async () => ({ allowed: true, retryAfter: 10 }) },
    "@/lib/server/validation": {
      forgotPasswordSchema: { safeParse: (value: any) => ({ success: true, data: { email: value.email, website: "", honeypot: "" } }) },
      resetPasswordSchema: { safeParse: (value: any) => ({ success: true, data: { token: value.token, password: value.password, website: "", honeypot: "" } }) },
      isHoneypotTriggered: () => false,
      validationError: () => Response.json({ error: "invalid" }, { status: 400 }),
    },
    "@/lib/server/http": { jsonError: (error: string, status: number) => Response.json({ error }, { status }), readJson: (request: Request) => request.json() },
    "@/lib/server/auth-http": {
      authUnavailable: (operation: string, error: unknown) => {
        const row = error as { name?: string; code?: string };
        return Response.json({ error: unavailableMessage, operation, diagnostic: { name: row?.name ?? "Error", code: row?.code } }, { status: 503 });
      },
      isHttpResponse: (value: unknown) => value instanceof Response,
    },
    ...mocks,
  };
}
const request = (path: string, body: Record<string, unknown>) => new Request(`https://example.invalid${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.10" }, body: JSON.stringify(body) });

function resetFixture(options: { lookupError?: Error; transactionError?: Error; claimCount?: number; cookieError?: Error } = {}) {
  const writes: string[] = [];
  const token = { id: "reset-fixture", userId: "user-fixture", usedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const tx = {
    passwordResetToken: { updateMany: async () => { writes.push("claim-token"); return { count: options.claimCount ?? 1 }; } },
    adminUser: { update: async () => { writes.push("update-password"); if (options.transactionError) throw options.transactionError; return {}; } },
    adminSession: { updateMany: async () => { writes.push("revoke-sessions"); return { count: 1 }; } },
  };
  const db = {
    passwordResetToken: { findUnique: async () => { if (options.lookupError) throw options.lookupError; return token; } },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const mocks = common({
    "@/lib/server/db": { db },
    "@/lib/server/auth": { clearSessionCookie: async () => { writes.push("clear-cookie"); if (options.cookieError) throw options.cookieError; }, hashPassword: async () => "bcrypt-fixture-hash", tokenDigest: (raw: string) => `digest:${raw}` },
  });
  return { post: compilePost("app/api/auth/reset-password/route.ts", mocks), writes };
}

test("reset password converts a preflight database outage into a stable public 503", async () => {
  const { post, writes } = resetFixture({ lookupError: Object.assign(new Error("private database detail"), { code: "P1001" }) });
  const response = await post(request("/api/auth/reset-password", { token: "fixture-token", password: "fixture-password" }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, unavailableMessage);
  assert.equal(body.diagnostic.code, "P1001");
  assert.deepEqual(writes, []);
});

test("reset transaction outage returns 503 without clearing cookies or claiming success", async () => {
  const { post, writes } = resetFixture({ transactionError: Object.assign(new Error("private database detail"), { code: "P2025" }) });
  const response = await post(request("/api/auth/reset-password", { token: "fixture-token", password: "fixture-password" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, unavailableMessage);
  assert.deepEqual(writes, ["claim-token", "update-password"]);
});

test("a token claimed concurrently remains a client error, not infrastructure 503", async () => {
  const { post, writes } = resetFixture({ claimCount: 0 });
  const response = await post(request("/api/auth/reset-password", { token: "fixture-token", password: "fixture-password" }));
  assert.equal(response.status, 400);
  assert.deepEqual(writes, ["claim-token"]);
});

test("cookie cleanup failure after committed reset still returns success because all sessions were revoked", async () => {
  const { post, writes } = resetFixture({ cookieError: new Error("fixture cookie store unavailable") });
  const response = await post(request("/api/auth/reset-password", { token: "fixture-token", password: "fixture-password" }));
  assert.equal(response.status, 200);
  assert.deepEqual(writes, ["claim-token", "update-password", "revoke-sessions", "clear-cookie"]);
});

test("forgot password keeps unknown-account and mail-delivery-failure responses indistinguishable", async () => {
  const route = (user: unknown, send: () => Promise<void>) => compilePost("app/api/auth/forgot-password/route.ts", common({
    "node:crypto": require("node:crypto"),
    "@/lib/server/db": { db: {
      adminUser: { findUnique: async () => user },
      passwordResetToken: { deleteMany: async () => ({}), create: async () => ({}) },
    } },
    "@/lib/server/auth": { createOpaqueToken: () => "opaque-fixture", normalizeUserEmail: (email: string) => email.toLowerCase(), tokenDigest: (token: string) => `digest:${token}` },
    "@/lib/server/config": { authConfig: { passwordResetDurationMs: 1_800_000 } },
    "@/lib/server/resend": { sendPasswordResetEmail: send },
  }));
  const unknown = await route(null, async () => { throw new Error("should not send"); })(request("/api/auth/forgot-password", { email: "unknown@example.invalid" }));
  const failedDelivery = await route({ id: "user-fixture", email: "known@example.invalid" }, async () => { throw new Error("PASSWORD_RESET_EMAIL_FAILED"); })(request("/api/auth/forgot-password", { email: "known@example.invalid" }));
  assert.equal(unknown.status, 200); assert.equal(failedDelivery.status, 200);
  assert.deepEqual(await unknown.json(), await failedDelivery.json());
});

test("forgot password maps database outage to 503 independently of account lookup result", async () => {
  const post = compilePost("app/api/auth/forgot-password/route.ts", common({
    "node:crypto": require("node:crypto"),
    "@/lib/server/db": { db: { adminUser: { findUnique: async () => { throw Object.assign(new Error("private database detail"), { code: "P1001" }); } } } },
    "@/lib/server/auth": { createOpaqueToken: () => "opaque-fixture", normalizeUserEmail: (email: string) => email.toLowerCase(), tokenDigest: (token: string) => `digest:${token}` },
    "@/lib/server/config": { authConfig: { passwordResetDurationMs: 1_800_000 } },
    "@/lib/server/resend": { sendPasswordResetEmail: async () => {} },
  }));
  const response = await post(request("/api/auth/forgot-password", { email: "fixture@example.invalid" }));
  assert.equal(response.status, 503);
  const body = await response.json(); assert.equal(body.error, unavailableMessage); assert.equal(body.diagnostic.code, "P1001");
});
