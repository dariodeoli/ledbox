import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
const base = process.env.ORG_SLUG_TEST_BASE_URL;
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(url));

test("slug HTTP/PG local: alias duradero, carreras, token, logo, default y namespaces compartidos", { skip: !enabled, timeout: 120000 }, async t => {
  process.env.DATABASE_URL = url;
  const { Prisma, PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const { createSession } = await import("../lib/server/auth");
  const { resolveOrganizationSlugId, claimOrganizationSlug, assertOrganizationSlugAvailable, OrganizationSlugTaken } = await import("../lib/server/organization-slugs");
  const { resolvePublicCatalog, resolveWholesaleCatalog } = await import("../lib/server/catalog-public");
  const { catalogTokenValue, catalogTokenHash } = await import("../lib/server/catalog-access");
  const { resolveDefaultOrganizationId } = await import("../lib/server/tenancy");
  const { createOrganizationWithOwnerInvite } = await import("../lib/platform/alta-empresa-server");
  const run = randomUUID().slice(0, 8), A = `slug-A-${run}`, B = `slug-B-${run}`, D = `slug-D-${run}`;
  const old = `slug-old-${run}`, first = `slug-first-${run}`, second = `slug-second-${run}`, other = `slug-other-${run}`, race = `slug-race-${run}`, planId = `slug-plan-${run}`;
  const userIds: string[] = [], sessions: string[] = [];
  const envDefault = process.env.DEFAULT_ORGANIZATION_SLUG;
  const endpoint = "/api/admin/organization/branding";
  const req = (cookie: string, body: unknown, demoHost = false) => fetch(`${base}${endpoint}`, { method: "PATCH", headers: { Cookie: demoHost ? cookie.replace(/^ledbox_session=/, "ledbox_demo=") : cookie, "Content-Type": "application/json", ...(demoHost ? { "X-Forwarded-Host": "demo.localhost:3160" } : {}) }, body: JSON.stringify(body) });
  async function cookie(org: string, role: "OWNER" | "VIEWER" = "OWNER") {
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "Slug QA", email: `${randomUUID()}@example.invalid`, role, passwordHash: "not-a-login", autoLockEnabled: false } }); userIds.push(user.id);
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId: org, role } });
    const session = await createSession(user, org); sessions.push(session.sessionId); return `ledbox_session=${session.jwt}`;
  }
  try {
    await db.plan.create({ data: { id: planId, code: planId, name: "Slug QA", priceMonthly: 0 } });
    await db.organization.createMany({ data: [{ id: A, name: "Slug A", slug: old, planId }, { id: B, name: "Slug B", slug: other, planId }, { id: D, name: "Slug Demo", slug: `slug-demo-${run}`, isDemo: true, demoParentId: A, demoReady: true, demoExpiresAt: new Date(Date.now() + 3600000), demoLastSeenAt: new Date(), planId }] });
    await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: A, publicCatalogEnabled: true, publicShowPrices: true } });
    const a = await cookie(A), b = await cookie(B), viewer = await cookie(A, "VIEWER"), demo = await cookie(D);
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: A, name: "Cliente ficticio" } });
    const token = catalogTokenValue();
    await db.catalogAccessToken.create({ data: { id: randomUUID(), organizationId: A, clientId: client.id, tokenHash: catalogTokenHash(token), priceList: "WHOLESALE" } });
    const bytes = Buffer.from("logo-ficticio");
    await db.organizationLogo.create({ data: { id: randomUUID(), organizationId: A, variant: "light", mime: "image/webp", size: bytes.length, data: bytes } });
    await t.test("rename preserva ID, guarda alias y CAS; JSON/roles/demo no mutan", async () => {
      assert.equal((await req(viewer, { slug: first, expectedSlug: old })).status, 403);
      assert.equal((await req(demo, { slug: `demo-new-${run}`, expectedSlug: `slug-demo-${run}` })).status, 401, "la sesión demo no vale en el host real");
      assert.equal((await req(demo, { slug: `demo-new-${run}`, expectedSlug: `slug-demo-${run}` }, true)).status, 403, "en su host la demo sigue sin poder cambiar identidad");
      assert.equal((await req(a, null)).status, 400);
      assert.equal((await req(a, { slug: first })).status, 409);
      assert.equal((await req(a, { slug: first, expectedSlug: old, organizationId: B })).status, 200);
      const saved = await db.organization.findUniqueOrThrow({ where: { id: A } }); assert.equal(saved.slug, first); assert.equal(saved.id, A);
      assert.equal(await resolveOrganizationSlugId(old), A); assert.equal(await resolveOrganizationSlugId(first), A);
      assert.equal((await req(a, { slug: second, expectedSlug: old })).status, 409);
      const metadata = await fetch(`${base}${endpoint}`, { headers: { Cookie: a } }); const dto = await metadata.json(); assert.ok(dto.organization.slugAliases.includes(old));
    });
    await t.test("alias conserva catálogo público, tokens propios, logo y default", async () => {
      assert.equal((await resolvePublicCatalog(old))?.organization.id, A); assert.equal((await resolvePublicCatalog(first))?.organization.id, A);
      assert.equal((await resolveWholesaleCatalog(old, token))?.organization.id, A); assert.equal(await resolveWholesaleCatalog(other, token), null);
      const logo = await fetch(`${base}/api/mail/logo/${old}/light`); assert.equal(logo.status, 200); assert.deepEqual(Buffer.from(await logo.arrayBuffer()), bytes);
      const cart = await fetch(`${base}/api/catalog/${old}/cart`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [] }) }); assert.equal(cart.status, 200);
      process.env.DEFAULT_ORGANIZATION_SLUG = old; assert.equal(await resolveDefaultOrganizationId(), A);
    });
    await t.test("slug anterior no se apropia desde otra empresa ni desde ALTA", async () => {
      assert.equal((await req(b, { slug: old, expectedSlug: other })).status, 409);
      const alta = await createOrganizationWithOwnerInvite({ name: "No debe crearse", slug: old, planCode: planId, invitees: [{ email: `no-send-${run}@example.invalid`, role: "OWNER" }] }, { userId: userIds[0], email: "plataforma@example.invalid" });
      assert.equal(alta.ok, false); if (!alta.ok) assert.equal(alta.status, 409);
      assert.equal(await db.teamInvitation.count({ where: { email: `no-send-${run}@example.invalid` } }), 0);
    });
    await t.test("dos tenants compiten por un slug: uno200 otro409; dos CAS del mismo tenant sólo uno", async () => {
      const responses = await Promise.all([req(a, { slug: race, expectedSlug: first }), req(b, { slug: race, expectedSlug: other })]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
      const org = await db.organization.findUniqueOrThrow({ where: { id: A } });
      const same = await Promise.all([req(a, { slug: `slug-next-a-${run}`, expectedSlug: org.slug }), req(a, { slug: `slug-next-b-${run}`, expectedSlug: org.slug })]);
      assert.deepEqual(same.map(r => r.status).sort(), [200, 409]);
      assert.equal(await resolveOrganizationSlugId(old), A); assert.equal(await resolveDefaultOrganizationId(), A);
      await db.organization.update({ where: { id: A }, data: { active: false } });
      assert.equal(await resolveDefaultOrganizationId(), null, "default inactivo no desvía leads");
      await db.organization.update({ where: { id: A }, data: { active: true } });
    });
    await t.test("name-only conserva legacy reservado y namespace sobrevive borrar empresa", async () => {
      // Fixture directa histórica, no un alta que eluda validadores de producto.
      const legacy = `slug-legacy-${run}`;
      await db.organization.create({ data: { id: legacy, slug: `Legacy_${run}`, name: "Historia", planId } });
      try {
        const auth = await cookie(legacy);
        assert.equal((await req(auth, { name: "Historia editada" })).status, 200);
        assert.equal((await db.organization.findUniqueOrThrow({ where: { id: legacy } })).slug, `Legacy_${run}`);
        await db.$transaction(tx => claimOrganizationSlug(tx, `Legacy_${run}`, legacy));
        await db.organization.delete({ where: { id: legacy } });
        assert.equal(await resolveOrganizationSlugId(`Legacy_${run}`), null);
        process.env.DEFAULT_ORGANIZATION_SLUG = `Legacy_${run}`; assert.equal(await resolveDefaultOrganizationId(), null, "tombstone default no desvía leads");
        process.env.DEFAULT_ORGANIZATION_SLUG = old;
        await assert.rejects(() => db.$transaction(tx => assertOrganizationSlugAvailable(tx, `Legacy_${run}`, B)), OrganizationSlugTaken);
      } finally { await db.organization.deleteMany({ where: { id: legacy } }); await db.$executeRaw(Prisma.sql`DELETE FROM "OrganizationSlug" WHERE "organizationId" = ${legacy}`); }
    });
    await t.test("default configurado ausente no puede apropiarse del fallback", async () => {
      const missing = `slug-default-missing-${run}`; process.env.DEFAULT_ORGANIZATION_SLUG = missing;
      const fallback = await resolveDefaultOrganizationId(); assert.ok(fallback);
      const attacker = fallback === A ? B : A;
      await assert.rejects(() => db.$transaction(tx => assertOrganizationSlugAvailable(tx, missing, attacker)), OrganizationSlugTaken);
      assert.equal(await resolveDefaultOrganizationId(), fallback);
    });
  } finally {
    if (envDefault === undefined) delete process.env.DEFAULT_ORGANIZATION_SLUG; else process.env.DEFAULT_ORGANIZATION_SLUG = envDefault;
    await db.adminSession.deleteMany({ where: { id: { in: sessions } } });
    await db.organization.deleteMany({ where: { id: { in: [A, B, D] } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
    await db.$executeRaw(Prisma.sql`DELETE FROM "OrganizationSlug" WHERE "organizationId" IN (${A}, ${B}, ${D})`);
    await db.plan.deleteMany({ where: { id: planId } }); await db.$disconnect();
  }
});
