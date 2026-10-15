import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/platform-alta.pg.test.ts
test("alta de empresa desde plataforma: empresa + invitación OWNER, slug repetido 409, reenvío y guard", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createOrganizationWithOwnerInvite, resendInvitation } = await import("../lib/platform/alta-empresa-server");
  const { upsertInvitation, acceptInvitationWithPassword } = await import("../lib/server/invitations");
  const { hashPassword } = await import("../lib/server/auth");
  const { PLATFORM_OWNER_EMAIL } = await import("../lib/platform/access");

  const run = randomUUID().slice(0, 8);
  const actor = { userId: `plat-${run}`, email: PLATFORM_OWNER_EMAIL };
  const planCode = `plan-${run}`;
  await db.plan.create({ data: { id: `plan_${run}`, code: planCode, name: "Plan QA", priceMonthly: 0, maxUsers: 5 } });
  const slug = `la-vajilla-${run}`;
  const ownerEmail = `dueno-${run}@example.com`;
  const input = { name: "La Vajilla Alquileres", slug, planCode, invitees: [{ email: ownerEmail, role: "OWNER" as const }] };
  let organizationId = "";
  let invitationId = "";

  await t.test("crea la empresa con plan y plantillas, la invitación OWNER y la auditoría «Plataforma», sin cuenta ni contraseña", async () => {
    const result = await createOrganizationWithOwnerInvite(input, actor);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    organizationId = result.organizationId;
    invitationId = result.invitations[0].id;
    const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    assert.equal(org.slug, slug);
    assert.equal(org.active, true);
    assert.equal(org.planId, `plan_${run}`);
    assert.ok(org.planStartedAt);
    assert.ok((await db.messageTemplate.count({ where: { organizationId } })) > 0, "plantillas de arranque");
    const invitation = await db.teamInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    assert.equal(invitation.role, "OWNER");
    assert.equal(invitation.status, "pending");
    assert.equal(invitation.email, ownerEmail);
    assert.match(invitation.tokenHash, /^[0-9a-f]{64}$/, "solo el hash queda en la base");
    const days = (invitation.expiresAt.getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7.01, "vence en 7 días");
    assert.equal(await db.adminUser.count({ where: { email: ownerEmail } }), 0, "no se crea cuenta");
    assert.equal(await db.adminMembership.count({ where: { organizationId } }), 0, "no se crea membresía");
    const audits = await db.auditLog.findMany({ where: { organizationId } });
    assert.ok(audits.length >= 3);
    assert.equal(result.invitations.length, 1);
    assert.ok(audits.every((row) => row.actorName === "Plataforma"));
    assert.ok(audits.some((row) => row.entity === "Organization" && row.action === "create"));
    assert.ok(["sent", "failed", "skipped"].includes(result.invitations[0].mail.status));
  });

  await t.test("slug repetido da 409 y no deja nada a medias", async () => {
    const before = await db.teamInvitation.count();
    const orgs = await db.organization.count();
    const again = await createOrganizationWithOwnerInvite({ ...input, name: "Otra", invitees: [{ email: `otro-${run}@example.com`, role: "OWNER" }] }, actor);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.status, 409);
    assert.ok(again.fieldErrors.slug);
    assert.equal(await db.teamInvitation.count(), before);
    assert.equal(await db.organization.count(), orgs);
  });

  await t.test("datos inválidos o plan inexistente dan 400; la demo no se puede crear", async () => {
    const badPlan = await createOrganizationWithOwnerInvite({ ...input, slug: `x-${run}`, planCode: "no-existe" }, actor);
    assert.deepEqual([badPlan.ok, !badPlan.ok && badPlan.status], [false, 400]);
    const demo = await createOrganizationWithOwnerInvite({ ...input, slug: "demo" }, actor);
    assert.deepEqual([demo.ok, !demo.ok && demo.status], [false, 400]);
  });

  await t.test("el correo del dueño de la plataforma sí se puede invitar como dueño de otra empresa", async () => {
    const result = await createOrganizationWithOwnerInvite({ ...input, name: "Empresa del dueño", slug: `del-dueno-${run}`, invitees: [{ email: PLATFORM_OWNER_EMAIL, role: "OWNER" }] }, actor);
    assert.equal(result.ok, true);
  });

  await t.test("reenviar: token nuevo, sentCount sube; otra empresa da 404; aceptada da 409", async () => {
    const before = await db.teamInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    const ok = await resendInvitation({ organizationId, invitationId }, actor);
    assert.equal(ok.ok, true);
    const after = await db.teamInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    assert.notEqual(after.tokenHash, before.tokenHash, "el link viejo deja de servir");
    assert.equal(after.sentCount, before.sentCount + 1);
    const foreign = await db.organization.create({ data: { id: `f_${run}`, name: "Ajena", slug: `ajena-${run}` } });
    const wrong = await resendInvitation({ organizationId: foreign.id, invitationId }, actor);
    assert.deepEqual([wrong.ok, !wrong.ok && wrong.status], [false, 404]);
    await db.teamInvitation.update({ where: { id: invitationId }, data: { status: "accepted" } });
    const accepted = await resendInvitation({ organizationId, invitationId }, actor);
    assert.deepEqual([accepted.ok, !accepted.ok && accepted.status], [false, 409]);
    await db.teamInvitation.update({ where: { id: invitationId }, data: { status: "pending" } });
  });

  await t.test("si el correo ya tiene cuenta, aceptar suma la membresía OWNER sin tocar la cuenta", async () => {
    const email = `existente-${run}@example.com`;
    const user = await db.adminUser.create({ data: { id: `u_${run}`, name: "Ya Existe", email, passwordHash: await hashPassword("clave-larga-123"), role: "VIEWER", active: true } });
    const created = await createOrganizationWithOwnerInvite({ ...input, name: "Segunda", slug: `segunda-${run}`, invitees: [{ email, role: "OWNER" }] }, actor);
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const { token } = await upsertInvitation({ organizationId: created.organizationId, email, role: "OWNER", inviter: { id: actor.userId, name: "Plataforma", email: actor.email } });
    const accepted = await acceptInvitationWithPassword({ token, password: "clave-larga-123" });
    assert.equal(accepted.ok, true);
    const membership = await db.adminMembership.findUniqueOrThrow({ where: { adminUserId_organizationId: { adminUserId: user.id, organizationId: created.organizationId } } });
    assert.equal(membership.role, "OWNER");
    assert.equal((await db.adminUser.findUniqueOrThrow({ where: { id: user.id } })).email, email, "el correo de la cuenta no cambia");
  });

  await t.test("sin requirePlatformAdmin (sin sesión) las acciones redirigen a / y no escriben", async () => {
    const { crearEmpresaAction, reenviarInvitacionAction } = await import("../app/(superadmin)/superadmin/empresas/acciones");
    const orgs = await db.organization.count();
    const form = new FormData();
    form.set("name", input.name);
    form.set("slug", `sin-sesion-${run}`);
    form.set("planCode", planCode);
    form.append("inviteeEmail", ownerEmail);
    form.append("inviteeRole", "OWNER");
    const redirected = (error: unknown) => error instanceof Error && String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT");
    await assert.rejects(() => crearEmpresaAction({ error: null, fieldErrors: {}, values: input }, form), redirected);
    const resend = new FormData();
    resend.set("organizationId", organizationId);
    resend.set("invitationId", invitationId);
    await assert.rejects(() => reenviarInvitacionAction(resend), redirected);
    assert.equal(await db.organization.count(), orgs);
  });

  await t.test("alta con dos administradores: dos invitaciones ADMIN, sin dueño, sin cuentas", async () => {
    const result = await createOrganizationWithOwnerInvite({
      name: "Dos Admins", slug: `dos-admins-${run}`, planCode,
      invitees: [{ email: `a1-${run}@example.com`, role: "ADMIN" }, { email: `a2-${run}@example.com`, role: "ADMIN" }],
    }, actor);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const rows = await db.teamInvitation.findMany({ where: { organizationId: result.organizationId } });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.role === "ADMIN" && row.status === "pending"));
    assert.equal(await db.adminUser.count({ where: { email: { in: rows.map((row) => row.email) } } }), 0);
    const empty = await createOrganizationWithOwnerInvite({ name: "Sin gente", slug: `sin-gente-${run}`, planCode, invitees: [] }, actor);
    assert.deepEqual([empty.ok, !empty.ok && empty.status], [false, 400]);
  });

  await t.test("empresa predeterminada: se respeta al entrar, cae en otra válida y rechaza ajenas y demo", async () => {
    const { setDefaultOrganization, resolveActiveOrganizationId, listSelectableOrganizations } = await import("../lib/server/tenancy");
    const userId = `mu_${run}`;
    await db.adminUser.create({ data: { id: userId, name: "Multi", email: `multi-${run}@example.com`, passwordHash: await hashPassword("clave-larga-123"), role: "ADMIN", active: true } });
    const mk = async (id: string, slug: string, extra: object = {}) => db.organization.create({ data: { id, name: slug, slug, ...extra } });
    const a = await mk(`ma_${run}`, `ma-${run}`);
    const b = await mk(`mb_${run}`, `mb-${run}`);
    const foreign = await mk(`mf_${run}`, `mf-${run}`);
    const inactive = await mk(`mi_${run}`, `mi-${run}`, { active: false });
    const existingDemo = await db.organization.findUnique({ where: { slug: "demo" } });
    const demo = existingDemo ?? (await mk("org_demo", "demo"));
    const memberships = [a, b, inactive, demo];
    for (const [index, org] of memberships.entries()) {
      await db.adminMembership.create({ data: { id: `mm_${run}_${index}`, adminUserId: userId, organizationId: org.id, role: "ADMIN", active: true, createdAt: new Date(Date.UTC(2040, 0, index + 1)) } });
    }
    assert.equal(await resolveActiveOrganizationId(userId), a.id, "sin predeterminada: la primera");
    assert.equal(await setDefaultOrganization(userId, b.id), true);
    assert.equal(await resolveActiveOrganizationId(userId), b.id, "se respeta la predeterminada al entrar");
    assert.equal(await setDefaultOrganization(userId, foreign.id), false, "empresa ajena: 403");
    assert.equal(await setDefaultOrganization(userId, demo.id), false, "la demo no se elige");
    assert.equal(await setDefaultOrganization(userId, inactive.id), false, "una empresa inactiva no se elige");
    assert.equal((await db.adminUser.findUniqueOrThrow({ where: { id: userId } })).defaultOrganizationId, b.id, "los rechazos no cambian nada");
    assert.deepEqual((await listSelectableOrganizations(userId)).map((org) => org.id).sort(), [a.id, b.id].sort());
    await db.adminMembership.updateMany({ where: { adminUserId: userId, organizationId: b.id }, data: { active: false } });
    assert.equal(await resolveActiveOrganizationId(userId), a.id, "con la membresía revocada cae en otra válida");
    assert.equal(await setDefaultOrganization(userId, null), true);
    // No dejar una «demo» vacía: rompería la carga de la demo completa en las demás pruebas.
    if (!existingDemo) await db.organization.delete({ where: { id: demo.id } });
  });

  await db.$disconnect();
});
