import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.QUOTE_TEST_BASE_URL;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = process.env.QUOTE_EVIDENCE_DIR ?? "/private/var/folders/jt/v4h3s4hs3wxf82mqzn6qtgg80000gn/T/opencode/ev-d03";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("EV-D03 API/browser: complete, partial, no receipt, installments, proofs and VIEWER without collection mutations", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(), suffix = randomUUID(), org = `ev-d03-${suffix}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  mkdirSync(evidence, { recursive: true });
  try {
    const { createSession } = await import("../lib/server/auth");
    const { generatePublicToken } = await import("../lib/server/budget-portal");
    await db.organization.create({ data: { id: org, name: "EV-D03 isolated QA", slug: org } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role: "OWNER" } });
    const viewer = await db.adminUser.create({ data: { id: randomUUID(), name: "QA viewer", email: `viewer-${suffix}@example.invalid`, role: "VIEWER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: viewer.id, role: "VIEWER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Historical client", tradeName: "  QA client  ", legalName: "QA Legal" } });
    const logoPage = await browser.newPage();
    const logoData = await logoPage.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 80;
      const ctx = canvas.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0, 0, 200, 80);
      ctx.fillStyle = "black"; ctx.font = "bold 60px sans-serif"; ctx.fillText("QA", 50, 62);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await logoPage.close();
    const logoBytes = Buffer.from(logoData, "base64");
    await db.clientLogo.create({ data: { id: randomUUID(), clientId: client.id, mime: "image/png", size: logoBytes.length, data: logoBytes } });
    const cases = [
      { name: "Complete", collected: 12500000, advance: 4000000, label: "Cobro completo", status: "AWAITING", concept: "advance", amount: 4000000, paidAmount: 0 },
      { name: "Partial", collected: 2000000, advance: 4000000, label: "Cobrar anticipo", status: "PARTIAL", concept: "advance", amount: 4000000, paidAmount: 2000000 },
      { name: "No receipt", collected: 0, advance: 4000000, label: "Cobrar anticipo", status: "AWAITING", concept: "advance", amount: 4000000, paidAmount: 0 },
      { name: "Installment", collected: 4000000, advance: 4000000, label: "Cobrar Cuota 2", status: "AWAITING", concept: "installment", amount: 5000000, paidAmount: 0 },
      { name: "Proof review", collected: 0, advance: 4000000, label: "Revisar comprobante", status: "PROOF", concept: "advance", amount: 4000000, paidAmount: 0 },
      { name: "No plan", collected: 0, advance: 0, label: "Cobrar pago", status: "", concept: "", amount: 0, paidAmount: 0 },
    ];
    const rows = [];
    for (const c of cases) {
      const q = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: `EV-D03 ${c.name}`, status: "APPROVED", approvedAt: new Date(), total: 12500000, subtotal: 12500000, advanceAmount: c.advance, publicToken: generatePublicToken(), items: { create: { id: randomUUID(), name: "Service", quantity: 1, days: 1, unitPrice: 12500000, subtotal: 12500000 } } } });
      if (c.collected) await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, budgetId: q.id, amount: c.collected, status: "RECEIVED" } });
      // A pending entry must never be counted as received.
      await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, budgetId: q.id, amount: 1, status: "PENDING" } });
      if (c.status) await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: q.id, concept: c.concept as "advance" | "installment", slot: `${c.concept}:1`, label: c.concept === "installment" ? "Cuota 2" : "Anticipo", amount: c.amount, paidAmount: c.paidAmount, status: c.status as "AWAITING" | "PARTIAL" | "PROOF", installmentNumber: 1 } });
      rows.push({ ...q, scenario: c });
    }
    const snapshot = async () => ({ budgets: await db.budget.findMany({ where: { organizationId: org }, select: { id: true, status: true, total: true, subtotal: true, advanceAmount: true, installmentsJson: true }, orderBy: { id: "asc" } }), payments: await db.clientPayment.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }), ledger: await db.expectedPayment.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }) });
    const before = await snapshot();
    const jwt = (await createSession(user, org)).jwt;
    const response = await fetch(`${base}/api/admin/budgets`, { headers: { Cookie: `ledbox_session=${jwt}` } });
    assert.equal(response.status, 200);
    const budgets = (await response.json()).budgets;
    for (const q of rows) {
      const b = budgets.find((b: { id: string }) => b.id === q.id);
      assert.equal(b.payments.filter((p: { status: string }) => p.status === "RECEIVED").reduce((sum: number, p: { amount: number }) => sum + p.amount, 0), q.scenario.collected);
      if (q.scenario.status) assert.equal(b.expectedPayments[0].status, q.scenario.status);
      const publicResponse = await fetch(`${base}/api/portal/budget/${q.publicToken}`);
      assert.equal(publicResponse.status, 200);
      const portalBudget = (await publicResponse.json()).budget;
      assert.equal(portalBudget.collectedAmount, q.scenario.collected);
      assert.ok(portalBudget.client.logoUrl.startsWith(`/api/portal/budget/${q.publicToken}/client-logo`));
      assert.ok(!portalBudget.client.logoUrl.includes("/api/admin/"));
      const logoResponse = await fetch(base + portalBudget.client.logoUrl);
      assert.equal(logoResponse.status, 200); assert.equal(logoResponse.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await logoResponse.arrayBuffer()), logoBytes);
    }
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.setCookie({ name: "ledbox_session", value: jwt, url: base!, httpOnly: true });
    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${base}/presupuestos?vista=list`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => document.body.textContent?.includes("EV-D03 Complete"));
      for (const q of rows) {
        const text = await page.evaluate((title) => {
          const node = [...document.querySelectorAll('.admin-table-row, .admin-cards-item')].find((node) => node.textContent?.includes(title));
          return node?.textContent ?? "";
        }, q.title);
        assert.ok(text.includes(q.scenario.label), `${width} ${q.title}: ${text}`);
      }
      assert.ok(await page.$('.admin-avatar--logo img[src*="/api/admin/clients/"]'));
      assert.equal(await page.$eval('.admin-avatar--logo img', (node) => getComputedStyle(node).objectFit), "contain");
      assert.deepEqual(await page.$eval('.admin-avatar--logo img', (node) => ({ width: (node as HTMLImageElement).naturalWidth, height: (node as HTMLImageElement).naturalHeight })), { width: 200, height: 80 });
      assert.equal(await page.$eval('.admin-avatar--logo img', (node) => node.getAttribute("alt")), "");
      await page.screenshot({ path: `${evidence}/admin-${width}.png`, fullPage: true });
      for (const q of rows.slice(0, 5)) {
        await page.goto(`${base}/p/${q.publicToken}`, { waitUntil: "networkidle0" });
        const text = await page.$eval("body", (node) => node.textContent ?? "");
        if (q.scenario.name === "Complete") {
          assert.ok(text.includes("Cobro completo")); assert.ok(!text.includes("Transferí Anticipo")); assert.ok(!text.includes("Enviá el comprobante de tu transferencia"));
          assert.ok(text.includes("El cobro registrado cubre el total"));
          await page.screenshot({ path: `${evidence}/portal-complete-${width}.png`, fullPage: true });
        }
        if (q.scenario.name === "Partial") assert.ok(text.includes("2.000.000"));
        if (q.scenario.name === "Proof review") { assert.ok(text.includes("todavía no es un cobro confirmado")); assert.ok(!text.includes("Ya confirmamos todos los pagos")); }
        assert.ok(text.includes("QA client"));
        assert.equal(await page.$eval('.admin-avatar--logo img', (node) => getComputedStyle(node).objectFit), "contain");
      }
    }
    const foreignOrg = `foreign-${suffix}`;
    await db.organization.create({ data: { id: foreignOrg, name: "Foreign", slug: foreignOrg } });
    const foreign = await db.client.create({ data: { id: randomUUID(), organizationId: foreignOrg, name: "Foreign client" } });
    await db.clientLogo.create({ data: { id: randomUUID(), clientId: foreign.id, mime: "image/png", size: logoBytes.length, data: logoBytes } });
    const mismatched = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: foreign.id, title: "Invalid cross-org fixture", status: "SENT", publicToken: generatePublicToken() } });
    assert.equal((await fetch(`${base}/api/portal/budget/${mismatched.publicToken}/client-logo`)).status, 404);
    await db.budget.delete({ where: { id: mismatched.id } });
    assert.equal((await fetch(`${base}/api/portal/budget/NO-TOKEN/client-logo`)).status, 404);
    const unavailable = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Unavailable quote", status: "CANCELLED", publicToken: generatePublicToken() } });
    assert.equal((await fetch(`${base}/api/portal/budget/${unavailable.publicToken}/client-logo`)).status, 404);
    await db.budget.delete({ where: { id: unavailable.id } });
    await page.goto(`${base}/imprimir/presupuesto/${rows[0].id}`, { waitUntil: "networkidle0" });
    assert.ok(await page.$('.lbprint-sheet .admin-avatar--logo img, .budget-print-sheet .admin-avatar--logo img'));
    await page.pdf({ path: `${evidence}/client-logo-a4.pdf`, format: "A4", printBackground: true });
    await page.screenshot({ path: `${evidence}/print-preview.png`, fullPage: true });
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => { if (request.url().includes("/client-logo")) void request.abort(); else void request.continue(); });
    await page.goto(`${base}/p/${rows[0].publicToken}`, { waitUntil: "networkidle0" });
    await page.waitForSelector('.admin-avatar--logo .admin-avatar-text');
    await page.setRequestInterception(false);
    page.removeAllListeners("request");
    // Missing images reuse AdminAvatar initials, rather than a parallel logo UI.
    await db.clientLogo.delete({ where: { clientId: client.id } });
    await page.goto(`${base}/p/${rows[0].publicToken}`, { waitUntil: "networkidle0" });
    assert.ok(await page.$('.admin-avatar--logo .admin-avatar-text'));
    assert.equal(await page.$eval('.admin-avatar--logo .admin-avatar-text', (node) => node.textContent), "QC");
    const viewerJwt = (await createSession(viewer, org)).jwt;
    await page.setCookie({ name: "ledbox_session", value: viewerJwt, url: base!, httpOnly: true });
    await page.goto(`${base}/presupuestos?vista=list`, { waitUntil: "networkidle0" });
    assert.equal(await page.$$eval('button[aria-label^="Enviar por correo:"]', (nodes) => nodes.length), 0);
    const forbidden = await fetch(`${base}/api/admin/budgets`, { method: "PATCH", headers: { Cookie: `ledbox_session=${viewerJwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ budgetId: rows[0].id, kind: "commercial", materialCost: 1 }) });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await snapshot(), before, "reading/action labels must not alter money/status/ledger");
    assert.deepEqual(pageErrors, []);
    console.log("EV-D03 API/browser1280/390: full12.5m/zero balance complete; partial/no receipt/installment/proof/no plan consistent; VIEWER no actions403; money/ledger unchanged");
  } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
