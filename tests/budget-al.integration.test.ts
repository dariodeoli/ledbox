import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.QUOTE_TEST_BASE_URL;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = process.env.QUOTE_EVIDENCE_DIR;
const enabled = Boolean(base && evidence && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("AL real HTTP/PG/browser: tariff days, discounts once, advance, persistence, floor and ledger guards", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(), suffix = randomUUID(), org = `fin-al-${suffix}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  mkdirSync(evidence!, { recursive: true });
  try {
    const { createSession } = await import("../lib/server/auth");
    const { generatePublicToken } = await import("../lib/server/budget-portal");
    await db.organization.create({ data: { id: org, slug: org, name: "AL local issuer" } });
    const owner = await db.adminUser.create({ data: { id: randomUUID(), name: "AL owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: owner.id, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "AL client" } });
    const product = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "AL rental", category: "QA", listPrice: 100001, listFromDays: 3, listFromPrice: 80001, wholesalePrice: 70001, wholesaleFromDays: 5, wholesaleFromPrice: 60001, minimumPrice: 50000, dailyCost: 321 } });
    const cookie = `ledbox_session=${(await createSession(owner, org)).jwt}`;
    const call = (path: string, method: string, body: unknown, session = cookie) => fetch(base + path, { method, headers: { "Content-Type": "application/json", Cookie: session, "X-Forwarded-For": `al-${suffix}` }, body: JSON.stringify(body) });
    const rawLine = { name: product.name, inventoryId: product.id, quantity: 2, days: 3, unitPrice: 1, costPrice: 321, priceMode: "TARIFF", tariffSnapshot: { version: 1, front: "FINAL", normalPrice: 1, fromDays: 0, fromPrice: 0, minimumPrice: 0 }, discountMode: "PERCENT", discountValue: 1000 };
    const create = async (patch: Record<string, unknown> = {}) => {
      const response = await call("/api/admin/budgets", "POST", { clientId: client.id, title: "AL negotiated", items: [rawLine], discountMode: "PERCENT", discountValue: 500, advancePercentBps: 3000, ...patch });
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json()).budget;
    };
    const q = await create();
    const snapshot = () => db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true, payments: true, expectedPayments: true } });
    const values = async () => { const row = await snapshot(); return [row.items[0].unitPrice, row.subtotal, row.discount, row.total, row.advanceAmount]; };
    assert.deepEqual(await values(), [80001, 432005, 21600, 410405, 123122]);
    assert.equal(q.items[0].tariffSnapshot.minimumPrice, 50000, "snapshot comes from same-org inventory, not caller price");
    const token = generatePublicToken();
    await db.budget.update({ where: { id: q.id }, data: { status: "SENT", publicToken: token, publicTokenCreatedAt: new Date() } });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${base}/p/${token}`, { waitUntil: "networkidle0" });
      await page.waitForSelector('input[aria-label^="Días de AL rental"]');
      assert.match(await page.$eval("body", (node) => node.textContent ?? ""), /410\.405/);
      await page.click('button[aria-label="Restar uno a Días de AL rental"]');
      const preview = await page.$eval("body", (node) => node.textContent ?? "");
      for (const value of ["100.001", "360.004", "18.000", "342.004", "102.601"]) assert.ok(preview.includes(value), `${width} preview has ${value}`);
      await page.screenshot({ path: `${evidence}/portal-days-${width}.png`, fullPage: true });
    }
    const original = await snapshot();
    const proposal = await call(`/api/portal/budget/${token}/propose`, "POST", { kind: "items", name: "AL client", note: "Change to two days", items: [{ id: q.items[0].id, quantity: 2, days: 2, excluded: false }] }, "");
    assert.equal(proposal.status, 200, await proposal.clone().text());
    assert.deepEqual(await snapshot(), original);
    const request = await db.budgetChangeRequest.findFirstOrThrow({ where: { budgetId: q.id, status: "pending" } });
    assert.equal((await call("/api/admin/budgets/requests", "POST", { requestId: request.id, decision: "accept" })).status, 200);
    assert.deepEqual(await values(), [100001, 360004, 18000, 342004, 102601]);
    await db.inventoryItem.update({ where: { id: product.id }, data: { listPrice: 777777, listFromPrice: 666666 } });
    for (const days of [3, 2, 3]) {
      const saved = await snapshot();
      const row = saved.items[0];
      const response = await call("/api/admin/budgets", "PATCH", { kind: "editor", budgetId: q.id, items: [{ id: row.id, name: row.name, inventoryId: row.inventoryId, quantity: row.quantity, days, unitPrice: row.unitPrice, costPrice: row.costPrice, priceMode: row.priceMode, tariffSnapshot: row.tariffSnapshot }] });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await values(), days === 3 ? [80001, 432005, 21600, 410405, 123122] : [100001, 360004, 18000, 342004, 102601]);
    }
    const beforeBad = await snapshot();
    for (const patch of [{ discountMode: "PERCENT", discountValue: 9000 }, { discountMode: "AMOUNT", discountValue: 999999 }, { discountMode: "PERCENT", discountValue: 500.5 }]) {
      const response = await call("/api/admin/budgets", "PATCH", { kind: "commercial", budgetId: q.id, ...patch });
      assert.equal(response.status, 400, await response.clone().text());
      assert.deepEqual(await snapshot(), beforeBad);
    }
    const viewer = await db.adminUser.create({ data: { id: randomUUID(), name: "AL viewer", email: `viewer-${suffix}@example.invalid`, role: "VIEWER", passwordHash: "not-a-login" } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: viewer.id, role: "VIEWER" } });
    assert.equal((await call("/api/admin/budgets", "PATCH", { kind: "commercial", budgetId: q.id, discountMode: "AMOUNT", discountValue: 0 }, `ledbox_session=${(await createSession(viewer, org)).jwt}`)).status, 403);
    const other = `other-${suffix}`;
    await db.organization.create({ data: { id: other, slug: other, name: "Other company" } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: other, adminUserId: owner.id, role: "OWNER" } });
    assert.equal((await call("/api/admin/budgets", "PATCH", { kind: "commercial", budgetId: q.id, discountMode: "AMOUNT", discountValue: 0 }, `ledbox_session=${(await createSession(owner, other)).jwt}`)).status, 404);
    const publicPayload = await (await fetch(`${base}/api/portal/budget/${token}`)).json();
    const serialized = JSON.stringify(publicPayload);
    for (const forbidden of ["dailyCost", "costPrice", "wholesalePrice", "replacementCost", "materialCost", "laborCost"]) assert.ok(!serialized.includes(forbidden));
    await page.setCookie({ name: "ledbox_session", value: cookie.slice("ledbox_session=".length), url: base!, httpOnly: true });
    await page.goto(`${base}/imprimir/presupuesto/${q.id}`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".budget-print-sheet");
    const print = await page.$eval(".budget-print-sheet", (node) => node.textContent ?? "");
    for (const value of ["Descuento de línea", "Descuento global", "432.005", "21600", "410.405", "123.122"]) assert.ok(print.replace(/21\.600/g, "21600").includes(value), `print ${value}`);
    await page.pdf({ path: `${evidence}/commercial-a4.pdf`, format: "A4", printBackground: true });
    await page.screenshot({ path: `${evidence}/commercial-print.png`, fullPage: true });
    const clickText = async (text: string) => {
      const handle = await page.evaluateHandle((value) => [...document.querySelectorAll<HTMLButtonElement>(".admin-dialog button")].find((button) => button.textContent?.trim() === value), text);
      const element = handle.asElement() as import("puppeteer-core").ElementHandle<Element> | null; assert.ok(element); await element.click(); await handle.dispose();
    };
    await page.setViewport({ width: 1280, height: 900 });
    for (const days of [2, 3]) {
      await page.goto(`${base}/presupuestos?vista=list`, { waitUntil: "networkidle0" });
      await page.waitForSelector('button[aria-label="Lista"]'); await page.click('button[aria-label="Lista"]');
      await page.waitForSelector('button[aria-label="Editar presupuesto: AL negotiated"]');
      await page.click('button[aria-label="Editar presupuesto: AL negotiated"]');
      await page.waitForSelector(".admin-dialog");
      const field = await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".admin-dialog label")].find((node) => node.textContent?.trim() === "Días")?.htmlFor);
      assert.ok(field);
      const input = await page.$(`[id="${field}"]`); assert.ok(input);
      await input.click({ count: 3 }); await input.press("Backspace"); await input.type(String(days));
      await page.screenshot({ path: `${evidence}/editor-days-${days}.png`, fullPage: true });
      await clickText("Guardar");
      await page.waitForFunction(() => !document.querySelector(".admin-dialog"));
      assert.deepEqual(await values(), days === 3 ? [80001, 432005, 21600, 410405, 123122] : [100001, 360004, 18000, 342004, 102601]);
    }
    for (const [percent, bps, total, advance] of [["5,25", 525, 409325, 122798], ["5", 500, 410405, 123122]] as const) {
      await page.goto(`${base}/presupuestos?vista=list`, { waitUntil: "networkidle0" });
      await page.waitForSelector('button[aria-label="Editar presupuesto: AL negotiated"]'); await page.click('button[aria-label="Editar presupuesto: AL negotiated"]');
      const field = await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".admin-dialog label")].find((node) => node.textContent?.trim() === "Descuento global (%)")?.htmlFor);
      assert.ok(field);
      const input = await page.$(`[id="${field}"]`); assert.ok(input);
      await input.click({ count: 3 }); await input.press("Backspace"); await input.type(percent);
      await clickText("Guardar"); await page.waitForFunction(() => !document.querySelector(".admin-dialog"));
      const persisted = await snapshot();
      assert.equal(persisted.discountValue, bps); assert.equal(persisted.total, total); assert.equal(persisted.advanceAmount, advance);
    }
    const manualSource = (await snapshot()).items[0];
    const manualPatch = (patch: Record<string, unknown>) => call("/api/admin/budgets", "PATCH", { kind: "editor", budgetId: q.id, items: [{ id: manualSource.id, name: manualSource.name, quantity: 2, days: 3, unitPrice: 80001, costPrice: manualSource.costPrice, priceMode: "MANUAL", ...patch }] });
    assert.equal((await manualPatch({})).status, 200);
    const retained = await snapshot();
    assert.deepEqual(retained.items[0].tariffSnapshot, manualSource.tariffSnapshot);
    assert.equal((await manualPatch({ unitPrice: 40000 })).status, 400);
    assert.equal((await manualPatch({ tariffSnapshot: null })).status, 400);
    assert.deepEqual(await snapshot(), retained);
    const manualPublic = await (await fetch(`${base}/api/portal/budget/${token}`)).json();
    assert.equal(manualPublic.budget.items[0].commercialTerms.tariffSnapshot, null);
    assert.equal(manualPublic.budget.items[0].commercialTerms.minimumPrice, 50000);
    assert.equal((await call("/api/admin/budgets", "PATCH", { budgetId: q.id, advancePercentBps: null, advanceAmount: 100000 })).status, 200);
    assert.equal((await snapshot()).advanceAmount, 100000);
    assert.equal((await snapshot()).advancePercentBps, null);
    assert.equal((await call("/api/admin/budgets", "PATCH", { budgetId: q.id, advancePercentBps: 3000 })).status, 200);
    const wholesale = await create({ items: [{ ...rawLine, tariffSnapshot: { ...rawLine.tariffSnapshot, front: "WHOLESALE" }, discountMode: null, discountValue: null }], discountMode: "AMOUNT", discountValue: 0, advancePercentBps: 2000 });
    assert.equal(wholesale.items[0].unitPrice, 70001);
    for (const days of [5, 3]) {
      assert.equal((await call("/api/admin/budgets", "PATCH", { kind: "items", budgetId: wholesale.id, items: [{ id: wholesale.items[0].id, name: product.name, quantity: 2, days, unitPrice: 1 }] })).status, 200);
      const persisted = await db.budget.findUniqueOrThrow({ where: { id: wholesale.id }, include: { items: true } });
      assert.equal(persisted.items[0].unitPrice, days === 5 ? 60001 : 70001);
      assert.equal((persisted.items[0].tariffSnapshot as { front: string }).front, "WHOLESALE");
    }
    const saved = await snapshot();
    await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: q.id, concept: "advance", slot: "advance", label: "Seña", amount: saved.advanceAmount, paidAmount: 10000, status: "PARTIAL" } });
    await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, budgetId: q.id, amount: 10000, status: "RECEIVED", method: "Efectivo" } });
    const protectedSnapshot = await snapshot();
    const row = protectedSnapshot.items[0];
    assert.equal((await call("/api/admin/budgets", "PATCH", { kind: "editor", budgetId: q.id, items: [{ id: row.id, name: row.name, quantity: row.quantity, days: 2, unitPrice: row.unitPrice, costPrice: row.costPrice }] })).status, 409);
    assert.deepEqual(await snapshot(), protectedSnapshot, "received cash/ledger cannot be rewritten to fit the advance");
    const signatureResponse = await call("/api/admin/signatures", "POST", { budgetId: q.id, recipientName: "AL signer", method: "TYPED", otpRequired: false });
    assert.equal(signatureResponse.status, 201, await signatureResponse.clone().text());
    const signature = (await signatureResponse.json()).request;
    const signed = await call(`/api/portal/firma/${signature.code}/sign`, "POST", { consent: true, signature: { name: "AL signer" } }, "");
    assert.equal(signed.status, 200, await signed.clone().text());
    const signedView = (await (await fetch(`${base}/api/portal/firma/${signature.code}`)).json()).signature;
    assert.equal(signedView.budget.documentVersion, 3);
    assert.equal(signedView.budget.commercialTerms.advancePercentBps, 3000);
    assert.equal(signedView.budget.items[0].commercialTerms.discountAmount, 48001);
    await page.goto(`${base}/firma/${signature.code}/documento`, { waitUntil: "networkidle0" });
    const signedText = await page.$eval(".portal-signature-print", (node) => node.textContent ?? "");
    for (const value of ["410.405", "123.122", "Descuento de línea", "Descuento global"]) assert.ok(signedText.includes(value));
    await page.pdf({ path: `${evidence}/signed-commercial-v3.pdf`, format: "A4", printBackground: true });
    const frozen = await db.signatureEvent.findFirstOrThrow({ where: { requestId: signature.id, eventType: "REQUEST_CREATED" } });
    const beforeSignedEdit = await snapshot();
    assert.equal((await call("/api/admin/budgets", "PATCH", { kind: "commercial", budgetId: q.id, discountMode: "AMOUNT", discountValue: 0 })).status, 409);
    assert.deepEqual(await snapshot(), beforeSignedEdit);
    assert.deepEqual(await db.signatureEvent.findUniqueOrThrow({ where: { id: frozen.id } }), frozen);
    await db.budget.update({ where: { id: q.id }, data: { approvedAt: new Date(), status: "APPROVED" } });
    const approvedSnapshot = await snapshot();
    assert.equal((await call("/api/admin/budgets", "PATCH", { kind: "commercial", budgetId: q.id, advancePercentBps: 1000 })).status, 409);
    assert.deepEqual(await snapshot(), approvedSnapshot);
    assert.deepEqual(errors, []);
    console.log("AL HTTP/PG/browser: FINAL2→3 tariff persisted, line10/global5 once, advance30 on final, no live snapshot reinterpretation, floor atomic400, RBAC403/crossorg404, print/privacy and ledger/signed guards409");
  } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
