import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import puppeteer from "puppeteer-core";
const base = process.env.QUOTE_TEST_BASE_URL;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("comparison browser: optional admin creation/copy/view, public resources, mobile exclusive choice", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(); const suffix = randomUUID(); const org = `cmp-ui-${suffix}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    await db.organization.create({ data: { id: org, slug: org, name: "Comparison browser QA" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId: org, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "QA comparison client" } });
    const product = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "QA photo", category: "QA", imageData: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=", "base64"), imageMime: "image/png" } });
    const quotes = [];
    for (let i = 0; i < 5; i++) quotes.push(await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: `QA option ${i + 1}`, subtotal: 1000 + i * 500, total: 1000 + i * 500, paymentTerms: "QA payment conditions", warranty: "QA warranty", items: { create: { id: randomUUID(), name: `QA item ${i + 1}`, inventoryId: product.id, unitPrice: 1000 + i * 500, subtotal: 1000 + i * 500, costPrice: 123 } } } }));
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
    for (const visible of [true, false]) await db.budgetAttachment.create({ data: { id: randomUUID(), organizationId: org, budgetId: quotes[0].id, uploadedByName: "QA", name: visible ? "Public PDF.pdf" : "Private original.pdf", mime: "application/pdf", size: bytes.length, data: bytes, clientVisible: visible } });
    await db.budgetReferenceLink.create({ data: { id: randomUUID(), organizationId: org, budgetId: quotes[0].id, label: "Public reference", url: "https://example.invalid/reference", clientVisible: true } });
    const { createSession } = await import("../lib/server/auth");
    const page = await browser.newPage();
    await page.setViewport({ width: 1470, height: 900 });
    await page.setCookie({ name: "ledbox_session", value: (await createSession(user, org)).jwt, url: base!, httpOnly: true });
    await page.goto(base + "/presupuestos", { waitUntil: "networkidle0" });
    console.log("Comparison UI: loaded admin");
    async function clickText(text: string) {
      const buttons = await page.$$("button");
      for (const button of buttons) if ((await button.evaluate((node) => node.textContent?.trim())) === text) { await button.click(); return; }
      throw Error("Missing button " + text);
    }
    async function field(label: string) {
      const id = await page.evaluate((text) => [...document.querySelectorAll("label")].find((node) => node.textContent?.trim() === text)?.htmlFor, label);
      assert.ok(id); return '[id="' + id + '"]';
    }
    await clickText("Comparar alternativas"); await page.waitForSelector(".admin-dialog");
    await page.type(await field("Nombre de la comparación"), "QA comparison created in browser");
    for (const quote of quotes) await page.click(await field("Incluir " + quote.title));
    console.log("Comparison UI: creating");
    await clickText("Crear comparación");
    await page.waitForFunction(() => document.body.textContent?.includes("Comparación creada."));
    const group = await db.quoteComparison.findFirstOrThrow({ where: { organizationId: org } });
    await browser.defaultBrowserContext().overridePermissions(base!, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Copiar enlace de comparación"));
    await page.bringToFront();
    console.log("Comparison UI: copying", await page.evaluate(() => ({ focus: document.hasFocus(), secure: isSecureContext })));
    await clickText("Copiar enlace de comparación");
    await page.waitForFunction(() => document.body.textContent?.includes("Enlace copiado.") || document.body.textContent?.includes("No pudimos copiar"), { timeout: 5000 }).catch(async (error) => { console.log(await page.$eval(".admin-dialog", (node) => node.textContent)); await page.screenshot({ path: "/tmp/ledbox-quote-qa/comparison-copy.png" }); throw error; });
    assert.ok((await page.$eval(".admin-dialog", (node) => node.textContent))?.includes("Enlace copiado."));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}/comparar/${group.publicToken}`);
    console.log("Comparison UI: opening");
    const popupPromise = browser.waitForTarget((target) => target.url().includes("/comparar/" + group.publicToken));
    await clickText("Ver comparación como cliente");
    const publicPage = (await (await popupPromise).page())!;
    await publicPage.waitForSelector(".portal-comparison-option");
    console.log("Comparison UI: public page loaded");
    assert.equal(await publicPage.$$eval(".portal-comparison-option", (nodes) => nodes.length), 5);
    assert.equal(await publicPage.$$eval(".portal-comparison-selector-option", (nodes) => nodes.length), 5);
    assert.deepEqual(await publicPage.$$eval(".portal-comparison-selector-option strong", (nodes) => nodes.map((node) => node.textContent)), ["A", "B", "C", "D", "E"]);
    const text = await publicPage.$eval(".portal-comparison", (node) => node.textContent);
    assert.ok(text?.includes("QA warranty") && text.includes("QA payment conditions") && text.includes("Public PDF.pdf") && !text.includes("Private original.pdf"));
    const image = await publicPage.waitForSelector('.portal-comparison-items img');
    assert.ok(image); await publicPage.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".portal-comparison-items img")].every((img) => img.complete && img.naturalWidth > 0));
    const pdfLink = await publicPage.$eval('a[href*="/pdf/"]', (node) => (node as HTMLAnchorElement).href);
    assert.equal((await fetch(pdfLink)).status, 200);
    let approvalRequests = 0;
    publicPage.on("request", (request) => { if (request.url().endsWith("/approve")) approvalRequests++; });
    await publicPage.setViewport({ width: 390, height: 844 });
    assert.equal(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await publicPage.$eval(".portal-comparison-option:nth-child(5)", (node) => node.scrollIntoView());
    const selectorBox = await publicPage.$eval(".portal-comparison-selector", (node) => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
    assert.ok(selectorBox.top < 844 && selectorBox.bottom > 0, "selector remains visible in the mobile viewport");
    await publicPage.click('.portal-comparison-selector-option:nth-child(5) input[type="radio"]');
    assert.equal(approvalRequests, 0, "selection sends no approval request");
    assert.equal(await db.budget.count({ where: { comparisonId: group.id, approvedAt: { not: null } } }), 0, "choosing an option does not approve or charge it");
    await publicPage.type('input[autocomplete="name"]', "QA client");
    await publicPage.click('input[type="checkbox"]');
    await publicPage.click('button.portal-btn');
    await publicPage.waitForFunction(() => document.body.textContent?.includes("La elección quedó registrada"));
    assert.equal(approvalRequests, 1, "approval is sent only after explicit confirmation");
    assert.equal(await publicPage.$('input[type="radio"]'), null);
    assert.equal(await db.budget.count({ where: { comparisonId: group.id, approvedAt: { not: null } } }), 1);
    await publicPage.reload({ waitUntil: "networkidle0" });
    assert.ok((await publicPage.$eval(".portal-comparison", (node) => node.textContent))?.includes("Alternativa elegida"));
  } catch (error) { console.error(error); throw error; } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
