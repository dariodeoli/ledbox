import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminRole, Prisma } from "@prisma/client";
import { guardUserOwnerChange, UserOwnerGuardError } from "../lib/server/user-owner-guard";

type Member = { id: string; adminUserId: string; organizationId: string; role: AdminRole; active: boolean; user: { active: boolean; _count: { memberships: number } } };
const member = (id: string, patch: Partial<Member> = {}): Member => ({
  id: `membership-${id}`, adminUserId: id, organizationId: "tenant", role: "OWNER", active: true,
  user: { active: true, _count: { memberships: 1 } }, ...patch,
});
const input = (adminUserId: string, patch: { active?: boolean; role?: AdminRole }) => ({
  organizationId: "tenant", adminUserId, actorId: "actor", actorRole: "OWNER" as const, patch,
});

/** Transaction double models lock wait -> current read -> write -> commit.
 * This verifies serialized decision/consumer ordering, not native PG locking.
 */
function database(rows: Member[]) {
  let tail = Promise.resolve();
  const events: string[] = [];
  const countQueries: unknown[] = [];
  let writes = 0;
  async function change(request: Parameters<typeof guardUserOwnerChange>[1]) {
    let release: (() => void) | undefined;
    let locked = false;
    const tx = {
      $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
        assert.match(sql.join("?"), /SELECT "id" FROM "Organization" WHERE "id" = \? FOR UPDATE/);
        assert.deepEqual(values, [request.organizationId]);
        const prior = tail;
        tail = new Promise<void>(resolve => { release = resolve; });
        await prior;
        locked = true;
        events.push(`${request.adminUserId}:lock`);
        return [{ id: request.organizationId }];
      },
      adminMembership: {
        findFirst: async ({ where }: { where: { adminUserId: string; organizationId: string } }) => {
          assert.ok(locked, "preflight cannot replace a read under the tenant lock");
          events.push(`${request.adminUserId}:read`);
          const row = rows.find(row => row.adminUserId === where.adminUserId && row.organizationId === where.organizationId);
          return row ? structuredClone(row) : null;
        },
        count: async ({ where }: { where: { organizationId: string; role: string; active: boolean; user: { active: boolean } } }) => {
          assert.ok(locked);
          countQueries.push(where);
          return rows.filter(row => row.organizationId === where.organizationId && row.role === where.role
            && row.active === where.active && row.user.active === where.user.active).length;
        },
      },
    } as unknown as Pick<Prisma.TransactionClient, "$queryRaw" | "adminMembership">;
    try {
      const current = await guardUserOwnerChange(tx, request);
      const row = rows.find(row => row.id === current.id)!;
      Object.assign(row, request.patch);
      writes++;
      events.push(`${request.adminUserId}:write`);
      return current;
    } finally {
      if (locked) events.push(`${request.adminUserId}:release`);
      release?.();
    }
  }
  return { change, events, countQueries, get writes() { return writes; } };
}
const denied = (status: number) => (error: unknown) => error instanceof UserOwnerGuardError && error.status === status;

test("last effective owner cannot be demoted or deactivated; denial writes nothing", async () => {
  for (const patch of [{ role: "ADMIN" as const }, { active: false }]) {
    const db = database([member("last")]);
    await assert.rejects(db.change(input("last", patch)), denied(409));
    assert.equal(db.writes, 0);
    assert.deepEqual(db.countQueries, [{ organizationId: "tenant", role: "OWNER", active: true, user: { active: true } }]);
  }
});

test("inactive memberships/accounts, other tenants and global roles never count as effective owners", async () => {
  const db = database([
    member("last"), member("inactive-membership", { active: false }),
    member("inactive-account", { user: { active: false, _count: { memberships: 1 } } }),
    member("foreign", { organizationId: "other" }), member("admin", { role: "ADMIN" }),
  ]);
  await assert.rejects(db.change(input("last", { active: false })), denied(409));
  assert.equal(db.writes, 0);
});

test("two concurrent removals on different members serialize: only one can commit", async () => {
  const rows = [member("one"), member("two")];
  const db = database(rows);
  const results = await Promise.allSettled([
    db.change(input("one", { role: "ADMIN" })), db.change(input("two", { active: false })),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.ok(failure?.status === "rejected" && denied(409)(failure.reason));
  assert.equal(db.writes, 1);
  assert.equal(rows.filter(row => row.role === "OWNER" && row.active && row.user.active).length, 1);
  assert.ok(db.events.indexOf("one:release") < db.events.indexOf("two:read"));
});

test("fresh stored role is authoritative after lock, not an earlier ADMIN preflight", async () => {
  const db = database([member("promoted")]);
  await assert.rejects(db.change({ ...input("promoted", { active: false }), actorRole: "ADMIN" }), denied(403));
  assert.equal(db.writes, 0);
});

test("self role/deactivation guards remain enforced with current stored membership", async () => {
  for (const patch of [{ role: "ADMIN" as const }, { active: false }]) {
    const db = database([member("actor"), member("other")]);
    await assert.rejects(db.change(input("actor", patch)), denied(400));
    assert.equal(db.writes, 0);
  }
});

test("unrelated tenant membership is not writable even when user ID exists", async () => {
  const db = database([member("foreign", { organizationId: "other" })]);
  await assert.rejects(db.change(input("foreign", { active: false })), denied(404));
  assert.equal(db.writes, 0);
});

test("non-removal and inactive owner edits remain allowed without fabricating an owner", async () => {
  const db = database([member("last"), member("inactive", { active: false })]);
  await db.change(input("last", {}));
  await db.change(input("inactive", { role: "ADMIN" }));
  assert.equal(db.writes, 2);
  assert.equal(db.countQueries.length, 0);
});
