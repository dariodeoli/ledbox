import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.QUOTE_TEST_BASE_URL;
const output = process.env.QUOTE_EVIDENCE_DIR;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const enabled = Boolean(base && output && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("FIN-PRINT-01 actual HTTP/PG/A4: decimal BPS line/global at 390/1280 without monetary mutation", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  mkdirSync(output!, { recursive: true });
  const results: unknown[] = [];
  try {
    const { createSession } = await import("../lib/server/auth");
    const suffix = randomUUID(), org = `fin-print-${suffix}`;
    await db.organization.create({ data: { id: org, slug: org, name: "FIN local print" } });
    const owner = await db.adminUser.create({ data: { id: randomUUID(), name: "Print owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: owner.id, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Print decimal client" } });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // Compiled production routing needs the panel host while every request stays local.
    await page.setExtraHTTPHeaders({ "x-forwarded-host": "app.ledbox.online" });
    const denied: string[] = [];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (["data:", "blob:", "about:"].includes(url.protocol) || url.origin === base) void request.continue();
      else { denied.push(url.origin); void request.abort(); }
    });
    await page.setCookie({ name: "ledbox_session", value: (await createSession(owner, org)).jwt, url: base!, httpOnly: true });
    // Independent fixture arithmetic: quotient/remainder half-up, no commercial helper/formatter oracle.
    const percent = (amount: number, bps: number) => {
      const product = BigInt(amount) * BigInt(bps), divisor = BigInt(10000);
      return Number(product / divisor + (product % divisor * BigInt(2) >= divisor ? BigInt(1) : BigInt(0)));
    };
    const vectors = [
      { name: "reported-global525", gross: 480006, lineBps: 1000, lineLabel: "10", globalBps: 525, globalLabel: "5,25", total: 409325, advance: 122798 },
      { name: "decimal-line525-global1250", gross: 100001, lineBps: 525, lineLabel: "5,25", globalBps: 1250, globalLabel: "12,5" },
      { name: "intmax-line1-global1", gross: 2147483647, lineBps: 1, lineLabel: "0,01", globalBps: 1, globalLabel: "0,01" },
      { name: "two-decimals9999", gross: 2147483647, lineBps: 9999, lineLabel: "99,99", globalBps: 525, globalLabel: "5,25" },
      { name: "global100", gross: 100001, lineBps: 1250, lineLabel: "12,5", globalBps: 10000, globalLabel: "100" },
    ];
    for (const vector of vectors) {
      const lineDiscount = percent(vector.gross, vector.lineBps), subtotal = vector.gross - lineDiscount;
      const discount = percent(subtotal, vector.globalBps), total = subtotal - discount, advanceAmount = percent(total, 3000);
      if (vector.total !== undefined) assert.equal(total, vector.total);
      if (vector.advance !== undefined) assert.equal(advanceAmount, vector.advance);
      const budget = await db.budget.create({ data: {
        id: randomUUID(), organizationId: org, clientId: client.id, title: vector.name, subtotal, discount, total, advanceAmount,
        discountMode: "PERCENT", discountValue: vector.globalBps, advancePercentBps: 3000,
        items: { create: { id: randomUUID(), name: "Printed decimal line", quantity: 1, days: 1, unitPrice: vector.gross, subtotal, discountMode: "PERCENT", discountValue: vector.lineBps, discountAmount: lineDiscount } },
      } });
      const persisted = () => db.budget.findUniqueOrThrow({ where: { id: budget.id }, include: { items: true, payments: true, expectedPayments: true } });
      const before = await persisted();
      for (const width of [390, 1280]) {
        await page.setViewport({ width, height: 900 });
        const response = await page.goto(`${base}/imprimir/presupuesto/${budget.id}`, { waitUntil: "networkidle0" });
        assert.equal(response?.status(), 200);
        await page.waitForSelector(".budget-print-sheet");
        const text = await page.$eval(".budget-print-sheet", (node) => node.textContent ?? "");
        assert.ok(text.includes(`(${vector.lineLabel} %)`), `${vector.name}/${width}: exact line percentage`);
        assert.ok(text.includes(`Descuento global (${vector.globalLabel} %)`), `${vector.name}/${width}: exact global percentage`);
        // Money remains integer es-PY; decimal percentage formatting must not affect amounts.
        for (const amount of [subtotal, discount, total, advanceAmount]) {
          const money = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(amount);
          assert.ok(text.includes(money), `${vector.name}/${width}: persisted integer ${amount}`);
        }
        await page.emulateMediaType("print");
        const geometry = await page.$eval(".budget-print-item", (node) => {
          const note = [...node.querySelectorAll("small")].find((small) => small.textContent?.includes("Descuento de línea"));
          return { complete: Boolean(note && note.getBoundingClientRect().right <= node.getBoundingClientRect().right + 1), text: note?.textContent };
        });
        assert.equal(geometry.complete, true, "line discount stays complete inside the identity column");
        const pdf = await page.pdf({ path: `${output}/${vector.name}-${width}.pdf`, format: "A4", printBackground: true });
        // Chromium generated PDF structural page count (native visual reading remains separate evidence).
        const pageCount = [...Buffer.from(pdf).toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length;
        assert.equal(pageCount, 1, "full A4 fixture remains one complete page");
        await page.screenshot({ path: `${output}/${vector.name}-${width}.png`, fullPage: true });
        await page.emulateMediaType("screen");
        assert.deepEqual(await persisted(), before, "print is readonly, including payment ledger and Int amounts");
        results.push({ name: vector.name, width, lineBps: vector.lineBps, globalBps: vector.globalBps, lineLabel: vector.lineLabel, globalLabel: vector.globalLabel, subtotal, discount, total, advanceAmount, pageCount, geometry, unchanged: true });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(denied, [], "no production or external-provider requests");
    writeFileSync(`${output}/results.json`, JSON.stringify({ sha: process.env.QUOTE_CANDIDATE_SHA, cases: results, browserErrors: errors }, null, 2));
  } finally {
    await browser.close();
    await db.$disconnect();
    await (await import("../lib/server/db")).db.$disconnect();
  }
});
