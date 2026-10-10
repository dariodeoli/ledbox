import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Explicit opt-in, isolated local fixture database only. Never reads app .env files.
test("validated selections persist and serialize with approval/signature in PostgreSQL", { skip: !process.env.QUOTE_SELECTION_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.QUOTE_SELECTION_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/ledbox_exclusion_qa");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { withQuoteApproval, withQuoteCommercialEdit } = await import("../lib/server/quote-comparison");
  const { resolveItemProposal, portalInclude, portalBudgetView, generatePublicToken } = await import("../lib/server/budget-portal");
  const { POST: propose } = await import("../app/api/portal/budget/[token]/propose/route");
  const { signatureLiveBudgetDocument, requestInclude, signSignatureRequest } = await import("../lib/server/signature/portal");
  const { budgetDocumentHash, budgetDocumentPayload } = await import("../lib/server/signature/document");
  const { generateSignatureCode } = await import("../lib/server/signature/codes");
  const org = randomUUID(), client = randomUUID(), quote = randomUUID(), paid = randomUUID(), gift = randomUUID(), product = randomUUID();
  try {
    await db.organization.create({ data: { id: org, name: "Selection QA", slug: `selection-qa-${org}` } });
    await db.client.create({ data: { id: client, organizationId: org, name: "Fixture client" } });
    await db.inventoryItem.create({ data: { id: product, organizationId: org, name: "Fixture stand", category: "QA", imageUrl: "/assets/stand.png" } });
    await db.budget.create({ data: { id: quote, organizationId: org, clientId: client, title: "Fixture", subtotal: 6000, total: 6000, items: { create: [
      { id: paid, name: "Original stand", quantity: 2, days: 3, unitPrice: 1000, costPrice: 20, subtotal: 6000, inventoryId: product },
      { id: gift, name: "Brindis", quantity: 1, days: 1, unitPrice: 0, subtotal: 0 },
    ] } } });
    const original = await db.budgetItem.findUniqueOrThrow({ where: { id: paid } });
    const token = generatePublicToken();
    await db.budget.update({ where: { id: quote }, data: { publicToken: token } });
    const send = (items: unknown) => propose(new Request("http://localhost/api/portal/propose", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": org }, body: JSON.stringify({ kind: "items", name: "Fixture client", note: "Revisar selección", items }) }), { params: Promise.resolve({ token }) });
    await t.test("real proposal route validates and persists selection without changing commercial lines", async () => {
      for (const items of [
        [{ id: "foreign", quantity: 1, days: 1, excluded: true }],
        [{ id: paid, quantity: 2, days: 3, unitPrice: 1 }],
        [{ id: paid, quantity: 2, days: 3, excluded: true }, { id: gift, quantity: 1, days: 1, excluded: true }],
        [{ id: paid, quantity: 2, days: 3, excluded: true }, { id: paid, quantity: 2, days: 3 }],
      ]) assert.equal((await send(items)).status, 400);
      const { counterofferExclusion } = await import("../lib/quote-selection");
      assert.equal((await send([{ id: paid, quantity: 3, days: 5, excluded: false }])).status, 200, "client may propose changed quantity and days");
      const counteroffer = counterofferExclusion(original, { quantity: 3, days: 5 }, true);
      const adminProposal = resolveItemProposal(await db.budgetItem.findMany({ where: { budgetId: quote } }), [{ id: paid, ...counteroffer }], { requireChange: false });
      assert.equal(adminProposal.ok, true, "admin UI exclusion passes the same resolver used by acceptance handler");
      assert.deepEqual(counteroffer, { quantity: 2, days: 3, excluded: true });
      assert.equal((await send([{ id: paid, quantity: 2, days: 3, excluded: true }])).status, 200);
      assert.deepEqual(await db.budgetItem.findUniqueOrThrow({ where: { id: paid } }), original);
      assert.equal((await send([{ id: paid, quantity: 2, days: 3, excluded: false }])).status, 200, "pending selection can be restored");
      assert.equal((await send([{ id: paid, quantity: 2, days: 3, excluded: true }])).status, 200);
      assert.equal(await db.budgetChangeRequest.count({ where: { budgetId: quote, status: "pending" } }), 1);
      await db.budget.update({ where: { id: quote }, data: { validUntil: new Date(0) } });
      assert.equal((await send([{ id: paid, quantity: 2, days: 3, excluded: false }])).status, 404);
      await db.budget.update({ where: { id: quote }, data: { validUntil: null, publicToken: null } });
      assert.equal((await send([{ id: paid, quantity: 2, days: 3, excluded: false }])).status, 404);
      await db.budget.update({ where: { id: quote }, data: { publicToken: token } });
    });
    const request = await db.budgetChangeRequest.findFirstOrThrow({ where: { budgetId: quote, status: "pending" } });
    await assert.rejects(withQuoteApproval(quote, org, async () => true), /pendiente/);
    const rows = await db.budgetItem.findMany({ where: { budgetId: quote } });
    const proposal = resolveItemProposal(rows, [{ id: paid, quantity: 2, days: 3, excluded: true }]);
    assert.equal(proposal.ok, true);
    await withQuoteCommercialEdit(quote, org, true, async (tx) => {
      await tx.budgetItem.update({ where: { id: paid }, data: { excluded: true, subtotal: 0 } });
      await tx.budget.update({ where: { id: quote }, data: { subtotal: 0, total: 0 } });
      await tx.budgetChangeRequest.update({ where: { id: request.id }, data: { status: "accepted" } });
    });
    const changed = await db.budgetItem.findUniqueOrThrow({ where: { id: paid } });
    for (const key of ["id", "name", "quantity", "days", "unitPrice", "costPrice", "inventoryId"] as const) assert.equal(changed[key], original[key]);
    const view = portalBudgetView(await db.budget.findUniqueOrThrow({ where: { id: quote }, include: portalInclude }));
    assert.equal(view.items.find((item) => item.id === paid)?.excluded, true);
    assert.equal(view.items.find((item) => item.id === paid)?.imageUrl, "/assets/stand.png");
    assert.doesNotMatch(JSON.stringify(view), /costPrice|costEstimate/);
    assert.equal(await withQuoteApproval(quote, org, async () => "free active gift"), "free active gift");
    await t.test("inventory reserves active free lines, never excluded originals", async () => {
      const { reserveBudgetInventory } = await import("../lib/server/inventory-availability");
      const { portalAuditContext } = await import("../lib/server/audit");
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client, name: "Fixture event", startsAt: new Date("2030-01-10T12:00:00Z"), endsAt: new Date("2030-01-11T12:00:00Z") } });
      await db.budget.update({ where: { id: quote }, data: { eventId: event.id } });
      await db.budgetItem.update({ where: { id: gift }, data: { inventoryId: product } });
      await reserveBudgetInventory({ organizationId: org, budgetId: quote, context: portalAuditContext(org, "Fixture client") });
      const reserved = await db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: event.id, inventoryId: product } } });
      assert.equal(reserved.quantity, 1, "only the included free line reserves stock, not the excluded quantity of two");
      await db.eventInventory.delete({ where: { id: reserved.id } });
    });
    await db.budgetItem.update({ where: { id: gift }, data: { excluded: true } });
    await assert.rejects(withQuoteApproval(quote, org, async () => true), /al menos/);
    await db.budgetItem.update({ where: { id: gift }, data: { excluded: false } });
    await db.budget.update({ where: { id: quote }, data: { advanceAmount: 1 } });
    await assert.rejects(withQuoteApproval(quote, org, async () => true), /plan de pagos/);
    await db.budget.update({ where: { id: quote }, data: { advanceAmount: 0 } });
    await assert.rejects(withQuoteApproval(quote, randomUUID(), async () => true), /no encontrado/);

    await t.test("excluding even a free line makes an issued standalone signature stale", async () => {
      await db.budgetItem.update({ where: { id: paid }, data: { excluded: false, subtotal: 6000 } });
      await db.budget.update({ where: { id: quote }, data: { subtotal: 6000, total: 6000 } });
      const code = generateSignatureCode();
      const signature = await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: quote, publicCode: code, title: "Fixture signature", senderName: "QA", recipientName: "Fixture client", method: "TYPED", expiresAt: new Date(Date.now() + 86400000), documentHash: "placeholder", documentHashCapturedAt: new Date() } });
      const row = await db.signatureRequest.findUniqueOrThrow({ where: { id: signature.id }, include: requestInclude });
      const hash = budgetDocumentHash(budgetDocumentPayload(signatureLiveBudgetDocument(row, 1)));
      await db.signatureRequest.update({ where: { id: signature.id }, data: { documentHash: hash } });
      await withQuoteCommercialEdit(quote, org, true, (tx) => tx.budgetItem.update({ where: { id: gift }, data: { excluded: true } }));
      await assert.rejects(signSignatureRequest({ code, body: { consent: true, signature: { name: "Fixture client" } }, evidence: { ipHash: null, userAgentHash: null } }), /presupuesto cambió/);
      assert.equal(await db.signatureEvidence.count({ where: { requestId: signature.id } }), 0);
      assert.equal((await db.signatureRequest.findUniqueOrThrow({ where: { id: signature.id } })).status, "SENT");
      await db.signatureRequest.update({ where: { id: signature.id }, data: { status: "VALIDATED" } });
      await assert.rejects(withQuoteCommercialEdit(quote, org, true, async () => true), /firmado/);
      await db.signatureRequest.delete({ where: { id: signature.id } });
    });

    await t.test("a commercial writer waiting behind approval cannot modify the approved quote", async () => {
      const alternative = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client, title: "Other fixture", items: { create: { id: randomUUID(), name: "Other free item", unitPrice: 0, subtotal: 0 } } } });
      const group = await db.quoteComparison.create({ data: { id: randomUUID(), organizationId: org, clientId: client, title: "Fixture alternatives", publicToken: generatePublicToken(), expiresAt: new Date(Date.now() + 86400000) } });
      await db.budget.updateMany({ where: { id: { in: [quote, alternative.id] } }, data: { comparisonId: group.id } });
      let locked!: () => void, release!: () => void;
      const hasLock = new Promise<void>((resolve) => { locked = resolve; });
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      const approval = withQuoteApproval(quote, org, async (tx) => {
        locked(); await barrier;
        return tx.budget.update({ where: { id: quote }, data: { status: "APPROVED", approvedAt: new Date() } });
      });
      await hasLock;
      const edit = withQuoteCommercialEdit(quote, org, true, (tx) => tx.budgetItem.update({ where: { id: paid }, data: { excluded: true } }));
      release();
      await approval;
      await assert.rejects(edit, /aprobada/);
      assert.equal((await db.budgetItem.findUniqueOrThrow({ where: { id: paid } })).excluded, false);
      assert.equal((await db.quoteComparison.findUniqueOrThrow({ where: { id: group.id } })).selectedBudgetId, quote);
      await assert.rejects(withQuoteApproval(alternative.id, org, async () => true), /otra alternativa/);
    });
  } finally {
    await db.budget.updateMany({ where: { organizationId: org }, data: { comparisonId: null } });
    await db.quoteComparison.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } });
    await db.$disconnect();
  }
});
