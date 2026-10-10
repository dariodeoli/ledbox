import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
const base = process.env.QUOTE_TEST_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("comparison HTTP/DB: exclusive approvals across comparison, standalone, manual/status and signature paths", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const suffix = randomUUID(); const org = `cmp-${suffix}`; const other = `cmp-other-${suffix}`;
  let cookie = "";
  async function call(path: string, method = "GET", body?: unknown, auth = true) {
    return fetch(base + path, { method, headers: { "X-Forwarded-For": `qa-comparison-${suffix}`, ...(auth ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function signature(id: string) {
    const response = await call("/api/admin/signatures", "POST", { budgetId: id, recipientName: "QA signer", method: "TYPED", otpRequired: false });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).request;
  }
  async function pair(clientId: string) {
    const { generatePublicToken } = await import("../lib/server/budget-portal");
    const rows = [];
    for (let i = 0; i < 2; i++) rows.push(await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId, title: `Alternative ${i}`, total: 1000 + i * 500, subtotal: 1000 + i * 500, publicToken: generatePublicToken(), items: { create: { id: randomUUID(), name: `Item ${i}`, unitPrice: 1000 + i * 500, costPrice: 123, subtotal: 1000 + i * 500 } } } }));
    return rows;
  }
  async function create(rows: Array<{ id: string }>) {
    const response = await call("/api/admin/budgets/comparisons", "POST", { title: "QA alternatives", expiresAt: new Date(Date.now() + 86400000).toISOString(), alternatives: rows.map((q, i) => ({ budgetId: q.id, label: `Option ${i + 1}` })) });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).group;
  }
  try {
    await db.organization.createMany({ data: [{ id: org, slug: org, name: "Comparison QA" }, { id: other, slug: other, name: "Other" }] });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, passwordHash: "not-a-login", role: "OWNER", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId: org, role: "OWNER" } });
    const { createSession } = await import("../lib/server/auth");
    cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Comparison client" } });
    const otherClient = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Wrong client" } });
    const rows = await pair(client.id);
    const wrong = (await pair(otherClient.id))[0];
    const foreignClient = await db.client.create({ data: { id: randomUUID(), organizationId: other, name: "Foreign" } });
    const foreign = await db.budget.create({ data: { id: randomUUID(), organizationId: other, clientId: foreignClient.id, title: "Private" } });
    const body = (ids: string[]) => ({ title: "Rejected", expiresAt: new Date(Date.now() + 86400000).toISOString(), alternatives: ids.map((budgetId, i) => ({ budgetId, label: `Option ${i}` })) });
    for (const ids of [[rows[0].id, wrong.id], [rows[0].id, foreign.id]]) assert.equal((await call("/api/admin/budgets/comparisons", "POST", body(ids))).status, 409);
    assert.equal((await call("/api/admin/budgets/comparisons", "POST", body([rows[0].id]), false)).status, 401);
    assert.equal((await call("/api/admin/budgets/comparisons", "POST", body([rows[0].id]))).status, 400);
    const sig = await signature(rows[1].id);
    const group = await create(rows);
    const path = `/api/portal/comparison/${group.publicToken}`;
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: rows[0].id } })).status, "DRAFT", "link issuance must not mark sent");
    const publicView = (await (await call(path, "GET", undefined, false)).json()).comparison;
    assert.equal(publicView.alternatives.length, 2);
    assert.equal(JSON.stringify(publicView).includes("costPrice"), false);
    assert.equal(JSON.stringify(publicView).includes("organizationId"), false);
    const doc = await PDFDocument.create(); doc.addPage();
    const pdf = Buffer.from(await doc.save());
    const file = await db.budgetAttachment.create({ data: { id: randomUUID(), organizationId: org, budgetId: rows[0].id, name: "QA.pdf", mime: "application/pdf", size: pdf.length, data: pdf, uploadedByName: "QA" } });
    const resource = `${path}/resources/${rows[0].id}/pdf/${file.id}`;
    assert.equal((await call(resource, "GET", undefined, false)).status, 404);
    await db.budgetAttachment.update({ where: { id: file.id }, data: { clientVisible: true } });
    const shown = await call(resource, "GET", undefined, false);
    assert.equal(shown.status, 200); assert.equal(Buffer.from(await shown.arrayBuffer()).equals(pdf), true);
    assert.equal((await call(`${path}/resources/${foreign.id}/pdf/${file.id}`, "GET", undefined, false)).status, 404);
    // Race two different alternatives through different real entry points.
    const results = await Promise.all([
      call(path + "/approve", "POST", { budgetId: rows[0].id, name: "QA client", consent: true }, false),
      call(`/api/portal/budget/${rows[1].publicToken}/approve`, "POST", { name: "QA client", consent: true }, false),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const chosen = await db.quoteComparison.findUniqueOrThrow({ where: { id: group.id } });
    const loser = rows.find((q) => q.id !== chosen.selectedBudgetId)!;
    assert.equal(await db.budget.count({ where: { comparisonId: group.id, approvedAt: { not: null } } }), 1);
    assert.equal((await call("/api/admin/budgets/approval", "POST", { budgetId: loser.id, decision: "approve" })).status, 409);
    assert.equal((await call("/api/admin/budgets", "PATCH", { budgetId: loser.id, status: "APPROVED" })).status, 409);
    if (loser.id === rows[1].id) assert.equal((await call(`/api/portal/firma/${sig.code}/sign`, "POST", { consent: true, signature: { name: "QA signer" } }, false)).status, 409);
    assert.equal((await call(path + "/approve", "POST", { budgetId: chosen.selectedBudgetId, name: "QA client", consent: true }, false)).status, 200);

    const manualRows = await pair(client.id); const manualGroup = await create(manualRows);
    const mixed = await Promise.all([
      call("/api/admin/budgets/approval", "POST", { budgetId: manualRows[0].id, decision: "approve" }),
      call("/api/admin/budgets", "PATCH", { budgetId: manualRows[1].id, status: "APPROVED" }),
    ]);
    assert.deepEqual(mixed.map((r) => r.status).sort(), [200, 409]);
    assert.ok((await db.quoteComparison.findUniqueOrThrow({ where: { id: manualGroup.id } })).selectedBudgetId);

    // Two signature completions must not both validate. No recipients => no outbound mail.
    const signRows = await pair(client.id);
    const signatures = await Promise.all(signRows.map((q) => signature(q.id)));
    const signGroup = await create(signRows);
    const signed = await Promise.all(signatures.map((s) => call(`/api/portal/firma/${s.code}/sign`, "POST", { consent: true, signature: { name: "QA signer" } }, false)));
    assert.deepEqual(signed.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await db.signatureRequest.count({ where: { budgetId: { in: signRows.map((q) => q.id) }, status: "VALIDATED" } }), 1);
    assert.equal(await db.budget.count({ where: { comparisonId: signGroup.id, approvedAt: { not: null } } }), 1);
    const signChosen = await db.quoteComparison.findUniqueOrThrow({ where: { id: signGroup.id } });
    const signLoser = signRows.find((q) => q.id !== signChosen.selectedBudgetId)!;
    assert.equal((await call(`/api/portal/budget/${signLoser.publicToken}/approve`, "POST", { name: "QA client", consent: true }, false)).status, 409);
    // Changing a selected status cannot release its immutable group selection.
    await call("/api/admin/budgets", "PATCH", { budgetId: signChosen.selectedBudgetId, status: "DRAFT" });
    assert.equal((await call("/api/admin/budgets/approval", "POST", { budgetId: signLoser.id, decision: "approve" })).status, 409);
    const expiredRows = await pair(client.id); const expired = await create(expiredRows);
    await db.quoteComparison.update({ where: { id: expired.id }, data: { expiresAt: new Date("2020-01-01") } });
    assert.equal((await call(`/api/portal/comparison/${expired.publicToken}`, "GET", undefined, false)).status, 404);
    assert.equal((await call(`/api/portal/comparison/${expired.publicToken}/approve`, "POST", { budgetId: expiredRows[0].id, name: "QA client", consent: true }, false)).status, 404);
    assert.equal((await call("/api/admin/budgets/approval", "POST", { budgetId: expiredRows[0].id, decision: "approve" })).status, 409);
    await call("/api/admin/budgets/comparisons", "PATCH", { id: group.id, action: "revoke" });
    assert.equal((await call(path, "GET", undefined, false)).status, 404);
    assert.equal((await call(resource, "GET", undefined, false)).status, 404);
    assert.equal((await call("/api/admin/budgets/comparisons", "PATCH", { id: group.id, action: "renew" })).status, 200);
    const renewed = await db.quoteComparison.findUniqueOrThrow({ where: { id: group.id } });
    assert.notEqual(renewed.publicToken, group.publicToken);
    assert.equal(renewed.selectedBudgetId, chosen.selectedBudgetId, "renewal never releases the selected alternative");
    assert.equal((await call(path, "GET", undefined, false)).status, 404);
    assert.equal((await call(path + "/approve", "POST", { budgetId: chosen.selectedBudgetId, name: "QA client", consent: true }, false)).status, 404);
    assert.equal((await call(`/api/portal/comparison/${renewed.publicToken}`, "GET", undefined, false)).status, 200);
    assert.equal((await call("/api/admin/budgets/approval", "POST", { budgetId: loser.id, decision: "approve" })).status, 409);
  } finally { await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
