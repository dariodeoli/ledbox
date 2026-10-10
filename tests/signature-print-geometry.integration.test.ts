import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.SIGPDF_BASE_URL;
const browserBase = process.env.SIGPDF_BROWSER_BASE_URL ?? base;
const output = process.env.SIGPDF_EVIDENCE_DIR;
const fixtureFile = process.env.SIGPDF_FIXTURE_FILE;
const local = (value?: string) => Boolean(value && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(value));
const enabled = local(base) && local(browserBase) && Boolean(output) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "");
type Glyph = { text: string; offset: number; left: number; top: number; right: number; bottom: number };
type Box = { key: string; text: string; occurrence: number; line: number; left: number; top: number; right: number; bottom: number; width: number; height: number; glyphs: Glyph[] };
type NativePage = { page: number; text: string; boxes: Box[] };
type Fixture = { oracleRevision: 2; organizationId: string; ownerId: string; signatures: Array<{ profile: string; requestId: string; code: string; budgetId: string }> };

test("SIGPDF: columnas nativas, constancia sin colisiones y contraste sobre blanco en firmado real", { skip: !enabled, timeout: 240000 }, async () => {
  const db = new PrismaClient();
  const report: { probes: Array<{ id: string; pass: boolean; detail: unknown }>; errors: string[]; status?: string; failure?: string; browserPID?: number } = { probes: [], errors: [] };
  const probe = (id: string, pass: boolean, detail: unknown) => report.probes.push({ id, pass, detail });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  report.browserPID = browser.process()?.pid;
  mkdirSync(output!, { recursive: true });
  try {
    const { createSession } = await import("../lib/server/auth");
    let fixture: Fixture;
    if (fixtureFile && existsSync(fixtureFile)) {
      fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
      assert.equal(fixture.oracleRevision, 2, "Use a separately owned revision2 fixture path; preserve prior fixture bytes");
    }
    else {
      const organizationId = `sigpdf-${randomUUID()}`;
      await db.organization.create({ data: { id: organizationId, slug: organizationId, name: "PANEL local issuer" } });
      const owner = await db.adminUser.create({ data: { id: randomUUID(), name: "PANEL owner", email: `${randomUUID()}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
      await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: owner.id, role: "OWNER" } });
      const client = await db.client.create({ data: { id: randomUUID(), organizationId, name: "PANEL client" } });
      const product = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: "AL rental", category: "QA", minimumPrice: 50000, listPrice: 100001, listFromDays: 3, listFromPrice: 80001 } });
      const jwt = (await createSession(owner, organizationId)).jwt;
      const call = (path: string, body: unknown, admin = true) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `sigpdf-${organizationId}`, ...(admin ? { Cookie: `ledbox_session=${jwt}` } : {}) }, body: JSON.stringify(body) });
      fixture = { oracleRevision: 2, organizationId, ownerId: owner.id, signatures: [] };
      for (const profile of ["equivalent", "extended"]) {
        const items = Array.from({ length: profile === "equivalent" ? 1 : 18 }, (_, index) => ({ name: profile === "equivalent" ? "AL rental" : `PANEL equipo ${index + 1} para instalación audiovisual con nombre extenso verificable en todas sus líneas`, inventoryId: product.id, quantity: 2 + index, days: 3 + index % 3, unitPrice: 80001 + index * 137, costPrice: 0, priceMode: "MANUAL", discountMode: "PERCENT", discountValue: 1000, notes: profile === "equivalent" ? null : "Detalle propio para comprobar filas multilínea y paginación legible sin recortar información." }));
        const created = await call("/api/admin/budgets", { clientId: client.id, title: profile === "equivalent" ? "AL negotiated" : "PANEL documento extendido", items, discountMode: "PERCENT", discountValue: 500, advancePercentBps: 3000 });
        assert.equal(created.status, 201, await created.clone().text());
        const budget = (await created.json()).budget;
        if (profile === "equivalent") assert.deepEqual([budget.subtotal, budget.discount, budget.total, budget.advanceAmount], [432005, 21600, 410405, 123122]);
        const issued = await call("/api/admin/signatures", { budgetId: budget.id, recipientName: "PANEL signer", method: "TYPED", otpRequired: false });
        assert.equal(issued.status, 201, await issued.clone().text());
        const request = (await issued.json()).request;
        const signed = await call(`/api/portal/firma/${request.code}/sign`, { consent: true, signature: { name: "PANEL signer" } }, false);
        assert.equal(signed.status, 200, await signed.clone().text());
        fixture.signatures.push({ profile, requestId: request.id, code: request.code, budgetId: budget.id });
      }
      if (fixtureFile) writeFileSync(fixtureFile, JSON.stringify(fixture), { mode: 0o600 });
    }
    const page = await browser.newPage();
    page.on("pageerror", error => report.errors.push(String(error)));
    await page.setExtraHTTPHeaders({ "x-forwarded-host": "clientes.ledbox.online" });
    await page.setRequestInterception(true);
    page.on("request", request => { const url = new URL(request.url()); if (["localhost", "127.0.0.1"].includes(url.hostname) && ["GET", "HEAD"].includes(request.method())) void request.continue(); else void request.abort(); });
    const whiteContrast = (color: string) => {
      const rgba = color.match(/[\d.]+/g)!.map(Number), alpha = rgba[3] ?? 1;
      const channels = rgba.slice(0, 3).map(value => { const n = (value * alpha + 255 * (1 - alpha)) / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return 1.05 / (.2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] + .05);
    };
    for (const signature of fixture.signatures) {
      const requestBefore = await db.signatureRequest.findUniqueOrThrow({ where: { id: signature.requestId } });
      const eventsBefore = await db.signatureEvent.findMany({ where: { requestId: signature.requestId }, orderBy: { occurredAt: "asc" } });
      const creation = eventsBefore.find(event => event.eventType === "REQUEST_CREATED")!;
      const snapshot = (creation.metadataJson as Record<string, unknown>).documentSnapshot;
      assert.equal((creation.metadataJson as Record<string, unknown>).documentVersion, 3);
      assert.ok(requestBefore.signedDocumentHash); assert.ok(snapshot);
      for (const width of [390, 1280]) {
        const prefix = `${signature.profile}-${width}`;
        await page.setViewport({ width, height: 1123 }); await page.emulateMediaType("print");
        const response = await page.goto(`${browserBase}/firma/${signature.code}/documento`, { waitUntil: "networkidle0" });
        assert.equal(response?.status(), 200);
        await page.waitForSelector(".portal-signature-print"); await page.evaluate(() => document.fonts.ready);
        const dom = await page.$eval(".portal-signature-print", root => {
          const table = root.querySelector(".portal-table--items")!;
          const headers = Array.from(table.querySelectorAll("thead th")).map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: n.textContent!.trim() }; });
          const rows = Array.from(table.querySelectorAll("tbody tr")).map(row => Array.from(row.children).map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: n.textContent!.trim() }; }));
          const totals = Array.from(root.querySelectorAll(".portal-total-row > *")).map(n => ({ text: n.textContent!.trim(), color: getComputedStyle(n).color }));
          const facts = Array.from(root.querySelectorAll(".portal-signature-seal .portal-facts > div")).map(n => ({ label: n.querySelector("dt")!.textContent!.trim(), value: n.querySelector("dd")!.textContent!.trim() }));
          const names = Array.from(table.querySelectorAll("tbody .portal-item-name")).map(n => n.textContent!.trim());
          return { headers, rows, totals, facts, names, text: root.textContent };
        });
        const columns = dom.headers.length === 5 && dom.rows.every(row => row.length === 5 && row.every((cell, index) => Math.abs(cell.left - dom.headers[index].left) <= 1 && Math.abs(cell.right - dom.headers[index].right) <= 1));
        probe(`${prefix}.SIG-PDF-01.DOM`, columns, { headers: dom.headers, rows: dom.rows });
        const contrasts = dom.totals.map(total => ({ ...total, ratio: whiteContrast(total.color) }));
        probe(`${prefix}.SIG-PDF-03.contrast`, contrasts.length >= 6 && contrasts.every(total => total.ratio >= 4.5), contrasts);
        writeFileSync(join(output!, `${prefix}-dom.json`), JSON.stringify(dom, null, 2));
        await page.screenshot({ path: join(output!, `${prefix}-print.png`), fullPage: true });
        const pdf = join(output!, `${prefix}.pdf`), nativeDir = join(output!, `${prefix}-native`), needlesFile = join(output!, `${prefix}-needles.json`);
        const needles = [
          { key: "seal", text: "Constancia de firma electrónica" },
          ...dom.headers.map((cell, index) => ({ key: `header:${index}`, text: cell.text })),
          ...dom.rows.flatMap((row, index) => [{ key: `name:${index}`, text: dom.names[index] }, ...row.slice(1).map((cell, column) => ({ key: `cell:${index}:${column + 1}`, text: cell.text }))]),
          ...dom.facts.flatMap((fact, index) => [{ key: `label:${index}`, text: fact.label }, { key: `value:${index}`, text: fact.value }]),
        ];
        writeFileSync(needlesFile, JSON.stringify(needles));
        await page.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true });
        execFileSync("swift", [join(process.cwd(), "tests/signature-print-native.swift"), pdf, nativeDir, needlesFile], { stdio: "pipe", timeout: 60000 });
        const native: { pageCount: number; pages: NativePage[] } = JSON.parse(readFileSync(join(nativeDir, "geometry.json"), "utf8"));
        const nativeColumns: unknown[] = [];
        let nativeAligned = true;
        let wrappedNameObserved = false;
        for (let index = 0; index < dom.rows.length; index++) {
          // Every occurrence and every line/glyph of Producto must stay in band0.
          // Each page carrying a row must repeat all five headers above that row.
          const names = native.pages.flatMap(p => p.boxes.filter(box => box.key === `name:${index}`).map(box => ({ ...box, page: p.page })));
          if (names.some(name => name.line > 0)) wrappedNameObserved = true;
          const nameBands = names.map(name => {
            const nativePage = native.pages.find(p => p.page === name.page)!;
            const headings = Array.from({ length: 5 }, (_, column) => nativePage.boxes
              .filter(box => box.key === `header:${column}` && box.bottom <= name.top + .1)
              .sort((a, b) => a.top - b.top).at(-1));
            const repeatedHeader = headings.every(Boolean) && headings.every((header, column) => column === 0 || header!.left > headings[column - 1]!.right - .1);
            const left = headings[0]?.left, right = headings[1]?.left;
            const inBand = repeatedHeader && left !== undefined && right !== undefined && name.glyphs.length > 0
              && name.left >= left - .1 && name.right <= right + .1
              && name.glyphs.every(glyph => glyph.left >= left - .1 && glyph.right <= right + .1);
            return { name, headings, band: { left, right }, repeatedHeader, inBand };
          });
          const anchor = names.filter(name => name.line === 0).sort((a, b) => a.page - b.page || a.top - b.top)[0];
          const nativePage = native.pages.find(p => p.page === anchor?.page);
          const headings = nativePage?.boxes.filter(box => box.key.startsWith("header:") && anchor && box.bottom <= anchor.top + .1) ?? [];
          const cells = Array.from({ length: 4 }, (_, column) => {
            const header = headings.filter(box => box.key === `header:${column + 1}`).at(-1);
            const values = nativePage?.boxes.filter(box => box.key === `cell:${index}:${column + 1}` && anchor && Math.abs(box.top - anchor.top) < 4) ?? [];
            const previous = column > 0 ? headings.filter(box => box.key === `header:${column}`).at(-1) : null;
            return { header, values, inBand: Boolean(header && values.length > 0 && values.every(value =>
              value.glyphs.length > 0 && Math.abs(header.right - value.right) <= 1 && (!previous || value.left >= previous.right - .1)
              && value.glyphs.every(glyph => glyph.right <= header.right + 1 && (!previous || glyph.left >= previous.right - .1)))) };
          });
          if (names.length === 0 || !nameBands.every(line => line.inBand) || !cells.every(cell => cell.inBand)) nativeAligned = false;
          nativeColumns.push({ row: index, nameBands, cells });
        }
        probe(`${prefix}.SIG-PDF-01.native`, nativeAligned, nativeColumns);
        if (signature.profile === "extended") probe(`${prefix}.SIG-PDF-01.wrapped-name-exercised`, wrappedNameObserved, { wrappedNameObserved });
        const sealPage = native.pages.find(p => p.boxes.some(box => box.key === "seal"));
        const sealBox = sealPage?.boxes.find(box => box.key === "seal");
        const afterSeal = native.pages.flatMap(p => p.boxes.filter(box => sealPage && sealBox && (p.page > sealPage.page || p.page === sealPage.page && box.top > sealBox.bottom)).map(box => ({ ...box, page: p.page })));
        const groups = dom.facts.map((fact, index) => ({ fact, label: afterSeal.find(box => box.key === `label:${index}`), values: afterSeal.filter(box => box.key === `value:${index}`) }));
        const collisions = groups.flatMap(group => group.values.flatMap(value => groups.flatMap(next => {
          if (!next.label || value.page !== next.label.page) return [];
          const horizontal = Math.min(value.right, next.label.right) - Math.max(value.left, next.label.left);
          const vertical = Math.min(value.bottom, next.label.bottom) - Math.max(value.top, next.label.top);
          return horizontal > .1 && vertical > .1 ? [{ value: value.key, label: next.label.key, horizontal, vertical, page: value.page }] : [];
        })));
        const grouped = groups.every(group => group.label && group.values.length > 0 && group.values.every(value => value.page === group.label!.page && value.top >= group.label!.bottom - .1));
        probe(`${prefix}.SIG-PDF-02.native`, Boolean(sealPage) && grouped && collisions.length === 0, { pageCount: native.pageCount, groups, collisions });
        probe(`${prefix}.content-complete`, native.pages.every(p => p.text.length > 0) && dom.names.every(name => native.pages.some(p => p.boxes.some(box => box.key === `name:${dom.names.indexOf(name)}`))) && dom.text!.includes("410.405") === (signature.profile === "equivalent"), { pages: native.pageCount, rowCount: dom.rows.length, fileBytes: readFileSync(pdf).length });
      }
      assert.deepEqual(await db.signatureRequest.findUniqueOrThrow({ where: { id: signature.requestId } }), requestBefore);
      assert.deepEqual(await db.signatureEvent.findMany({ where: { requestId: signature.requestId }, orderBy: { occurredAt: "asc" } }), eventsBefore);
      probe(`${signature.profile}.immutable-snapshot`, true, { documentHash: requestBefore.documentHash, signedDocumentHash: requestBefore.signedDocumentHash, snapshotDigest: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"), requestCreatedRetained: true });
    }
    assert.deepEqual(report.errors, []);
    report.status = report.probes.every(p => p.pass) ? "PASS" : "FAIL";
    assert.deepEqual(report.probes.filter(p => !p.pass).map(p => p.id), []);
  } catch (error) { report.status = "FAIL"; report.failure = String(error); throw error; }
  finally {
    await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect();
    writeFileSync(join(output!, "signature-print-geometry.json"), JSON.stringify({ ...report, browserClosed: true, databaseClientsClosed: true }, null, 2));
  }
});
