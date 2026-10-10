import assert from "node:assert/strict";
import { test } from "node:test";
import { MobileClient, MobileError, type Fetcher, type SecretStore } from "../src/api/client";
import { mobileContract } from "../src/api/contract";

const me = (organizationId = "a") => ({ version: 1, user: { id: "user", name: "Usuario", email: "user@example.invalid" },
  organizations: [{ id: "a", name: "A", slug: "a", role: "OPERATIONS" }, { id: "b", name: "B", slug: "b", role: "VIEWER" }],
  activeOrganization: { id: organizationId, name: organizationId, slug: organizationId, role: "OPERATIONS" },
  capabilities: [], session: { expiresAt: "2026-12-01T00:00:00Z" } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function store(): SecretStore & { value: string | null } {
  return { value: null, async read() { return this.value; }, async write(value) { this.value = value; }, async clear() { this.value = null; } };
}
function authenticated(fetcher: Fetcher) {
  const secret = store(); secret.value = "personal-session";
  const client = new MobileClient("https://backend.example.invalid", mobileContract, secret, fetcher);
  return { client, secret };
}

test("login binds PF Bearer envelope, never persists password or cookies", async () => {
  const secret = store();
  const requests: RequestInit[] = [];
  const client = new MobileClient("https://backend.example.invalid", mobileContract, secret, async (url, init) => {
    requests.push(init);
    if (url.endsWith("/login")) {
      assert.deepEqual(JSON.parse(init.body as string), { email: "user@example.invalid", password: "private" });
      assert.equal((init.headers as Record<string, string>).Authorization, undefined);
      return json({ version: 1, session: { accessToken: "revocable-token", tokenType: "Bearer", expiresAt: me().session.expiresAt }, organizationId: "a" });
    }
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer revocable-token");
    return json(me());
  });
  assert.equal((await client.login(" USER@example.invalid ", "private")).activeCompanyId, "a");
  assert.equal(secret.value, "revocable-token");
  assert.ok(requests.every(request => request.credentials === "omit" && request.redirect === "error"));
});

test("401 clears personal secret and expires UI; 403 preserves session", async () => {
  let status = 200;
  const { client, secret } = authenticated(async () => json(status === 200 ? me() : { error: "denied" }, status));
  await client.restore(); let expired = 0; client.onExpired = () => expired++;
  status = 403;
  await assert.rejects(client.profile(), (error: unknown) => error instanceof MobileError && error.code === "FORBIDDEN");
  assert.equal(secret.value, "personal-session"); assert.equal(expired, 0);
  status = 401;
  await assert.rejects(client.profile(), (error: unknown) => error instanceof MobileError && error.code === "UNAUTHENTICATED");
  assert.equal(secret.value, null); assert.equal(expired, 1);
});

test("company switch invalidates old in-flight calendar without tenant query injection", async () => {
  let resolveOld!: (response: Response) => void;
  let switched = false;
  const { client } = authenticated(async (url, init) => {
    if (url.includes("/calendar")) return new Promise<Response>(resolve => { resolveOld = resolve; });
    if (url.endsWith("/active-organization")) { assert.deepEqual(JSON.parse(init.body as string), { organizationId: "b" }); switched = true; return json({ organizationId: "b" }); }
    return json(me(switched ? "b" : "a"));
  });
  await client.restore();
  const old = client.calendar("2026-10-01", "2026-10-31");
  const rejection = assert.rejects(old, (error: unknown) => error instanceof MobileError && error.code === "STALE_CONTEXT");
  assert.equal((await client.switchCompany("b")).activeCompanyId, "b");
  resolveOld(json({ version: 1, events: [], items: [], timeZone: "America/Asuncion", page: { hasMore: false, nextAfter: null } }));
  await rejection;
});

test("pending contract and non-HTTPS origin cannot emit requests", async () => {
  let requests = 0; const fetcher: Fetcher = async () => { requests++; return json({}); };
  const pending = new MobileClient("https://backend.example.invalid", { status: "PENDING_PF", version: null, routes: {} }, store(), fetcher);
  await assert.rejects(pending.login("a", "b"), (error: unknown) => error instanceof MobileError && error.code === "CONTRACT_PENDING");
  const insecure = new MobileClient("http://backend.example.invalid", mobileContract, store(), fetcher);
  await assert.rejects(insecure.login("a", "b"), (error: unknown) => error instanceof MobileError && error.code === "CONFIGURATION");
  assert.equal(requests, 0);
});

test("calendar walks PF pages, merges setup/strike and rejects repeated cursors", async () => {
  let repeats = false;
  const { client } = authenticated(async url => {
    if (url.endsWith("/me")) return json(me());
    const query = new URL(url).searchParams;
    assert.equal(query.has("organizationId"), false);
    const second = query.get("after") === "e1";
    const id = second ? "e2" : "e1";
    const event = { id, name: id, status: "CONFIRMED", location: "Sala", city: null, startsAt: "2026-10-02T12:00:00Z", endsAt: null, setupAt: null, strikeAt: null };
    return json({ version: 1, events: [event], from: query.get("from"), to: query.get("to"), timeZone: "America/Asuncion",
      items: [{ id: `setup:${id}`, eventId: id, kind: "setup", date: "2026-10-01", at: "2026-10-01T12:00:00Z", endAt: null }],
      page: { hasMore: repeats || !second, nextAfter: repeats || !second ? "e1" : null } });
  });
  await client.restore();
  const result = await client.calendar("2026-10-01", "2026-10-31");
  assert.deepEqual(result.events.map(event => event.eventId), ["e1", "e2"]);
  assert.ok(result.events.every(event => event.kind === "setup" && event.name.startsWith("Montaje · ")));
  assert.equal(result.truncated, false);
  repeats = true;
  await assert.rejects(client.calendar("2026-10-01", "2026-10-31"), (error: unknown) => error instanceof MobileError && error.code === "INVALID_RESPONSE");
});

test("logout confirms server revocation before erasing token; network failure preserves retry", async () => {
  let offline = true;
  const { client, secret } = authenticated(async url => {
    if (url.endsWith("/me")) return json(me());
    if (offline) throw new Error("offline");
    assert.equal(secret.value, "personal-session");
    return json({ loggedOut: true });
  });
  await client.restore();
  await assert.rejects(client.logout()); assert.equal(secret.value, "personal-session");
  offline = false; await client.logout(); assert.equal(secret.value, null);
});

test("account deletion uses PF DELETE and reauthentication; last-owner conflict preserves account", async () => {
  let conflict = true;
  const { client, secret } = authenticated(async (url, init) => {
    if (url.endsWith("/me")) return json(me());
    assert.ok(url.endsWith("/account")); assert.equal(init.method, "DELETE");
    assert.deepEqual(JSON.parse(init.body as string), { password: "reauth", confirmation: "DELETE_ACCOUNT" });
    return conflict ? json({ error: "transfer", code: "OWNER_TRANSFER_REQUIRED" }, 409) : json({ deleted: true, retained: ["organization_records", "financial_records", "signed_documents", "audit_history"] });
  });
  await client.restore();
  await assert.rejects(client.deleteAccount("reauth"), (error: unknown) => error instanceof MobileError && error.status === 409);
  assert.equal(secret.value, "personal-session");
  conflict = false; assert.equal((await client.deleteAccount("reauth")).status, "DELETED"); assert.equal(secret.value, null);
});

test("wrong deletion password does not erase a still valid personal session", async () => {
  const { client, secret } = authenticated(async url => url.endsWith("/me") ? json(me()) : json({ error: "reauth", code: "reauthentication_required" }, 401));
  await client.restore();
  await assert.rejects(client.deleteAccount("wrong"));
  assert.equal(secret.value, "personal-session");
});
