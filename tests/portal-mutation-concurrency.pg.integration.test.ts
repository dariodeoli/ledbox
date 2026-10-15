import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
const base = process.env.PORTAL_AUDIT_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && process.env.TEST_DATABASE_URL);

test("portal: revisiones y constancias no retroceden decisiones concurrentes", { skip: !enabled, timeout: 180000 }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { generatePublicToken } = await import("../lib/server/budget-portal");
  const { confirmExpectedPayment } = await import("../lib/server/expected-payments");
  const { portalAuditContext } = await import("../lib/server/audit");
  const org = randomUUID();
  await db.organization.create({ data: { id: org, slug: `portal132-${org}`, name: "Empresa ficticia" } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio" } });
  const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja ficticia" } });
  const actor = portalAuditContext(org, "Operadora ficticia");
  const quote = () => db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Evento ficticio", publicToken: generatePublicToken(), status: "SENT", total: 1000, subtotal: 1000, items: { create: { id: randomUUID(), name: "Producto ficticio", quantity: 1, days: 1, unitPrice: 1000, subtotal: 1000 } } } });
  const callRevision = (token: string) => fetch(`${base}/api/portal/budget/${token}/revision`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `revision132-${org}` }, body: JSON.stringify({ name: "Cliente ficticio", note: "Cambiar horario de armado" }) });
  const callProof = (token: string, expectedId: string) => {
    const form = new FormData();
    form.set("name", "Cliente ficticio"); form.set("expectedPaymentId", expectedId);
    form.set("file", new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], "ficticio.png", { type: "image/png" }));
    return fetch(`${base}/api/portal/budget/${token}/proof`, { method: "POST", headers: { "X-Forwarded-For": `proof132-${org}` }, body: form });
  };
  async function waitBlocked(table: string) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${`%${table}%`}`;
      if (Number(rows[0].count) > 0) return;
      await new Promise(r => setTimeout(r, 15));
    }
    assert.fail(`HTTP no alcanzó el candado ${table}`);
  }
  try {
    // Warm compilation independently before holding a short transaction open.
    await fetch(`${base}/api/portal/budget/${generatePublicToken()}/revision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await fetch(`${base}/api/portal/budget/${generatePublicToken()}/proof`, { method: "POST", body: new FormData() });
    await t.test("aprobación gana mientras la revisión pública espera: 409 sin renegociación", async () => {
      const budget = await quote();
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Budget" WHERE id = ${budget.id} FOR UPDATE`;
        ready(); await gate;
        await tx.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByName: "Operadora ficticia", approvalMethod: "manual" } });
      }, { timeout: 40000 });
      await locked;
      const revision = callRevision(budget.publicToken!);
      try { await waitBlocked("Budget"); } finally { release(); }
      await blocker;
      const response = await revision;
      assert.equal(response.status, 409, await response.clone().text());
      const after = await db.budget.findUniqueOrThrow({ where: { id: budget.id } });
      assert.equal(after.status, "APPROVED"); assert.ok(after.approvedAt); assert.equal(after.revisionRequestedAt, null);
      assert.equal(await db.budgetChangeRequest.count({ where: { budgetId: budget.id } }), 0);
    });
    await t.test("confirmación gana mientras la constancia pública espera: no retrocede CONFIRMED", async () => {
      const budget = await quote();
      await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      const expected = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: budget.id, slot: "balance", concept: "balance", label: "Saldo", amount: 1000 } });
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "ExpectedPayment" WHERE id = ${expected.id} FOR UPDATE`;
        ready(); await gate;
        const outcome = await confirmExpectedPayment({ tx, afterCommit: [], organizationId: org, expectedPaymentId: expected.id, accountId: account.id, method: "Efectivo", actor });
        assert.ok(outcome.ok, JSON.stringify(outcome));
      }, { timeout: 40000 });
      await locked;
      const proof = callProof(budget.publicToken!, expected.id);
      try { await waitBlocked("ExpectedPayment"); } finally { release(); }
      await blocker;
      const response = await proof;
      assert.equal(response.status, 409, await response.clone().text());
      const after = await db.expectedPayment.findUniqueOrThrow({ where: { id: expected.id } });
      assert.equal(after.status, "CONFIRMED"); assert.equal(after.paidAmount, 1000); assert.equal(after.proofId, null);
      assert.equal(await db.budgetPaymentProof.count({ where: { budgetId: budget.id } }), 0);
      assert.equal(await db.clientPayment.count({ where: { budgetId: budget.id, status: "RECEIVED" } }), 1);
      assert.equal(await db.treasuryMovement.count({ where: { organizationId: org, sourceId: after.paymentId! } }), 1);
    });
    await t.test("constancia primero no cobra: confirmación posterior registra exactamente un cobro", async () => {
      const budget = await quote();
      await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      const expected = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: budget.id, slot: "balance", concept: "balance", label: "Saldo", amount: 1000 } });
      const proof = await callProof(budget.publicToken!, expected.id);
      assert.equal(proof.status, 201, await proof.clone().text());
      assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: expected.id } })).status, "PROOF");
      assert.equal(await db.clientPayment.count({ where: { budgetId: budget.id } }), 0);
      const confirm = await confirmExpectedPayment({ organizationId: org, expectedPaymentId: expected.id, accountId: account.id, method: "Efectivo", actor });
      assert.ok(confirm.ok, JSON.stringify(confirm));
      assert.equal((await callProof(budget.publicToken!, expected.id)).status, 409);
      assert.equal(await db.budgetPaymentProof.count({ where: { budgetId: budget.id } }), 1);
      assert.equal(await db.clientPayment.count({ where: { budgetId: budget.id, status: "RECEIVED" } }), 1);
      const portal = await (await fetch(`${base}/api/portal/budget/${budget.publicToken}`)).json();
      assert.equal(portal.budget.collectedAmount, 1000);
    });
    await t.test("revisiones concurrentes se actualizan sin duplicarse; firma impide revisión", async () => {
      const budget = await quote();
      const responses = await Promise.all([callRevision(budget.publicToken!), callRevision(budget.publicToken!)]);
      for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
      assert.equal(await db.budgetChangeRequest.count({ where: { budgetId: budget.id, kind: "changes", status: "pending" } }), 1);
      await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: budget.id, publicCode: randomUUID(), title: "Firma ficticia", senderName: "QA", recipientName: "Cliente ficticio", status: "SIGNED", expiresAt: new Date("2036-01-01"), documentHash: "snapshot132", documentHashCapturedAt: new Date() } });
      assert.equal((await callRevision(budget.publicToken!)).status, 409);
      assert.equal((await db.signatureRequest.findFirstOrThrow({ where: { budgetId: budget.id } })).documentHash, "snapshot132");
    });
    await t.test("constancia de otro presupuesto y archivos inválidos no crean comprobantes", async () => {
      const a = await quote(), b = await quote();
      await db.budget.update({ where: { id: a.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      const expected = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: b.id, slot: "balance", concept: "balance", label: "Saldo", amount: 1000 } });
      assert.equal((await callProof(a.publicToken!, expected.id)).status, 409);
      const form = new FormData(); form.set("name", "Cliente ficticio"); form.set("file", new File(["exe disguised"], "fake.png", { type: "image/png" }));
      assert.equal((await fetch(`${base}/api/portal/budget/${a.publicToken}/proof`, { method: "POST", body: form })).status, 400);
      assert.equal(await db.budgetPaymentProof.count({ where: { budgetId: a.id } }), 0);
    });
    await t.test("cancelar el pago mientras la constancia espera mantiene CANCELLED y revierte el archivo", async () => {
      const budget = await quote();
      await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      const expected = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: budget.id, slot: "balance", concept: "balance", label: "Saldo", amount: 1000 } });
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "ExpectedPayment" WHERE id = ${expected.id} FOR UPDATE`;
        ready(); await gate;
        await tx.expectedPayment.update({ where: { id: expected.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      }, { timeout: 40000 });
      await locked;
      const proof = callProof(budget.publicToken!, expected.id);
      try { await waitBlocked("ExpectedPayment"); } finally { release(); }
      await blocker;
      assert.equal((await proof).status, 409);
      assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: expected.id } })).status, "CANCELLED");
      assert.equal(await db.budgetPaymentProof.count({ where: { budgetId: budget.id } }), 0);
    });
    await t.test("revocar el token mientras la revisión espera revierte toda escritura", async () => {
      const budget = await quote();
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Budget" WHERE id = ${budget.id} FOR UPDATE`;
        ready(); await gate;
        await tx.budget.update({ where: { id: budget.id }, data: { publicToken: generatePublicToken() } });
      }, { timeout: 40000 });
      await locked;
      const revision = callRevision(budget.publicToken!);
      try { await waitBlocked("Budget"); } finally { release(); }
      await blocker;
      assert.equal((await revision).status, 404);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, "SENT");
      assert.equal(await db.budgetChangeRequest.count({ where: { budgetId: budget.id } }), 0);
    });
  } finally {
    await db.organization.delete({ where: { id: org } });
    await db.$disconnect();
  }
});
