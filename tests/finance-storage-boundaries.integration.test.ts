import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { FIELD_LIMITS } from "../lib/field-rules";

const base = process.env.SETTINGS_TEST_BASE_URL;
const local = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(process.env.DATABASE_URL ?? ""));

test("Dinero HTTP: límites Int4 coherentes y sin escrituras parciales", { skip: !local }, async (t) => {
  const db = new PrismaClient();
  const org = randomUUID(), userId = randomUUID();
  const max = FIELD_LIMITS.amountStorage;
  let cookie = "";
  const call = (path: string, method: string, body: unknown) => fetch(`${base}/api/admin/${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
  try {
    await db.organization.create({ data: { id: org, name: "Límites monetarios QA", slug: `money-${org}` } });
    const owner = await db.adminUser.create({ data: { id: userId, name: "Owner QA", email: `${userId}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId: org, role: "OWNER" } });
    const { createSession } = await import("../lib/server/auth");
    cookie = `ledbox_session=${(await createSession(owner, org)).jwt}`;
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente QA" } });
    const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Proveedor QA" } });
    const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja QA" } });
    const job = await db.supplierJob.create({ data: { id: randomUUID(), organizationId: org, supplierId: supplier.id, description: "Trabajo QA", total: max } });
    const counts = async () => Promise.all([db.clientPayment.count({ where: { organizationId: org } }), db.treasuryMovement.count({ where: { organizationId: org } }), db.supplierJob.count({ where: { organizationId: org } }), db.treasuryAccount.count({ where: { organizationId: org } })]);
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["finance", "POST", { kind: "client", clientId: client.id, amount: max + 1, method: "Efectivo" }],
      ["finance", "POST", { kind: "client", clientId: client.id, amount: 1, totalAmount: max + 1, method: "Efectivo" }],
      ["treasury", "POST", { kind: "account", name: "Caja inválida", openingBalance: max + 1 }],
      ["treasury", "PATCH", { kind: "account", id: account.id, openingBalance: max + 1 }],
      ["treasury", "POST", { kind: "movement", direction: "IN", accountId: account.id, amount: max + 1 }],
      ["treasury", "POST", { kind: "supplier-payment", jobId: job.id, accountId: account.id, amount: max + 1, method: "Efectivo" }],
      ["suppliers/jobs", "POST", { supplierId: supplier.id, description: "Trabajo inválido", total: max + 1 }],
      ["suppliers/jobs", "PATCH", { id: job.id, total: max + 1 }],
    ];
    for (const [path, method, body] of cases) await t.test(`${method} ${path} rechaza ${Object.keys(body).join("/")}`, async () => {
      const before = await counts();
      const response = await call(path, method, body);
      assert.equal(response.status, 400, await response.clone().text());
      assert.deepEqual(await counts(), before);
      assert.equal((await db.supplierJob.findUniqueOrThrow({ where: { id: job.id } })).advance, 0);
      assert.equal((await db.treasuryAccount.findUniqueOrThrow({ where: { id: account.id } })).openingBalance, 0);
    });
    await t.test("borde Int4 exacto se conserva en cobro y movimiento", async () => {
      const response = await call("finance", "POST", { kind: "client", clientId: client.id, amount: max, method: "Efectivo", treasuryAccountId: account.id });
      assert.equal(response.status, 201, await response.clone().text());
      const payment = (await response.json()).payment;
      assert.equal((await db.clientPayment.findUniqueOrThrow({ where: { id: payment.id } })).amount, max);
      assert.equal((await db.treasuryMovement.findFirstOrThrow({ where: { organizationId: org, sourceId: payment.id } })).amount, max);
    });
    await t.test("el saldo derivado puede superar Int4 sin desbordar cada registro", async () => {
      const added = await call("treasury", "POST", { kind: "movement", direction: "IN", accountId: account.id, amount: max });
      assert.equal(added.status, 201, await added.clone().text());
      const read = await fetch(`${base}/api/admin/treasury`, { headers: { Cookie: cookie } });
      assert.equal(read.status, 200);
      const treasury = await read.json();
      assert.equal(treasury.accounts.find((row: { id: string }) => row.id === account.id).balance, 2 * max);
    });
    await t.test("borde Int4 exacto se conserva como total de trabajo y saldo inicial", async () => {
      const work = await call("suppliers/jobs", "POST", { supplierId: supplier.id, description: "Trabajo máximo válido", total: max });
      assert.equal(work.status, 201, await work.clone().text());
      assert.equal((await work.json()).job.total, max);
      const cash = await call("treasury", "POST", { kind: "account", name: "Caja máxima válida", openingBalance: max });
      assert.equal(cash.status, 201, await cash.clone().text());
      assert.equal((await cash.json()).account.openingBalance, max);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: org } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
