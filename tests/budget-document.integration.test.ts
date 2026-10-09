import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";

const base = process.env.QUOTE_TEST_BASE_URL;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = process.env.QUOTE_EVIDENCE_DIR ?? "/private/var/folders/jt/v4h3s4hs3wxf82mqzn6qtgg80000gn/T/opencode/ledbox-budget-document";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("FIN #173 real portal and multi-page A4: commercial/legal identity, item hierarchy and private costs", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(), suffix = randomUUID(), org = `fin-doc-${suffix}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  mkdirSync(evidence, { recursive: true });
  try {
    const { generatePublicToken } = await import("../lib/server/budget-portal");
    await db.organization.create({ data: { id: org, slug: org, name: "QA issuer" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Historical identity", company: "Never infer fiscal", tradeName: "QA commercial", legalName: "QA legal SA", ruc: "80012345-6" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "QA long proposal", status: "SENT", publicToken: generatePublicToken(), publicTokenCreatedAt: new Date(), subtotal: 80000, total: 80000, materialCost: 777, paymentTerms: "Transferencia según hitos acordados", installmentsJson: [{ label: "Reserva", type: "fixed", value: 20000, amount: 20000, dueAt: null, moment: "Al confirmar" }, { label: "Saldo", type: "remainder", value: 0, amount: 60000, dueAt: null, moment: "Antes del montaje" }], items: { create: Array.from({ length: 40 }, (_, index) => ({ id: randomUUID(), name: `${String(index).padStart(2, "0")} QA ${index === 1 ? "Rental" : "Service"}`, quantity: 1, days: index === 1 ? 2 : 1, unitPrice: index === 1 ? 1000 : 2000, subtotal: 2000, costPrice: 777, notes: "Descripción extensa conservada para el documento con detalle adicional del servicio." })) } }, include: { items: true } });
    const response = await fetch(`${base}/api/portal/budget/${budget.publicToken}`);
    assert.equal(response.status, 200);
    const serialized = await response.text();
    assert.doesNotMatch(serialized, /"(?:costPrice|materialCost|laborCost|costEstimate)"/);
    assert.match(serialized, /QA commercial/); assert.match(serialized, /QA legal SA/);
    const page = await browser.newPage();
    await page.goto(`${base}/p/${budget.publicToken}`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".portal-table--items");
    for (const width of [1470, 390, 360]) {
      await page.setViewport({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `portal ${width} without page overflow`);
      assert.equal(await page.$eval(".portal-table--items tbody tr:first-child", (node) => node.textContent?.includes("Días")), false, "free services hide days");
      assert.ok(await page.$(".portal-table--items details"), "description is collapsible");
      await page.screenshot({ path: `${evidence}/portal-${width}.png`, fullPage: true });
    }
    const { createSession } = await import("../lib/server/auth");
    await page.setCookie({ name: "ledbox_session", value: (await createSession(user, org)).jwt, url: base!, httpOnly: true });
    await page.setViewport({ width: 1000, height: 1000 });
    await page.goto(`${base}/imprimir/presupuesto/${budget.id}`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".budget-print-sheet");
    const text = await page.$eval(".budget-print-sheet", (node) => node.textContent ?? "");
    assert.match(text, /QA commercial/); assert.match(text, /QA legal SA/); assert.match(text, /80012345-6/);
    assert.match(text, /Antes del montaje/); assert.doesNotMatch(text, /Costo interno|Never infer fiscal/);
    await page.screenshot({ path: `${evidence}/print-preview.png`, fullPage: true });
    const bytes = await page.pdf({ path: `${evidence}/quote-long-a4.pdf`, format: "A4", printBackground: true });
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 2, "long document spans multiple pages");
    for (const p of pdf.getPages()) { assert.ok(Math.abs(p.getWidth() - 595.28) < 2); assert.ok(Math.abs(p.getHeight() - 841.89) < 2); }
    console.log(`Portal desktop/390/360 passed; A4 ${pdf.getPageCount()} pages; identity/moments match and costs omitted`);
  } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
