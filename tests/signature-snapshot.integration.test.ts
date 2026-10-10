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
    async function budget(title: string, total = 300) {
      const response = await call("/api/admin/budgets", "POST", { clientId: client.id, eventId: event.id, title, items: [{ name: "Second", quantity: 1, days: 1, unitPrice: total * 2 / 3, costPrice: 13 }, { name: "First", quantity: 1, days: 1, unitPrice: total / 3, costPrice: 17 }] }, true);
      assert.equal(response.status, 201); return (await response.json()).budget;
    }
    async function issue(id: string, attachmentId?: string, method = "TYPED") {
      const response = await call("/api/admin/signatures", "POST", { budgetId: id, attachmentId, recipientName: "Snapshot signer", method, otpRequired: false }, true);
      assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).request;
    }
    const sign = (code: string) => call(`/api/portal/firma/${code}/sign`, "POST", { consent: true, signature: { name: "Snapshot signer" } });
    const page = await browser.newPage();
    await page.emulateTimezone("America/Asuncion");
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
    const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Public installment account", type: "BANK", openingBalance: 12345 } });
    const conditions = (percent = 30) => [
      { label: "Reserva", type: "percent", value: percent, dueAt: "2099-01-05", moment: "Al confirmar", accountId: account.id },
      { label: "Cuota", type: "fixed", value: 200000, dueAt: "2099-01-09", moment: "Antes del montaje", accountId: account.id },
      { label: "Saldo", type: "remainder", dueAt: "2099-01-12", moment: "Después", accountId: account.id },
    ];
    const q = await budget("Immutable snapshot document", 900000);
    const planPatch = await call("/api/admin/budgets", "PATCH", { budgetId: q.id, installmentsJson: conditions() }, true);
    assert.equal(planPatch.status, 200, await planPatch.clone().text());
    const issued = await issue(q.id);
    const creation = await db.signatureEvent.findFirstOrThrow({ where: { requestId: issued.id, eventType: "REQUEST_CREATED" } });
    const metadata = creation.metadataJson as Record<string, unknown>;
    assert.equal(metadata.documentVersion, 2); assert.equal(metadata.documentSnapshotHash, issued.documentHash);
    assert.doesNotMatch(JSON.stringify(metadata.documentSnapshot), /"(?:costPrice|costEstimate|materialCost|laborCost|margin|inventoryId)"/);
    const sent = await call(`/api/portal/firma/${issued.code}`); assert.equal(sent.status, 200);
    const sentView = (await sent.json()).signature;
    assert.deepEqual(sentView.budget.items.map((item: { name: string }) => item.name), ["Second", "First"]);
    assert.equal(sentView.budget.client.displayName, "Frozen fantasy original"); assert.equal(sentView.budget.client.legalName, "Frozen legal original");
    assert.deepEqual(sentView.budget.plan.installments.map((row: { amount: number }) => row.amount), [270000, 200000, 430000]);
    assert.deepEqual(sentView.budget.plan.installments.map((row: { moment: string }) => row.moment), ["Al confirmar", "Antes del montaje", "Después"]);
    assert.ok(sentView.budget.plan.installments.every((row: { accountId: string }) => row.accountId === account.id));
    assert.doesNotMatch(JSON.stringify(sentView.budget), /openingBalance|costPrice|costEstimate/);
    assert.equal((await sign(issued.code)).status, 200);
    const before = await db.signatureRequest.findUniqueOrThrow({ where: { id: issued.id } });
    const oldEvents = await db.signatureEvent.findMany({ where: { requestId: issued.id }, orderBy: { occurredAt: "asc" } });
    const oldPayload = (await (await call(`/api/portal/firma/${issued.code}`)).json()).signature;
    const original = await render(issued.code, "signed-original-before");
    assert.match(original.htmlText, /Frozen fantasy original/); assert.match(original.htmlText, /Frozen legal original/);
    assert.doesNotMatch(original.htmlText, /Not fiscal historical/);
    for (const text of ["Al confirmar", "Antes del montaje", "Después", "270.000", "200.000", "430.000"]) assert.ok(original.htmlText.includes(text), text);
    const calendarOracle = (day: string) => new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${day}T12:00:00Z`));
    for (const row of conditions()) {
      assert.ok(original.htmlText.includes(calendarOracle(row.dueAt)), row.dueAt);
      if (original.pdfText) assert.ok(original.pdfText.includes(calendarOracle(row.dueAt).replace(/\s+/g, "")), row.dueAt);
    }
    assert.ok(original.pdfText?.replace(/\./g, "").includes("05ene2099") ?? original.htmlText.replace(/\./g, "").includes("05 ene 2099"));
    assert.ok(original.pdfText?.replace(/\./g, "").includes("12ene2099") ?? original.htmlText.replace(/\./g, "").includes("12 ene 2099"));

    const drawnQuote = await budget("Drawn calendar boundary document", 900000);
    const boundaryDays = ["2099-01-05", "2099-01-12", "2099-12-31", "2100-01-01", "2096-02-29"];
    const boundaryPlan: Array<{ label: string; type: "fixed"; value: number; dueAt: string | null; moment: string }> = boundaryDays.map((dueAt, index) => ({ label: `Boundary ${index + 1}`, type: "fixed", value: 150000, dueAt, moment: `Calendar moment ${index + 1}` }));
    boundaryPlan.push({ label: "No date honest", type: "fixed", value: 150000, dueAt: null, moment: "A coordinar" });
    assert.equal((await call("/api/admin/budgets", "PATCH", { budgetId: drawnQuote.id, installmentsJson: boundaryPlan }, true)).status, 200);
    const drawn = await issue(drawnQuote.id, undefined, "DRAWN");
    const dataUrl = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 120; const ctx = canvas.getContext("2d")!; ctx.strokeStyle = "#111"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(20, 70); ctx.bezierCurveTo(50, 10, 100, 115, 280, 40); ctx.stroke(); return canvas.toDataURL("image/png"); });
    assert.equal((await call(`/api/portal/firma/${drawn.code}/sign`, "POST", { consent: true, signature: { dataUrl } })).status, 200);
    const drawnBefore = await db.signatureRequest.findUniqueOrThrow({ where: { id: drawn.id } });
    const drawnPayload = (await (await call(`/api/portal/firma/${drawn.code}`)).json()).signature.budget;
    const drawnPDF = await render(drawn.code, "drawn-calendar-before");
    for (const day of boundaryDays) {
      assert.ok(drawnPDF.htmlText.includes(calendarOracle(day)), day);
      if (drawnPDF.pdfText) assert.ok(drawnPDF.pdfText.includes(calendarOracle(day).replace(/\s+/g, "")), day);
    }
    assert.ok(drawnPDF.htmlText.includes("A coordinar"));
    assert.equal(drawnPayload.plan.installments[5].dueAt, null);
    const signedPlanEdit = await call("/api/admin/budgets", "PATCH", { budgetId: q.id, installmentsJson: conditions(40) }, true);
    assert.equal(signedPlanEdit.status, 409, "API preserves signed commercial conditions; direct historical edit below still cannot change snapshot");
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
    const drawnAfter = await render(drawn.code, "drawn-calendar-after");
    assert.deepEqual(drawnAfter, drawnPDF);
    assert.deepEqual(await db.signatureRequest.findUniqueOrThrow({ where: { id: drawn.id } }), drawnBefore);
    assert.deepEqual((await (await call(`/api/portal/firma/${drawn.code}`)).json()).signature.budget, drawnPayload);

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

    const stalePlanQuote = await budget("New stale installment plan", 900000);
    assert.equal((await call("/api/admin/budgets", "PATCH", { budgetId: stalePlanQuote.id, installmentsJson: conditions() }, true)).status, 200);
    const stalePlan = await issue(stalePlanQuote.id);
    assert.equal((await call("/api/admin/budgets", "PATCH", { budgetId: stalePlanQuote.id, installmentsJson: conditions(40) }, true)).status, 200);
    assert.equal((await sign(stalePlan.code)).status, 409, "snapshot rendering must never mask LIVE plan edits");
    assert.equal((await db.signatureRequest.findUniqueOrThrow({ where: { id: stalePlan.id } })).signedDocumentHash, null);

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
    if (output) writeFileSync(join(output, "calendar-oracle.json"), JSON.stringify({ status: "PASS", oracle: "Intl es-PY UTC at noon, independent of production formatter", timezone: "America/Asuncion", typed: { issueStatus: 201, signStatus: 200, expectedDates: conditions().map(row => calendarOracle(row.dueAt)), normalizedPDFText: original.pdfText, immutableText: original.pdfText === after.pdfText }, drawn: { issueStatus: 201, signStatus: 200, expectedDates: boundaryDays.map(calendarOracle), nullDueAt: drawnPayload.plan.installments[5].dueAt, normalizedPDFText: drawnPDF.pdfText, immutableText: drawnPDF.pdfText === drawnAfter.pdfText } }, null, 2));
    if (output) writeFileSync(join(output, "snapshot-result.json"), JSON.stringify({ status: "PASS", requestId: issued.id, documentHash: before.documentHash, signedDocumentHash: before.signedDocumentHash, payloadBefore: oldPayload, payloadAfter: fresh, normalizedPDFTextEqual: original.pdfText ? original.pdfText === after.pdfText : null, realPlanPatch200Issue201Sign200: true, planAmounts: [270000, 200000, 430000], planMomentDatePDFParity: true, stalePlan409: true, legacyIntactSigns: true, legacyChanged409: true, liveCommercialStale409: true, attachmentBytesVerified: true, chainValid: true }, null, 2));
  } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
