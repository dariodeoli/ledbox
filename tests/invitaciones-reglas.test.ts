import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canSetFreeOnPurpose, freeOnPurposeChanged } from "../lib/budget-items";
import { categoryImageServable } from "../lib/category-image-access";
import { INVITATION_TTL_DAYS, invitationValidityLabel } from "../lib/public-config";
import { inviterLosesOwnerAuthority, revokePendingOwnerInvitations } from "../lib/server/invitations";
import { buildInvitationMail } from "../lib/server/mail/invitation";

test("invitaciones: siempre vencen y muestran «Válido por X días» (7 por defecto)", () => {
  assert.equal(INVITATION_TTL_DAYS, 7);
  assert.equal(invitationValidityLabel(), "Válido por 7 días");
  assert.equal(invitationValidityLabel(1), "Válido por 1 día");
  const now = new Date("2026-01-10T12:00:00Z");
  const mail = buildInvitationMail({
    organizationName: "La Vajilla", email: "a@example.test", role: "ADMIN", invitedByName: "Dueña", token: "TOKEN",
    expiresAt: new Date(now.getTime() + 7 * 86_400_000), now,
  });
  assert.match(mail.text, /Válido por 7 días/);
  assert.match(mail.html, /Válido por 7 días/);
});

test("invitaciones OWNER: pierde la autoridad quien deja de ser OWNER o queda desactivado", () => {
  assert.equal(inviterLosesOwnerAuthority({ role: "OWNER", active: true }), false);
  assert.equal(inviterLosesOwnerAuthority({ role: "OWNER", active: false }), true);
  for (const role of ["ADMIN", "FINANCE", "OPERATIONS", "VIEWER"] as const) {
    assert.equal(inviterLosesOwnerAuthority({ role, active: true }), true);
  }
});

test("revocación: el filtro es empresa + quien invitó + rol OWNER + pendiente", async () => {
  let args: { where: unknown; data: Record<string, unknown> } | null = null;
  const tx = { teamInvitation: { updateMany: async (input: typeof args) => { args = input; return { count: 2 }; } } };
  const count = await revokePendingOwnerInvitations(tx as never, { organizationId: "org-1", inviterId: "u-1", revokedByName: "Dueño" });
  assert.equal(count, 2);
  assert.deepEqual(args!.where, { organizationId: "org-1", invitedById: "u-1", role: "OWNER", status: "pending" });
  assert.equal(args!.data.status, "revoked");
  assert.equal(args!.data.revokedByName, "Dueño");
});

test("el PATCH de usuarios revoca dentro de la misma transacción", () => {
  const source = readFileSync("app/api/admin/users/route.ts", "utf8");
  const tx = source.indexOf("db.$transaction");
  const revoke = source.indexOf("revokePendingOwnerInvitations(tx");
  const end = source.indexOf("return next;", tx);
  assert.ok(tx > 0 && revoke > tx && revoke < end, "revokePendingOwnerInvitations(tx) va dentro de la transacción");
});

test("gratis a propósito: solo OWNER y ADMIN; repetir el valor guardado no cuenta como cambio", () => {
  assert.deepEqual(["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"].map(canSetFreeOnPurpose), [true, true, false, false, false]);
  const saved = new Map([["a", true], ["b", false]]);
  assert.equal(freeOnPurposeChanged([{ id: "a", freeOnPurpose: true }, { id: "b" }], saved), false);
  assert.equal(freeOnPurposeChanged([{ id: "a", freeOnPurpose: false }], saved), true, "desmarcar");
  assert.equal(freeOnPurposeChanged([{ id: "b", freeOnPurpose: true }], saved), true, "marcar");
  assert.equal(freeOnPurposeChanged([{ name: "nuevo", freeOnPurpose: true }], saved), true, "ítem nuevo marcado");
  assert.equal(freeOnPurposeChanged([{ name: "nuevo" }], saved), false);
});

test("imagen de categoría: empresa inactiva solo para la sesión del panel de esa empresa", () => {
  const base = { archived: false, organizationId: "o1" };
  assert.equal(categoryImageServable({ ...base, organizationActive: true }), true);
  assert.equal(categoryImageServable({ ...base, organizationActive: false }), false);
  assert.equal(categoryImageServable({ ...base, organizationActive: false, sessionOrganizationId: "o2" }), false);
  assert.equal(categoryImageServable({ ...base, organizationActive: false, sessionOrganizationId: "o1" }), true);
  assert.equal(categoryImageServable({ ...base, organizationActive: true, archived: true }), false);
});
