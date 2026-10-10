import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

// Baseline observation, not certification of the requested AL implementation.
const base = process.env.QUOTE_TEST_BASE_URL;
const evidence = process.env.QUOTE_EVIDENCE_DIR;
if (!base || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) || !evidence || !/^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("Isolated local QA only");
async function main(base: string, evidence: string) {
const db = new PrismaClient();
const browser = await puppeteer.launch({ executablePath: process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const suffix = randomUUID(), org = `fin-al-oracle-${suffix}`;
mkdirSync(evidence, { recursive: true });
try {
  const { createSession } = await import("../lib/server/auth");
  const { generatePublicToken } = await import("../lib/server/budget-portal");
  await db.organization.create({ data: { id: org, slug: org, name: "AL isolated baseline" } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "AL local client" } });
  const inventory = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "AL rental", category: "QA", listPrice: 100001, listFromDays: 3, listFromPrice: 80001, wholesalePrice: 70001, wholesaleFromDays: 5, wholesaleFromPrice: 60001, minimumPrice: 50000 } });
  const user = await db.adminUser.create({ data: { id: randomUUID(), name: "AL owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
  await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role: "OWNER" } });
  const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
  const q = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "AL baseline tariff", status: "SENT", publicToken: generatePublicToken(), publicTokenCreatedAt: new Date(), subtotal: 200002, discount: 10000, total: 190002, advanceAmount: 57001, items: { create: { id: randomUUID(), inventoryId: inventory.id, name: inventory.name, quantity: 1, days: 2, unitPrice: inventory.listPrice, subtotal: 200002 } } }, include: { items: true } });
  const item = q.items[0];
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 900 });
  await page.goto(`${base}/p/${q.publicToken}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[aria-label^="Días de AL rental"]');
  const before = await page.$eval(".portal-table--items", (node) => node.textContent);
  await page.click('button[aria-label="Sumar uno a Días de AL rental"]');
  const after = await page.$eval(".portal-table--items", (node) => node.textContent);
  await page.screenshot({ path: `${evidence}/days-preview-390.png`, fullPage: true });
  const call = async (path: string, body: unknown, auth = false) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `al-local-${suffix}`, ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const original = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
  const selection = { id: item.id, quantity: 1, days: 3, excluded: false };
  const propose = (items: unknown[]) => call(`/api/portal/budget/${q.publicToken}/propose`, { kind: "items", name: "AL local client", note: "Days from two to three", items });
  for (const items of [[{ ...selection, days: 0 }], [{ ...selection, days: 366 }], [{ ...selection, unitPrice: 1 }], [{ ...selection, id: randomUUID() }]]) assert.equal((await propose(items)).status, 400);
  assert.equal((await propose([selection])).status, 200);
  assert.deepEqual(await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } }), original, "Pending request cannot mutate quote");
  const request = await db.budgetChangeRequest.findFirstOrThrow({ where: { budgetId: q.id, status: "pending" } });
  const viewer = await db.adminUser.create({ data: { id: randomUUID(), name: "AL viewer", email: `viewer-${suffix}@example.invalid`, role: "VIEWER", passwordHash: "not-a-login", autoLockEnabled: false } });
  await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: viewer.id, role: "VIEWER" } });
  const viewerCookie = `ledbox_session=${(await createSession(viewer, org)).jwt}`;
  const otherOrg = `al-other-${suffix}`;
  await db.organization.create({ data: { id: otherOrg, slug: otherOrg, name: "Other local company" } });
  await db.adminMembership.create({ data: { id: randomUUID(), organizationId: otherOrg, adminUserId: user.id, role: "OWNER" } });
  const otherCookie = `ledbox_session=${(await createSession(user, otherOrg)).jwt}`;
  const resolveAs = (cookieValue: string) => fetch(base + "/api/admin/budgets/requests", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieValue }, body: JSON.stringify({ requestId: request.id, decision: "accept" }) });
  assert.equal((await resolveAs(viewerCookie)).status, 403);
  assert.equal((await resolveAs(otherCookie)).status, 404);
  assert.deepEqual(await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } }), original);
  const response = await call("/api/admin/budgets/requests", { requestId: request.id, decision: "accept" }, true);
  assert.equal(response.status, 200);
  const saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
  await page.reload({ waitUntil: "networkidle0" });
  await page.screenshot({ path: `${evidence}/days-persisted-390.png`, fullPage: true });
  const observation = { scope: "AL baseline, no implementation PASS", baseSha: "26eae85d67713e60036dee9f1bbf71fe8353f4c2", candidateSha: process.env.QUOTE_CANDIDATE_SHA ?? null, guards: { viewerResolve: 403, crossOrgResolve: 404, invalidDaysAndInjectedPrices: 400, pendingOfferUnchanged: true }, before, after, tariff: { final: inventory.listPrice, finalFromDays: inventory.listFromDays, finalFromPrice: inventory.listFromPrice, wholesale: inventory.wholesalePrice, wholesaleFromDays: inventory.wholesaleFromDays, wholesaleFromPrice: inventory.wholesaleFromPrice, minimumPrice: inventory.minimumPrice }, stored: { days: saved.items[0].days, unitPrice: saved.items[0].unitPrice, subtotal: saved.subtotal, discount: saved.discount, total: saved.total, advanceAmount: saved.advanceAmount }, expectedFinalTariffAtThreeDays: 80001, expectedSubtotalForTariffMode: 240003, legacyAdvanceHasNoAutomaticMode: true };
  writeFileSync(`${evidence}/oracle.json`, JSON.stringify(observation, null, 2));
  console.log(JSON.stringify(observation, null, 2));
} finally {
  await browser.close();
  await db.$disconnect();
  await (await import("../lib/server/db")).db.$disconnect();
}
}
void main(base, evidence).catch((error) => { console.error(error); process.exitCode = 1; });
