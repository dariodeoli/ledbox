import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.QUOTE_TEST_BASE_URL;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const output = process.env.QUOTE_EVIDENCE_DIR;
const pdfRenderer = process.env.SIGNATURE_PDF_RENDERER;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("I04 PG HTTP: snapshot signed payload/PDF immutable, versioned legacy honest, chain and attachments verified", { skip: !enabled, timeout: 180000 }, async () => {
  const db = new PrismaClient(), suffix = randomUUID(), org = `immutable-signature-${suffix}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  if (output) mkdirSync(output, { recursive: true });
  try {
    const { createSession } = await import("../lib/server/auth");
    const { appendSignatureEvent } = await import("../lib/server/signature/events");
    const { requestInclude, signatureLiveBudgetDocument } = await import("../lib/server/signature/portal");
    const { budgetDocumentPayload, budgetDocumentHash, attachmentDocumentHash, verifiedSignatureSnapshot } = await import("../lib/server/signature/document");
    const { verifySignatureChain } = await import("../lib/server/signature/hash");
    const { generateSignatureCode } = await import("../lib/server/signature/codes");
    await db.organization.create({ data: { id: org, slug: org, name: "Frozen issuer original" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "Snapshot QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId: org, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Historical contact", company: "Not fiscal historical", tradeName: "Frozen fantasy original", legalName: "Frozen legal original" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Frozen event original", location: "Frozen location original", startsAt: new Date("2030-01-10T12:00:00Z") } });
    const jwt = (await createSession(user, org)).jwt;
    async function call(path: string, method = "GET", body?: unknown, admin = false) {
      return fetch(base + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", "X-Forwarded-For": `snapshot-${suffix}`, ...(admin ? { Cookie: `ledbox_session=${jwt}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    async function budget(title: string) {
      const response = await call("/api/admin/budgets", "POST", { clientId: client.id, eventId: event.id, title, items: [{ name: "Second", quantity: 1, days: 1, unitPrice: 200, costPrice: 13 }, { name: "First", quantity: 1, days: 1, unitPrice: 100, costPrice: 17 }] }, true);
      assert.equal(response.status, 201); return (await response.json()).budget;
    }
    async function issue(id: string, attachmentId?: string) {
      const response = await call("/api/admin/signatures", "POST", { budgetId: id, attachmentId, recipientName: "Snapshot signer", method: "TYPED", otpRequired: false }, true);
      assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).request;
    }
    const sign = (code: string) => call(`/api/portal/firma/${code}/sign`, "POST", { consent: true, signature: { name: "Snapshot signer" } });
    const page = await browser.newPage();
    async function render(code: string, name: string) {
      const response = await page.goto(`${base}/firma/${code}/documento`, { waitUntil: "networkidle0" });
      assert.equal(response?.status(), 200);
      const htmlText = (await page.$eval(".portal-signature-print", node => node.textContent ?? "")).replace(/\s+/g, " ").trim();
      let pdfText: string | undefined;
      if (output && pdfRenderer) {
        const pdf = join(output, `${name}.pdf`), dir = join(output, `${name}-render`);
        await page.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true });
        execFileSync("swift", [pdfRenderer, pdf, dir], { stdio: "pipe" });
        const parsed = JSON.parse(readFileSync(join(dir, "pages.json"), "utf8"));
        pdfText = parsed.pages.map((p: { text: string }) => p.text.replace(/\s+/g, "")).join("");
      }
      return { htmlText, pdfText };
    }

    // New request captures all public parts, explicitly ordered, before SENT.
    const q = await budget("Immutable snapshot document"); const issued = await issue(q.id);
    const creation = await db.signatureEvent.findFirstOrThrow({ where: { requestId: issued.id, eventType: "REQUEST_CREATED" } });
    const metadata = creation.metadataJson as Record<string, unknown>;
    assert.equal(metadata.documentVersion, 2); assert.equal(metadata.documentSnapshotHash, issued.documentHash);
    assert.doesNotMatch(JSON.stringify(metadata.documentSnapshot), /"(?:costPrice|costEstimate|materialCost|laborCost|margin|inventoryId)"/);
    const sent = await call(`/api/portal/firma/${issued.code}`); assert.equal(sent.status, 200);
    const sentView = (await sent.json()).signature;
    assert.deepEqual(sentView.budget.items.map((item: { name: string }) => item.name), ["Second", "First"]);
    assert.equal(sentView.budget.client.displayName, "Frozen fantasy original"); assert.equal(sentView.budget.client.legalName, "Frozen legal original");
    assert.equal((await sign(issued.code)).status, 200);
    const before = await db.signatureRequest.findUniqueOrThrow({ where: { id: issued.id } });
    const oldEvents = await db.signatureEvent.findMany({ where: { requestId: issued.id }, orderBy: { occurredAt: "asc" } });
    const oldPayload = (await (await call(`/api/portal/firma/${issued.code}`)).json()).signature;
    const original = await render(issued.code, "signed-original-before");
    assert.match(original.htmlText, /Frozen fantasy original/); assert.match(original.htmlText, /Frozen legal original/);
    assert.doesNotMatch(original.htmlText, /Not fiscal historical/);
    const changed = await call(`/api/admin/clients/${client.id}`, "PATCH", { name: "Changed contact", company: "Changed historical company", tradeName: "Changed fantasy", legalName: "Changed legal" }, true);
    assert.equal(changed.status, 200, await changed.clone().text());
    await db.event.update({ where: { id: event.id }, data: { name: "Changed event", location: "Changed location", startsAt: new Date("2031-01-10T15:00:00Z") } });
    await db.organization.update({ where: { id: org }, data: { name: "Changed issuer" } });
    await db.budgetItem.updateMany({ where: { budgetId: q.id }, data: { name: "Changed signed line", unitPrice: 500, subtotal: 500 } });
    await db.budget.update({ where: { id: q.id }, data: { notes: "Changed signed notes", paymentTerms: "Changed signed plan", advanceAmount: 50, installmentsJson: [{ label: "Changed installment", amount: 250, dueAt: null }] } });
    const fresh = (await (await call(`/api/portal/firma/${issued.code}`)).json()).signature;
    const after = await render(issued.code, "signed-original-after");
    assert.equal(after.htmlText, original.htmlText); if (original.pdfText) assert.equal(after.pdfText, original.pdfText);
    assert.deepEqual(fresh.budget, oldPayload.budget); assert.equal(fresh.organizationName, oldPayload.organizationName);
    assert.deepEqual(await db.signatureRequest.findUniqueOrThrow({ where: { id: issued.id } }), before);
    assert.deepEqual(await db.signatureEvent.findMany({ where: { requestId: issued.id }, orderBy: { occurredAt: "asc" } }), oldEvents);
    assert.deepEqual(await db.signatureEvent.findUniqueOrThrow({ where: { id: creation.id } }), creation);
    assert.equal(verifySignatureChain(oldEvents).valid, true);

    // Rebuild a real legacy v1 fixture with its exact name-asc recipe, no snapshot/backfill.
    async function legacy() {
      const quote = await budget("Legacy intact recipe"); const id = randomUUID(), code = generateSignatureCode();
      await db.signatureRequest.create({ data: { id, organizationId: org, budgetId: quote.id, publicCode: code, title: quote.title, senderName: "Legacy issuer", recipientName: "Snapshot signer", method: "TYPED", status: "SENT", expiresAt: new Date(Date.now() + 86400000), documentHash: "placeholder", documentHashCapturedAt: new Date() } });
      const row = await db.signatureRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
      const payload = budgetDocumentPayload(signatureLiveBudgetDocument(row, 1));
      assert.equal(payload.version, 1); assert.deepEqual((payload.items as Array<{ name: string }>).map(i => i.name), ["First", "Second"]);
      const hash = budgetDocumentHash(payload); await db.signatureRequest.update({ where: { id }, data: { documentHash: hash } });
      await appendSignatureEvent({ requestId: id, organizationId: org, eventType: "REQUEST_CREATED", status: "SENT", metadata: { documentoHash: hash, commercialHash: hash } });
      for (const type of ["SIGNATURE", "TIMESTAMP", "SEAL"] as const) await db.signatureEvidence.create({ data: { id: randomUUID(), organizationId: org, requestId: id, type, status: "PENDING" } });
      return { id, code, hash };
    }
    const old = await legacy(); assert.equal((await call(`/api/portal/firma/${old.code}`)).status, 200);
    assert.equal((await sign(old.code)).status, 200, "legacy verified unchanged still signs");
    const oldSigned = await db.signatureRequest.findUniqueOrThrow({ where: { id: old.id } });
    const oldChain = await db.signatureEvent.findMany({ where: { requestId: old.id }, orderBy: { occurredAt: "asc" } });
    await db.client.update({ where: { id: client.id }, data: { company: "Legacy identity changed after signing" } });
    assert.equal((await call(`/api/portal/firma/${old.code}`)).status, 409, "legacy changed cannot pretend original content");
    await page.goto(`${base}/firma/${old.code}/documento`, { waitUntil: "networkidle0" });
    assert.match(await page.$eval("body", node => node.textContent ?? ""), /Documento original no disponible/);
    assert.equal(await page.$(".portal-signature-print"), null, "legacy changed never presents current content under historical seal");
    assert.deepEqual(await db.signatureRequest.findUniqueOrThrow({ where: { id: old.id } }), oldSigned);
    assert.deepEqual(await db.signatureEvent.findMany({ where: { requestId: old.id }, orderBy: { occurredAt: "asc" } }), oldChain);

    // Snapshot rendering must not mask live commercial edits before signing.
    const staleQuote = await budget("New stale commercial"); const stale = await issue(staleQuote.id);
    const edited = await call("/api/admin/budgets", "PATCH", { budgetId: staleQuote.id, kind: "items", items: [{ name: "Price changed", quantity: 1, days: 1, unitPrice: 900 }] }, true);
    assert.equal(edited.status, 200); assert.equal((await sign(stale.code)).status, 409);
    const staleView = (await (await call(`/api/portal/firma/${stale.code}`)).json()).signature;
    assert.deepEqual(staleView.budget.items.map((i: { name: string }) => i.name), ["Second", "First"], "SENT renders captured snapshot after live edit");
    assert.equal((await db.signatureRequest.findUniqueOrThrow({ where: { id: stale.id } })).signedDocumentHash, null);

    // Public attachment bytes remain independently bound to their original hash.
    const attachmentQuote = await budget("Attachment original");
    const { PDFDocument } = await import("pdf-lib"); const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = await pdf.save();
    const attachment = await db.budgetAttachment.create({ data: { id: randomUUID(), organizationId: org, budgetId: attachmentQuote.id, name: "Original.pdf", mime: "application/pdf", size: bytes.length, data: new Uint8Array(bytes), uploadedByName: "QA" } });
    const attached = await issue(attachmentQuote.id, attachment.id); assert.equal(attached.documentHash, attachmentDocumentHash(bytes));
    assert.equal((await sign(attached.code)).status, 200);
    const binary = await call(`/api/portal/firma/${attached.code}/documento`); assert.equal(binary.status, 200);
    assert.equal(attachmentDocumentHash(new Uint8Array(await binary.arrayBuffer())), attached.documentHash);
    await db.budgetAttachment.update({ where: { id: attachment.id }, data: { data: new Uint8Array([1, 2, 3]) } });
    assert.equal((await call(`/api/portal/firma/${attached.code}/documento`)).status, 409);

    // A forged snapshot breaks REQUEST_CREATED chain even before the public projection.
    const tampered = await db.signatureRequest.findUniqueOrThrow({ where: { id: issued.id }, include: requestInclude });
    const modified = structuredClone(tampered); (modified.events[0].metadataJson as Record<string, unknown>).documentSnapshotHash = "0".repeat(64);
    assert.throws(() => verifiedSignatureSnapshot(modified), /cadena/);
    if (output) writeFileSync(join(output, "snapshot-result.json"), JSON.stringify({ status: "PASS", requestId: issued.id, documentHash: before.documentHash, signedDocumentHash: before.signedDocumentHash, payloadBefore: oldPayload, payloadAfter: fresh, normalizedPDFTextEqual: original.pdfText ? original.pdfText === after.pdfText : null, legacyIntactSigns: true, legacyChanged409: true, liveCommercialStale409: true, attachmentBytesVerified: true, chainValid: true }, null, 2));
  } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
