import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { SignJWT } from "jose";
import { resolveMobileToken } from "../lib/server/mobile/session-token";

test("mobile token requires live DB session even with valid signature and OWNER claim", async () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const secret = new TextEncoder().encode("local-unit-test-session-secret-only");
  const token = await new SignJWT({ role: "OWNER" }).setProtectedHeader({ alg: "HS256" }).setSubject("user").setJti("jti").setExpirationTime(Math.floor(now.getTime() / 1000) + 60).sign(secret);
  const live = { userId: "user", jtiHash: createHash("sha256").update("jti").digest("hex"), revokedAt: null, expiresAt: new Date(now.getTime() + 60000), user: { active: true } };
  assert.equal(await resolveMobileToken(token, secret, async () => null, now), null);
  assert.equal(await resolveMobileToken(token, secret, async () => ({ ...live, revokedAt: now }), now), null);
  assert.equal(await resolveMobileToken(token, secret, async () => ({ ...live, expiresAt: now }), now), null);
  assert.equal(await resolveMobileToken(token, secret, async () => ({ ...live, user: { active: false } }), now), null);
  assert.equal(await resolveMobileToken(token, secret, async () => ({ ...live, userId: "another" }), now), null);
  assert.equal(await resolveMobileToken(token, secret, async () => live, now), live);
  assert.equal(await resolveMobileToken(token, new TextEncoder().encode("wrong"), async () => live, now), null);
  assert.equal(await resolveMobileToken(token, secret, async () => live, new Date(now.getTime() + 60001)), null);
});
