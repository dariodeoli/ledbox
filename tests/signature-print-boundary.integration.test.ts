import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.SIGPDF_BASE_URL;
const output = process.env.SIGPDF_BOUNDARY_EVIDENCE_DIR;
const enabled = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base ?? "") && Boolean(output)
  && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "");
type Box = { key: string; text: string; line: number; occurrence: number; left: number; right: number; top: number; bottom: number;
  glyphs: { left: number; right: number; top: number; bottom: number }[] };
type Page = { page: number; height: number; boxes: Box[] };

// Independent delta: repeated quantity=days and repeated prices/subtotals in three
// rows; neutral test-only pagination spacer, not a renderer/CSS/canonical mutation.
test("SIGPDF delta: repeated values stay associated across a measured seal page jump", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const report: Record<string, unknown> = { status: "NOT_COMPLETED", browserPID: browser.process()?.pid, fixtureKind: "three-repeated-values-seal-page-boundary", immutabilityScope: "v3 TYPED only" };
  mkdirSync(output!, { recursive: true });
  try {
    if (process.env.SIGPDF_BOUNDARY_CASE_FILE) {
      const spec = JSON.parse(readFileSync(process.env.SIGPDF_BOUNDARY_CASE_FILE, "utf8"));
      assert.deepEqual([spec.revision, spec.rowCount, spec.quantity, spec.days, spec.unitPrice, spec.lineDiscountBps, spec.globalDiscountBps, spec.advanceBps], [1, 3, 2, 2, 80001, 1000, 500, 3000]);
      assert.deepEqual(spec.expectedAmounts, [864012, 43201, 820811, 246243]);
    }
    const { createSession } = await import("../lib/server/auth");
    const organizationId = `boundary-${randomUUID()}`;
    await db.organization.create({ data: { id: organizationId, slug: organizationId, name: "PANEL boundary issuer" } });
    const owner = await db.adminUser.create({ data: { id: randomUUID(), name: "PANEL boundary owner", email: `${randomUUID()}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: owner.id, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId, name: "PANEL boundary client" } });
    const jwt = (await createSession(owner, organizationId)).jwt;
    const call = (path: string, body: unknown, admin = true) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(admin ? { Cookie: `ledbox_session=${jwt}` } : {}) }, body: JSON.stringify(body) });
    const items = Array.from({ length: 3 }, (_, index) => ({ name: `PANEL borde ${index + 1} equipo audiovisual con descripción extensa de montaje para comprobar cada glifo`, quantity: 2, days: 2, unitPrice: 80001, costPrice: 0, priceMode: "MANUAL", discountMode: "PERCENT", discountValue: 1000 }));
    const created = await call("/api/admin/budgets", { clientId: client.id, title: "PANEL boundary repeated values", items, discountMode: "PERCENT", discountValue: 500, advancePercentBps: 3000 });
    assert.equal(created.status, 201, await created.clone().text());
    const budget = (await created.json()).budget;
    assert.deepEqual([budget.subtotal, budget.discount, budget.total, budget.advanceAmount], [864012, 43201, 820811, 246243]);
    const issued = await call("/api/admin/signatures", { budgetId: budget.id, recipientName: "PANEL boundary signer", method: "TYPED", otpRequired: false });
    assert.equal(issued.status, 201, await issued.clone().text());
    const request = (await issued.json()).request;
    const signed = await call(`/api/portal/firma/${request.code}/sign`, { consent: true, signature: { name: "PANEL boundary signer" } }, false);
    assert.equal(signed.status, 200, await signed.clone().text());
    writeFileSync(join(output!, "private-fixture.json"), JSON.stringify({ requestId: request.id, budgetId: budget.id, code: request.code, organizationId, items }), { mode: 0o600 });
    const before = await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id } });
    const eventsBefore = await db.signatureEvent.findMany({ where: { requestId: request.id }, orderBy: { occurredAt: "asc" } });
    assert.equal((eventsBefore.find(event => event.eventType === "REQUEST_CREATED")!.metadataJson as Record<string, unknown>).documentVersion, 3);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1123 }); await page.emulateMediaType("print");
    await page.setExtraHTTPHeaders({ "x-forwarded-host": "clientes.ledbox.online" });
    await page.setRequestInterception(true);
    page.on("request", request => { const url = new URL(request.url()); void (["localhost", "127.0.0.1"].includes(url.hostname) && ["GET", "HEAD"].includes(request.method()) ? request.continue() : request.abort()); });
    assert.equal((await page.goto(`${base}/firma/${request.code}/documento`, { waitUntil: "networkidle0" }))?.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    const dom = await page.$eval(".portal-signature-print", root => ({
      headers: Array.from(root.querySelectorAll("thead th")).map(node => node.textContent!.trim()),
      rows: Array.from(root.querySelectorAll("tbody tr")).map(row => Array.from(row.children).map(node => node.textContent!.trim())),
      names: Array.from(root.querySelectorAll(".portal-item-name")).map(node => node.textContent!.trim()),
      facts: Array.from(root.querySelectorAll(".portal-signature-seal .portal-facts > div")).map(group => ({ label: group.querySelector("dt")!.textContent!.trim(), value: group.querySelector("dd")!.textContent!.trim() })),
      totals: Array.from(root.querySelectorAll(".portal-total-row > *")).map(node => ({ text: node.textContent!.trim(), color: getComputedStyle(node).color })),
    }));
    const needles = [{ key: "seal", text: "Constancia de firma electrónica" },
      ...dom.headers.map((text, index) => ({ key: `header:${index}`, text })),
      ...dom.names.map((text, index) => ({ key: `name:${index}`, text })),
      ...dom.rows[0].slice(1).map((text, index) => ({ key: `number:${index + 1}`, text })),
      ...dom.facts.flatMap((fact, index) => [{ key: `label:${index}`, text: fact.label }, { key: `value:${index}`, text: fact.value }])];
    const needlesFile = join(output!, "needles.json"); writeFileSync(needlesFile, JSON.stringify(needles));
    async function native(name: string) {
      const pdf = join(output!, `${name}.pdf`), dir = join(output!, name);
      await page.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true });
      execFileSync("swift", [join(process.cwd(), "tests/signature-print-native.swift"), pdf, dir, needlesFile], { timeout: 60000, stdio: "pipe" });
      return JSON.parse(readFileSync(join(dir, "geometry.json"), "utf8")) as { pages: Page[]; pageCount: number };
    }
    const unperturbed = await native("unperturbed");
    const oldSealPage = unperturbed.pages.find(p => p.boxes.some(box => box.key === "seal"))!;
    const oldSeal = oldSealPage.boxes.find(box => box.key === "seal")!;
    // Fill the remaining native A4 space to 12pt above the lower print margin.
    // Existing break-inside protection must then move the real seal to a new page.
    const spacerPt = Math.max(0, oldSealPage.height - 14 * 72 / 25.4 - 12 - oldSeal.top);
    await page.$eval(".portal-signature-seal", (seal, height) => { const spacer = document.createElement("div"); spacer.dataset.sigpdfBoundaryProbe = "neutral-spacer"; spacer.style.height = `${height}pt`; seal.before(spacer); }, spacerPt);
    const boundary = await native("boundary");
    report.dom = dom; report.spacerPt = spacerPt; report.unperturbedPageCount = unperturbed.pageCount;
    const sealPage = boundary.pages.find(p => p.boxes.some(box => box.key === "seal"))!;
    const seal = sealPage.boxes.find(box => box.key === "seal")!;
    report.sealPageJump = { before: oldSealPage.page, after: sealPage.page, actual: sealPage.page > oldSealPage.page };
    assert.ok(sealPage.page > oldSealPage.page, "The delta must exercise a real native seal page transition");
    const rowProof: unknown[] = [];
    for (let row = 0; row < 3; row++) {
      const allLines = boundary.pages.flatMap(p => p.boxes.filter(box => box.key === `name:${row}`).map(box => ({ ...box, page: p.page })));
      assert.ok(allLines.length > 1 && allLines.every(line => line.page === allLines[0].page), "All name lines/glyphs are accounted for on an intact row page");
      const rowPage = boundary.pages.find(p => p.page === allLines[0].page)!;
      const lines = allLines;
      assert.ok(lines.length > 1, "Every delta name must wrap in native PDF");
      const top = Math.min(...lines.map(line => line.top));
      const headers = Array.from({ length: 5 }, (_, column) => rowPage.boxes.filter(box => box.key === `header:${column}` && box.bottom <= top + .1).sort((a, b) => a.top - b.top).at(-1)!);
      assert.ok(headers.every(Boolean), "Every row page repeats all five headers");
      assert.ok(lines.every(line => line.glyphs.length && line.glyphs.every(glyph => glyph.left >= headers[0].left - .1 && glyph.right <= headers[1].left + .1)));
      const numbers = Array.from({ length: 4 }, (_, column) => rowPage.boxes.filter(box => box.key === `number:${column + 1}` && Math.abs(box.top - top) < 4
        && Math.abs(box.right - headers[column + 1].right) <= 1 && box.left >= (column === 0 ? headers[1].left : headers[column].right) - .1));
      assert.ok(numbers.every(values => values.length === 1), "Repeated tokens must resolve once per actual row/column band");
      assert.ok(numbers.every((values, column) => values[0].glyphs.length && values[0].glyphs.every(glyph => glyph.right <= headers[column + 1].right + 1)));
      rowProof.push({ row, page: rowPage.page, lines, headers, numbers });
    }
    report.rowProof = rowProof;
    const labels = dom.facts.map((_, index) => sealPage.boxes.find(box => box.key === `label:${index}` && box.top > seal.bottom)!);
    const pairProof = labels.map((label, index) => {
      assert.ok(label, "Every seal label is present after the native page jump");
      const nextTop = labels[index + 1]?.top ?? sealPage.height - 14 * 72 / 25.4;
      const values = sealPage.boxes.filter(box => box.key === `value:${index}` && box.top >= label.bottom - .1 && box.bottom <= nextTop + .1);
      assert.ok(values.length && values.every(value => value.glyphs.length), "Repeated fact values associate with their own label interval");
      for (const value of values) for (const other of labels) {
        const overlapX = Math.min(value.right, other.right) - Math.max(value.left, other.left);
        const overlapY = Math.min(value.bottom, other.bottom) - Math.max(value.top, other.top);
        assert.ok(overlapX <= .1 || overlapY <= .1, "No value/label bbox intersection exceeds0.1pt");
      }
      return { label, values, nextTop };
    });
    report.pairProof = pairProof;
    const contrast = dom.totals.map(total => {
      const rgba = total.color.match(/[\d.]+/g)!.map(Number), alpha = rgba[3] ?? 1;
      const rgb = rgba.slice(0, 3).map(value => { const n = (value * alpha + 255 * (1 - alpha)) / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return { ...total, ratio: 1.05 / (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] + .05) };
    });
    assert.ok(contrast.length >= 6 && contrast.every(total => total.ratio >= 4.5)); report.contrast = contrast;
    assert.deepEqual(await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id } }), before);
    assert.deepEqual(await db.signatureEvent.findMany({ where: { requestId: request.id }, orderBy: { occurredAt: "asc" } }), eventsBefore);
    report.status = "PASS"; report.documentHash = before.documentHash; report.signedDocumentHash = before.signedDocumentHash;
  } catch (error) { report.status = "FAIL"; report.error = String(error); throw error; }
  finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); writeFileSync(join(output!, "boundary-proof.json"), JSON.stringify(report, null, 2)); }
});
