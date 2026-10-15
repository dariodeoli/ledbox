import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { canEditTeamAccount } from "../lib/team-account-policy";

test("el administrador de una empresa no modifica la identidad global de un miembro compartido", () => {
  assert.equal(canEditTeamAccount({ actorId: "admin-a", userId: "member-b", membershipCount: 2 }), false);
  assert.equal(canEditTeamAccount({ actorId: "admin-a", userId: "member-b", membershipCount: 3 }), false);
});

test("el titular mantiene su identidad propia y el administrador edita cuentas de su única empresa", () => {
  assert.equal(canEditTeamAccount({ actorId: "member-b", userId: "member-b", membershipCount: 3 }), true);
  assert.equal(canEditTeamAccount({ actorId: "admin-a", userId: "member-b", membershipCount: 1 }), true);
});

test("el endpoint comprueba membresías frescas antes de cualquier escritura, sin bloquear cambios de acceso", () => {
  const route = readFileSync(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const guard = route.indexOf("const current = await guardUserOwnerChange");
  const accountGuard = route.indexOf("if (Object.keys(accountData).length > 0 && !canEditTeamAccount", guard);
  const write = route.indexOf("await tx.adminMembership.update", guard);
  assert.ok(guard >= 0 && accountGuard > guard && write > accountGuard);
  assert.match(route.slice(accountGuard, write), /current\.user\._count\.memberships/);
  assert.match(route, /sharedAccount: membership\.user\._count\.memberships > 1/);
});
