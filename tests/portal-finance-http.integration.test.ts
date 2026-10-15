import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.PORTAL_AUDIT_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && process.env.TEST_DATABASE_URL);

test("portal y finanzas HTTP: aislamiento, firma inmutable y edición concurrente", { skip: !enabled, timeout: 180000 }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { generatePublicToken } = await import("../lib/server/budget-portal");
  const org = randomUUID(), other = randomUUID(), users: string[] = [];
  await db.organization.createMany({ data: [org, other].map(id => ({ id, slug: `portal131-${id}`, name: "Emisor ficticio original" })) });
  async function cookie(role: "OWNER" | "FINANCE" | "OPERATIONS" | "VIEWER", organizationId = org) {
    const user = await db.adminUser.create({ data: { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Auditor ficticio", role, passwordHash: "not-a-login", autoLockEnabled: false } });
    users.push(user.id);
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId, role } });
    return `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
  }
  const owner = await cookie("OWNER"), foreign = await cookie("OWNER", other);
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente original", notes: "PRIVATE_CLIENT_NOTES" } });
  const second = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Otro cliente" } });
  const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja ficticia" } });
  const account2 = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Banco ficticio" } });
  const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Proveedor ficticio" } });
  async function quote() {
    return db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Presupuesto ficticio", publicToken: generatePublicToken(), status: "SENT", subtotal: 1000, total: 1000, costEstimate: 500, items: { create: { id: randomUUID(), name: "Producto original", quantity: 1, days: 1, unitPrice: 1000, costPrice: 500, subtotal: 1000 } } } });
  }
  async function call(path: string, method = "GET", body?: unknown, auth?: string) {
    return fetch(base + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", "X-Forwarded-For": `portal131-${org}`, ...(auth ? { Cookie: auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  try {
    await t.test("no permite cobrar el presupuesto de otro cliente del mismo tenant", async () => {
      const b = await quote();
      for (const status of ["RECEIVED", "PENDING"]) {
        const response = await call("/api/admin/finance", "POST", { kind: "client", clientId: second.id, budgetId: b.id, amount: 100, method: "Efectivo", status, dueDays: 0 }, owner);
        assert.equal(response.status, 409, await response.clone().text());
      }
      assert.equal(await db.clientPayment.count({ where: { budgetId: b.id } }), 0);
      const valid = await call("/api/admin/finance", "POST", { kind: "client", clientId: client.id, budgetId: b.id, amount: 100, method: "Efectivo" }, owner);
      assert.equal(valid.status, 201, await valid.clone().text());
    });
    await t.test("roles de solo lectura y operación no registran cobros; otro tenant no accede", async () => {
      const b = await quote();
      for (const role of ["VIEWER", "OPERATIONS"] as const) {
        const response = await call("/api/admin/finance", "POST", { kind: "client", clientId: client.id, amount: 100, method: "Efectivo" }, await cookie(role));
        assert.equal(response.status, 403);
      }
      assert.equal((await call("/api/admin/finance", "POST", { kind: "client", clientId: client.id, budgetId: b.id, amount: 100 }, foreign)).status, 404);
      assert.equal((await call("/api/admin/finance", "POST", { kind: "client", clientId: client.id, amount: 100 })).status, 401);
    });
    await t.test("al cobrar un pendiente guarda la cuenta por defecto que recibe el dinero", async () => {
      const created = await call("/api/admin/finance", "POST", { kind: "client", clientId: client.id, amount: 100, status: "PENDING", method: "Pendiente", dueDays: 0 }, owner);
      assert.equal(created.status, 201);
      const payment = (await created.json()).payment;
      assert.equal(payment.treasuryAccountId, null);
      const collected = await call("/api/admin/finance", "PATCH", { kind: "client", paymentId: payment.id, action: "collect", method: "Efectivo" }, owner);
      assert.equal(collected.status, 200);
      const saved = (await collected.json()).payment;
      const movement = await db.treasuryMovement.findFirstOrThrow({ where: { organizationId: org, sourceId: payment.id, origin: "client_payment" } });
      assert.equal(saved.treasuryAccountId, movement.accountId);
      assert.equal(saved.treasuryAccount.id, movement.accountId);
    });
    await t.test("dos ediciones parciales concurrentes conservan cuenta, proveedor y movimiento", async () => {
      const created = await call("/api/admin/expenses", "POST", { description: "Transporte ficticio", amount: 100, category: "OTHER", accountId: account.id }, owner);
      assert.equal(created.status, 201, await created.clone().text());
      const expense = (await created.json()).expense;
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { locked = r; });
      const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expense.id} FOR UPDATE`; locked(); await gate; }, { timeout: 20000 });
      await ready;
      const waiters = async (count: number) => {
        const deadline = Date.now() + 12000;
        while (true) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Expense%'`;
          if (Number(rows[0].count) >= count) return;
          assert.ok(Date.now() < deadline, "requests alcanzan el bloqueo real de gasto");
          await new Promise(r => setTimeout(r, 10));
        }
      };
      const first = call("/api/admin/expenses", "PATCH", { expenseId: expense.id, accountId: account2.id }, owner);
      let secondRequest: Promise<Response> | undefined;
      try { await waiters(1); secondRequest = call("/api/admin/expenses", "PATCH", { expenseId: expense.id, supplierId: supplier.id }, owner); await waiters(2); }
      finally { release(); }
      await blocker;
      assert.equal((await first).status, 200); assert.equal((await secondRequest!).status, 200);
      const saved = await db.expense.findUniqueOrThrow({ where: { id: expense.id } });
      assert.equal(saved.accountId, account2.id); assert.equal(saved.supplierId, supplier.id);
      const movement = await db.treasuryMovement.findFirstOrThrow({ where: { organizationId: org, origin: "expense", sourceId: expense.id } });
      assert.equal(movement.accountId, saved.accountId); assert.equal(movement.amount, saved.amount);
    });
    await t.test("portal omite datos privados y no permite acceder por ID o token inválido", async () => {
      const b = await quote();
      const response = await call(`/api/portal/budget/${b.publicToken}`);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.doesNotMatch(text, /PRIVATE_|costPrice|costEstimate|internalNotes|approvalIp|passwordHash/);
      assert.equal((await call(`/api/portal/budget/${b.id}`)).status, 404);
      assert.equal((await call(`/api/portal/budget/${randomUUID()}`)).status, 404);
    });
    await t.test("papelera revoca el portal y recursos del cliente eliminado", async () => {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
      const b = await quote();
      const file = await db.budgetAttachment.create({ data: { id: randomUUID(), organizationId: org, budgetId: b.id, uploadedByName: "Auditor", name: "Documento ficticio.pdf", mime: "application/pdf", size: bytes.length, data: new Uint8Array(bytes), clientVisible: true } });
      const path = `/api/portal/budget/${b.publicToken}/attachments/${file.id}`;
      assert.equal((await call(path)).status, 200);
      await db.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
      try {
        assert.equal((await call(`/api/portal/budget/${b.publicToken}`)).status, 404);
        assert.equal((await call(path)).status, 404, "el PDF queda protegido igual que su portal");
        assert.equal((await call(`/api/portal/budget/${b.publicToken}/revision`, "POST", { name: "Cliente ficticio", note: "Revisión ficticia" })).status, 404);
      } finally { await db.client.update({ where: { id: client.id }, data: { deletedAt: null } }); }
      await db.budget.update({ where: { id: b.id }, data: { status: "DRAFT", deletedAt: new Date() } });
      assert.equal((await call(`/api/portal/budget/${b.publicToken}`)).status, 404, "un borrador eliminado no es público");
      assert.equal((await call(path)).status, 404);
    });
    await t.test("firma rechaza aceptar condiciones comerciales modificadas desde su envío", async () => {
      const b = await quote();
      const issue = await call("/api/admin/signatures", "POST", { budgetId: b.id, recipientName: "Firmante ficticio", method: "TYPED", otpRequired: false }, owner);
      assert.equal(issue.status, 201);
      const request = (await issue.json()).request;
      await db.budgetItem.updateMany({ where: { budgetId: b.id }, data: { name: "Condición modificada" } });
      const sign = await call(`/api/portal/firma/${request.code}/sign`, "POST", { consent: true, signature: { name: "Firmante ficticio" } });
      assert.equal(sign.status, 409);
      assert.notEqual((await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "SIGNED");
    });
    await t.test("firma conserva snapshot público después de ediciones posteriores", async () => {
      const b = await quote();
      const issue = await call("/api/admin/signatures", "POST", { budgetId: b.id, recipientName: "Firmante ficticio", method: "TYPED", otpRequired: false }, owner);
      assert.equal(issue.status, 201, await issue.clone().text());
      const request = (await issue.json()).request;
      assert.equal((await call(`/api/portal/firma/${request.code}/sign`, "POST", { consent: true, signature: { name: "Firmante ficticio" } })).status, 200);
      const before = (await (await call(`/api/portal/firma/${request.code}`)).json()).signature;
      assert.doesNotMatch(JSON.stringify(before.budget), /PRIVATE_|costPrice|costEstimate|internalNotes/);
      await db.client.update({ where: { id: client.id }, data: { name: "Cliente modificado" } });
      await db.organization.update({ where: { id: org }, data: { name: "Emisor modificado" } });
      await db.budgetItem.updateMany({ where: { budgetId: b.id }, data: { name: "Producto modificado", unitPrice: 2000, subtotal: 2000 } });
      const after = (await (await call(`/api/portal/firma/${request.code}`)).json()).signature;
      assert.deepEqual(after.budget, before.budget);
      assert.equal(after.organizationName, before.organizationName);
      assert.equal((await call(`/api/portal/firma/${randomUUID()}`)).status, 404);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.adminUser.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
