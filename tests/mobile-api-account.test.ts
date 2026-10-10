import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { deleteMobileIdentity, MobileDeletionError } from "../lib/server/mobile/account";

function fixture(successor: boolean, hash = "verified") {
  const mutations: string[] = [];
  const mock = {
    adminUser: { findUnique: async () => ({ id: "user", email: "user@example.invalid", active: true, passwordHash: hash }), delete: async () => { mutations.push("delete-user"); } },
    adminSession: { findFirst: async () => ({ id: "session" }), updateMany: async () => { mutations.push("revoke-sessions"); } },
    adminMembership: { findMany: async () => [{ organizationId: "company-A" }, { organizationId: "company-B" }], findFirst: async ({ where }: { where: { organizationId: string } }) => where.organizationId === "company-A" || successor ? { id: "successor" } : null },
    apiToken: { updateMany: async () => { mutations.push("revoke-keys"); } },
    teamInvitation: { updateMany: async () => { mutations.push("redact-invitation"); } },
  };
  return { tx: mock as unknown as Prisma.TransactionClient, mutations };
}

test("last OWNER in any company blocks deletion before any credential/data mutation", async () => {
  const { tx, mutations } = fixture(false);
  await assert.rejects(deleteMobileIdentity(tx, { userId: "user", sessionId: "session", verifiedPasswordHash: "verified" }), (error: unknown) => error instanceof MobileDeletionError && error.code === "OWNER_TRANSFER_REQUIRED");
  assert.deepEqual(mutations, []);
});

test("password change after reauthentication blocks deletion without mutations", async () => {
  const { tx, mutations } = fixture(true, "changed");
  await assert.rejects(deleteMobileIdentity(tx, { userId: "user", sessionId: "session", verifiedPasswordHash: "verified" }), (error: unknown) => error instanceof MobileDeletionError && error.code === "reauthentication_required");
  assert.deepEqual(mutations, []);
});

test("deletion removes identity after revocation, without touching tenant or signed/financial stores", async () => {
  const { tx, mutations } = fixture(true);
  await deleteMobileIdentity(tx, { userId: "user", sessionId: "session", verifiedPasswordHash: "verified" });
  assert.equal(mutations[0], "revoke-sessions");
  assert.ok(mutations.includes("revoke-keys"));
  assert.equal(mutations.at(-1), "delete-user");
  // Mock has no organization/budget/payment/signature delegates: accidental wipe fails.
});
