import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: Postgres descartable con migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/invitaciones-reglas.pg.test.ts
test("invitaciones y gratis a propósito contra Postgres real", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const inv = await import("../lib/server/invitations");
  const { saveBudgetEditor } = await import("../lib/server/budget-editor");

  const sfx = randomUUID().slice(0, 8);
  const org = async (n: string) => { const id = randomUUID(); await db.organization.create({ data: { id, slug: `inv-${n}-${sfx}`, name: `Inv ${n}` } }); return id; };
  const orgA = await org("a"), orgB = await org("b");
  const person = async (n: string) => db.adminUser.create({ data: { id: randomUUID(), name: n, email: `${n}-${sfx}@example.test`, passwordHash: "x", role: "OWNER" } });
  const inviter = await person("dueno"), other = await person("otro");
  const invite = (organizationId: string, email: string, role: "OWNER" | "ADMIN", by: { id: string; name: string; email: string }) =>
    inv.upsertInvitation({ organizationId, email, role, inviter: by });
  const by = (u: { id: string; name: string; email: string }) => ({ id: u.id, name: u.name, email: u.email });

  await t.test("una sola vez: aceptada, el link queda inválido; vencida, tampoco sirve", async () => {
    const { token } = await invite(orgA, `uno-${sfx}@example.test`, "ADMIN", by(inviter));
    const first = await inv.acceptInvitationWithPassword({ token, name: "Persona Uno", password: "clave-larga-1" });
    assert.equal(first.ok, true);
    const again = await inv.acceptInvitationWithPassword({ token, name: "Persona Uno", password: "clave-larga-1" });
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.status, 410);
    const late = await invite(orgA, `tarde-${sfx}@example.test`, "ADMIN", by(inviter));
    const expired = await inv.acceptInvitationWithPassword({ token: late.token, name: "Persona Tarde", password: "clave-larga-1", now: new Date(Date.now() + 8 * 86_400_000) });
    assert.equal(!expired.ok && expired.status, 410);
    const reopened = await inv.findInvitationByToken((await invite(orgA, `abre-${sfx}@example.test`, "ADMIN", by(inviter))).token);
    assert.equal(reopened?.status, "pending", "sin usar y sin vencer, se puede volver a abrir");
  });

  await t.test("revocación automática de invitaciones OWNER pendientes de quien deja de ser OWNER", async () => {
    const mine = await invite(orgA, `o1-${sfx}@example.test`, "OWNER", by(inviter));
    const adminInv = await invite(orgA, `a1-${sfx}@example.test`, "ADMIN", by(inviter));
    const others = await invite(orgA, `o2-${sfx}@example.test`, "OWNER", by(other));
    const foreignOrg = await invite(orgB, `o3-${sfx}@example.test`, "OWNER", by(inviter));
    const count = await db.$transaction((tx) => inv.revokePendingOwnerInvitations(tx, { organizationId: orgA, inviterId: inviter.id, revokedByName: "Dueño" }));
    assert.equal(count, 1);
    const status = async (id: string) => (await db.teamInvitation.findUniqueOrThrow({ where: { id } })).status;
    assert.equal(await status(mine.invitation.id), "revoked");
    assert.equal(await status(adminInv.invitation.id), "pending");
    assert.equal(await status(others.invitation.id), "pending");
    assert.equal(await status(foreignOrg.invitation.id), "pending", "otra empresa intacta");
    const dead = await inv.acceptInvitationWithPassword({ token: mine.token, name: "Persona Muerta", password: "clave-larga-1" });
    assert.equal(!dead.ok && dead.status, 410);
  });

  await t.test("un ADMIN no pisa una invitación OWNER pendiente; un OWNER sí", async () => {
    const email = `pisa-${sfx}@example.test`;
    await invite(orgA, email, "OWNER", by(inviter));
    assert.equal(await inv.ownerInvitationBlocksActor({ organizationId: orgA, email, actorRole: "ADMIN" }), true);
    assert.equal(await inv.ownerInvitationBlocksActor({ organizationId: orgA, email: email.toUpperCase(), actorRole: "ADMIN" }), true);
    assert.equal(await inv.ownerInvitationBlocksActor({ organizationId: orgA, email, actorRole: "OWNER" }), false);
    assert.equal(await inv.ownerInvitationBlocksActor({ organizationId: orgB, email, actorRole: "ADMIN" }), false, "otra empresa");
    assert.equal(await inv.ownerInvitationBlocksActor({ organizationId: orgA, email, actorRole: "ADMIN", now: new Date(Date.now() + 8 * 86_400_000) }), false, "vencida ya no está pendiente");
    assert.equal(await inv.ownerInvitationBlocksActor({ organizationId: orgA, email: `libre-${sfx}@example.test`, actorRole: "ADMIN" }), false);
  });

  await t.test("gratis a propósito: ADMIN sí, FINANCE recibe 403 y nada cambia", async () => {
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: orgA, name: "Cliente" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: orgA, clientId: client.id, title: "P", subtotal: 0, total: 0, items: { create: { id: randomUUID(), name: "Cortesía", quantity: 1, days: 1, unitPrice: 0, subtotal: 0, freeOnPurpose: false } } }, include: { items: true } });
    const item = budget.items[0];
    const ctx = (role: "ADMIN" | "FINANCE") => ({ organizationId: orgA, role, user: { id: inviter.id, name: inviter.name, email: inviter.email, role } }) as never;
    const body = (free: boolean) => ({ items: [{ id: item.id, name: "Cortesía", quantity: 1, days: 1, unitPrice: 0, costPrice: 0, freeOnPurpose: free }] });
    const denied = await saveBudgetEditor(ctx("FINANCE"), budget.id, body(true));
    assert.equal(denied.status, 403);
    assert.equal((await db.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).freeOnPurpose, false);
    const ok = await saveBudgetEditor(ctx("ADMIN"), budget.id, body(true));
    assert.equal(ok.status, 200);
    assert.equal((await db.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).freeOnPurpose, true);
    assert.equal((await saveBudgetEditor(ctx("FINANCE"), budget.id, body(false))).status, 403, "desmarcar tampoco");
    assert.equal((await db.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).freeOnPurpose, true);
  });

  t.after(async () => { await db.$disconnect(); });
});
