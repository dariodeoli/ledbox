import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isGoogleAuthOriginAllowed } from "../lib/server/google-origin";
import { GET as startGoogleLogin } from "../app/api/auth/login/google/route";

const request = (url: string, headers?: Record<string, string>) => new Request(url, { headers });

test("Google SSO accepts the configured EventOS administration origin", () => {
  assert.equal(
    isGoogleAuthOriginAllowed(request("https://app.eventoss.online/api/auth/login/google"), "https://app.eventoss.online"),
    true,
  );
});

test("Google SSO rejects another tenant/store host and a forged forwarded host", () => {
  assert.equal(
    isGoogleAuthOriginAllowed(request("https://clientes.eventoss.online/api/auth/login/google"), "https://app.eventoss.online"),
    false,
  );
  assert.equal(
    isGoogleAuthOriginAllowed(request("https://app.eventoss.online/api/auth/login/google", {
      host: "app.eventoss.online",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "https",
    }), "https://app.eventoss.online"),
    false,
  );
});

test("Google SSO allows HTTP loopback only outside production", () => {
  const env = process.env as Record<string, string | undefined>;
  const oldMode = env.NODE_ENV;
  try {
    env.NODE_ENV = "test";
    assert.equal(isGoogleAuthOriginAllowed(request("http://localhost:3000/api/auth/login/google"), "https://app.eventoss.online"), true);
    env.NODE_ENV = "production";
    assert.equal(isGoogleAuthOriginAllowed(request("http://localhost:3000/api/auth/login/google"), "https://app.eventoss.online"), false);
  } finally {
    if (oldMode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = oldMode;
  }
});

test("both Google endpoints enforce the configured administration origin", () => {
  for (const file of ["app/api/auth/login/google/route.ts", "app/api/auth/callback/google/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /isGoogleAuthOriginAllowed\(request\)/, `${file} must reject unconfigured hosts`);
  }
});

test("Google login emits the EventOS callback URI and rejects a non-admin host", async () => {
  const env = process.env as Record<string, string | undefined>;
  const oldClientId = env.GOOGLE_CLIENT_ID;
  const oldAdminUrl = env.NEXT_PUBLIC_ADMIN_URL;
  const oldMode = env.NODE_ENV;
  try {
    env.GOOGLE_CLIENT_ID = "fixture-client-id";
    env.NEXT_PUBLIC_ADMIN_URL = "https://app.eventoss.online";
    env.NODE_ENV = "production";
    const accepted = await startGoogleLogin(request("https://app.eventoss.online/api/auth/login/google"));
    assert.equal(accepted.status, 302);
    const googleUrl = new URL(accepted.headers.get("location")!);
    assert.equal(googleUrl.searchParams.get("redirect_uri"), "https://app.eventoss.online/api/auth/callback/google");
    assert.equal(googleUrl.searchParams.get("scope"), "openid email profile");

    const rejected = await startGoogleLogin(request("https://clientes.eventoss.online/api/auth/login/google"));
    assert.equal(rejected.status, 404);
  } finally {
    if (oldClientId === undefined) delete env.GOOGLE_CLIENT_ID;
    else env.GOOGLE_CLIENT_ID = oldClientId;
    if (oldAdminUrl === undefined) delete env.NEXT_PUBLIC_ADMIN_URL;
    else env.NEXT_PUBLIC_ADMIN_URL = oldAdminUrl;
    if (oldMode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = oldMode;
  }
});
