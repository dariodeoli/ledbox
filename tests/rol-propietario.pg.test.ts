import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/rol-propietario.pg.test.ts
// Cubre el guard real con locks y la aceptación de invitaciones; el 403 de las
// rutas HTTP depende de la sesión de Next y se cubre con el guard + canAssignTeamRole.
test("rol Propietario: asignación, último OWNER e invitación en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { guardUserOwnerChange, UserOwnerGuardError } = await import("../lib/server/user-owner-guard");
  const { upsertInvitation, acceptInvitationWithPassword } = await import("../lib/server/invitations");

  const org = randomUUID();
  await db.organization.create({ data: { id: org, name: "Rol Propietario", slug: `rp-${org.slice(0, 8)}` } });
  async function person(role: "OWNER" | "ADMIN") {
    const id = randomUUID();
    await db.adminUser.create({ data: { id, name: `P ${id.slice(0, 4)}`, email: `${id}@x.test`, passwordHash: "x", role, active: true } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: id, organizationId: org, role, active: true } });
    return id;
  }
  const change = (adminUserId: string, actorId: string, actorRole: "OWNER" | "ADMIN", patch: { role?: "OWNER" | "ADMIN" | "VIEWER"; active?: boolean }) =>
    db.$transaction(async (tx) => {
      const current = await guardUserOwnerChange(tx, { organizationId: org, adminUserId, actorId, actorRole, patch });
      await tx.adminMembership.update({ where: { id: current.id }, data: patch });
    });
  const roleOf = async (id: string) => (await db.adminMembership.findFirstOrThrow({ where: { adminUserId: id, organizationId: org } })).role;

  try {
    // ADMIN no asigna OWNER (403); OWNER sí.
    const owner1 = await person("OWNER");
    const owner2 = await person("OWNER");
    const admin = await person("ADMIN");
    await assert.rejects(change(admin, owner1, "ADMIN", { role: "OWNER" }), (e: unknown) => e instanceof UserOwnerGuardError && e.status === 403);
    assert.equal(await roleOf(admin), "ADMIN");
    await change(admin, owner1, "OWNER", { role: "OWNER" });
    assert.equal(await roleOf(admin), "OWNER");
    await change(admin, owner1, "OWNER", { role: "ADMIN" });

    // Dos OWNER se bajan a la vez: queda uno (lock de la empresa).
    await db.adminMembership.updateMany({ where: { organizationId: org, adminUserId: admin }, data: { active: false } });
    const results = await Promise.allSettled([
      change(owner2, owner1, "OWNER", { role: "VIEWER" }),
      change(owner1, owner2, "OWNER", { role: "VIEWER" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failed = results.find((r) => r.status === "rejected");
    assert.ok(failed?.status === "rejected" && failed.reason instanceof UserOwnerGuardError && failed.reason.status === 409);
    const owners = await db.adminMembership.count({ where: { organizationId: org, role: "OWNER", active: true } });
    assert.equal(owners, 1);

    // Invitación como OWNER aceptada: la membresía queda OWNER.
    const email = `inv-${randomUUID().slice(0, 8)}@x.test`;
    const inviterId = (await db.adminMembership.findFirstOrThrow({ where: { organizationId: org, role: "OWNER" } })).adminUserId;
    const { token, invitation } = await upsertInvitation({ organizationId: org, email, role: "OWNER", inviter: { id: inviterId, name: "Dueña", email: "d@x.test" } });
    assert.equal(invitation.role, "OWNER");
    const accepted = await acceptInvitationWithPassword({ token, name: "Nuevo Propietario", password: "clave-larga-123" });
    assert.ok(accepted.ok, JSON.stringify(accepted));
    const user = await db.adminUser.findUniqueOrThrow({ where: { email } });
    assert.equal(await roleOf(user.id), "OWNER");
  } finally {
    await db.teamInvitation.deleteMany({ where: { organizationId: org } });
    await db.adminMembership.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } }).catch(() => {});
  }
});
