import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

const base = process.env.QUOTE_TEST_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("grouped signatures reject stale commercial versions atomically, including concurrent edits", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(); const suffix = randomUUID(); const org = `sig-version-${suffix}`;
  try {
    await db.organization.create({ data: { id: org, slug: org, name: "Signature version QA" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId: org, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "QA client" } });
    const { createSession } = await import("../lib/server/auth");
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    async function call(path: string, body: unknown, method = "POST", auth = true) {
      return fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": `qa-signature-${suffix}`, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    }
    async function fixture(attachment = false) {
      const rows: Array<{ id: string }> = [];
      for (let i = 0; i < 2; i++) {
        const response = await call("/api/admin/budgets", { clientId: client.id, title: `Version option ${i}`, items: [{ name: "Service", quantity: 1, days: 1, unitPrice: 1000 }] });
        assert.equal(response.status, 201); rows.push((await response.json()).budget);
      }
      let attachmentId: string | undefined;
      if (attachment) {
        const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
        const file = await db.budgetAttachment.create({ data: { id: randomUUID(), organizationId: org, budgetId: rows[0].id, name: "Signed original.pdf", mime: "application/pdf", size: bytes.length, data: bytes, uploadedByName: "QA" } });
        attachmentId = file.id;
      }
      async function issue() {
        const response = await call("/api/admin/signatures", { budgetId: rows[0].id, attachmentId, recipientName: "QA signer", method: "TYPED", otpRequired: false });
        assert.equal(response.status, 201); return (await response.json()).request;
      }
      const signature = await issue();
      const grouped = await call("/api/admin/budgets/comparisons", { title: "Version alternatives", expiresAt: new Date(Date.now() + 86400000).toISOString(), alternatives: rows.map((q, i) => ({ budgetId: q.id, label: `Option ${i}` })) });
      assert.equal(grouped.status, 201); const group = (await grouped.json()).group;
      return { rows, signature, group, issue };
    }
    async function sign(code: string) { return call(`/api/portal/firma/${code}/sign`, { consent: true, signature: { name: "QA signer" } }, "POST", false); }
    async function assertNotApproved(f: Awaited<ReturnType<typeof fixture>>) {
      const quote = await db.budget.findUniqueOrThrow({ where: { id: f.rows[0].id } });
      const request = await db.signatureRequest.findUniqueOrThrow({ where: { id: f.signature.id } });
      assert.equal(quote.approvedAt, null); assert.notEqual(quote.status, "APPROVED");
      assert.equal((await db.quoteComparison.findUniqueOrThrow({ where: { id: f.group.id } })).selectedBudgetId, null);
      assert.notEqual(request.status, "VALIDATED"); assert.equal(request.signedDocumentHash, null);
      assert.equal(await db.signatureEvent.count({ where: { requestId: request.id, eventType: { in: ["SIGNATURE_RECEIVED", "DOCUMENT_VALIDATED"] } } }), 0);
      assert.equal(await db.signatureEvidence.count({ where: { requestId: request.id, type: { in: ["SIGNATURE", "TIMESTAMP", "SEAL"] }, capturedAt: { not: null } } }), 0);
    }
    // Exact reviewer reproduction, plus attachment signatures must bind quote terms too.
    for (const attachment of [false, true]) {
      const f = await fixture(attachment);
      const original = await db.signatureRequest.findUniqueOrThrow({ where: { id: f.signature.id } });
      assert.equal((await call("/api/admin/budgets", { kind: "items", budgetId: f.rows[0].id, items: [{ name: "Service", quantity: 1, days: 1, unitPrice: 2000 }] }, "PATCH")).status, 200);
      assert.equal((await sign(f.signature.code)).status, 409);
      await assertNotApproved(f);
      assert.equal((await db.signatureRequest.findUniqueOrThrow({ where: { id: original.id } })).documentHash, original.documentHash);
      const fresh = await f.issue(); assert.equal((await sign(fresh.code)).status, 200);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: f.rows[0].id } })).total, 2000);
      assert.equal((await call("/api/admin/budgets", { budgetId: f.rows[0].id, paymentTerms: "Unsigned later terms" }, "PATCH")).status, 409);
      assert.equal((await call("/api/admin/budgets", { kind: "commercial", budgetId: f.rows[0].id, materialCost: 10 }, "PATCH")).status, 200, "internal cost-only edits remain allowed");
      assert.equal((await db.quoteComparison.findUniqueOrThrow({ where: { id: f.group.id } })).selectedBudgetId, f.rows[0].id);
    }
    // Concurrent HTTP requests: whichever obtains the quote lock first wins.
    // Edits first => stale signature409; signature first => commercial edit409.
    const edits = [
      { kind: "editor", title: "Edited atomically", items: [{ name: "Service", quantity: 1, days: 1, unitPrice: 2000 }], installmentsJson: [{ label: "Saldo", type: "remainder", moment: "Antes del montaje" }] },
      { kind: "items", items: [{ name: "Service", quantity: 1, days: 1, unitPrice: 2000 }] },
      { kind: "commercial", warranty: "Changed warranty" },
      { paymentTerms: "Changed payment conditions" },
      { proposal: true },
    ];
    for (const edit of edits) {
      const f = await fixture();
      let change: Promise<Response>;
      if ("proposal" in edit) {
        const request = await db.budgetChangeRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: f.rows[0].id, kind: "discount", requestedByName: "QA client", payload: { discount: { type: "amount", value: 200, amount: 200 } } } });
        change = call("/api/admin/budgets/requests", { requestId: request.id, decision: "accept" });
      } else change = call("/api/admin/budgets", { budgetId: f.rows[0].id, ...edit }, "PATCH");
      const [changed, signed] = await Promise.all([change, sign(f.signature.code)]);
      assert.deepEqual([changed.status, signed.status].sort(), [200, 409]);
      console.log(`Commercial edit/sign race: ${"proposal" in edit ? "proposal" : edit.kind ?? "payment-plan"}, edit=${changed.status}, sign=${signed.status}`);
      if (signed.status === 200) {
        const quote = await db.budget.findUniqueOrThrow({ where: { id: f.rows[0].id } });
        assert.equal(quote.status, "APPROVED"); assert.equal(quote.total, 1000); assert.equal(quote.warranty, null); assert.equal(quote.paymentTerms, null);
      } else await assertNotApproved(f);
    }
  } finally { await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
