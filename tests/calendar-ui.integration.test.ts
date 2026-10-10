import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.CALENDAR_UI_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("Eventos: calendario real, cuatro períodos, duración exclusiva, resumen y selector persistente", { skip: !enabled, timeout: 180000 }, async () => {
  const db = new PrismaClient();
  const evidence = process.env.CALENDAR_UI_EVIDENCE;
  const report: { cases: unknown[]; errors: string[]; status?: string; failure?: string } = { cases: [], errors: [] };
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const { createSession } = await import("../lib/server/auth");
    const org = `calendar-ui-${randomUUID()}`;
    await db.organization.create({ data: { id: org, slug: org, name: "Calendar UI isolated QA" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "Calendar UI viewer", email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-login", role: "VIEWER", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role: "VIEWER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente calendario QA", company: "Empresa calendario QA" } });
    const zone = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" });
    const todayParts = zone.formatToParts(new Date());
    const today = ["year", "month", "day"].map(type => todayParts.find(p => p.type === type)!.value).join("-");
    const midnight = new Date(`${today}T00:00:00-03:00`).getTime();
    const dateTime = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const start = new Date(midnight - 50 * 86400000), end = new Date(midnight + 100 * 86400000);
    const container = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Duración contenedora QA", location: "Recinto operativo QA", city: "Asunción", status: "CONFIRMED", startsAt: start, endsAt: end, setupAt: new Date(start.getTime() - 3600000), strikeAt: new Date(end.getTime() + 3600000) } });
    await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Fin medianoche QA", startsAt: new Date(midnight - 3600000), endsAt: new Date(midnight) } });
    const session = await createSession(user, org);
    const page = await browser.newPage();
    page.on("pageerror", error => report.errors.push(String(error)));
    await page.setExtraHTTPHeaders({ "x-forwarded-host": "app.ledbox.online" });
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = new URL(request.url());
      if (["localhost", "127.0.0.1"].includes(url.hostname) && ["GET", "HEAD"].includes(request.method())) void request.continue();
      else void request.abort();
    });
    await page.setCookie({ name: "ledbox_session", value: session.jwt, url: base!, httpOnly: true });
    for (const theme of ["dark", "light"]) for (const width of [360, 390, 1440]) {
      await page.setViewport({ width, height: 900, hasTouch: width < 500 });
      await page.goto(`${base}/eventos?vista=calendario`, { waitUntil: "networkidle0" });
      await page.waitForSelector('.admin-events-calendar .admin-cal-item');
      await page.$eval(".admin-root", (node, value) => node.setAttribute("data-theme", value), theme);
      assert.equal(await page.$eval('[aria-label="Vista de eventos"] button[aria-label="Calendario"]', node => node.getAttribute("aria-pressed")), "true");
      for (const view of ["month", "week", "next30", "twoMonths"]) {
        const loaded = view === "month" ? null : page.waitForResponse(response => response.url().includes("/api/admin/calendar?") && response.status() === 200);
        await page.select('select[aria-label="Vista del calendario"]', view);
        if (loaded) await loaded;
        // Datos de la petición efectiva, no un calendario paralelo ni un mock del API.
        await page.waitForSelector('.admin-cal-item[aria-label="Ver resumen: Duración contenedora QA"]');
        const query = await page.$eval('select[aria-label="Vista del calendario"]', node => (node as HTMLSelectElement).value);
        assert.equal(query, view);
        const days = await page.$$eval('.admin-cal-day-row, .admin-cal-cell', nodes => nodes.filter(n => n.getClientRects().length).map(n => ({ day: n.getAttribute("data-date"), container: Boolean(n.querySelector('[aria-label="Ver resumen: Duración contenedora QA"][data-kind="event"]')), midnightEnd: Boolean(n.querySelector('[aria-label="Ver resumen: Fin medianoche QA"][data-kind="event"]')) })));
        assert.ok(days.length > 0);
        assert.ok(days.every(day => day.container), `container lost inside ${view}`);
        assert.ok(!days.some(day => day.day === today && day.midnightEnd), "exclusive midnight occupied the next day");
        if (view === "week") assert.equal(days.length, 7);
        if (view === "next30") assert.equal(days.length, 30);
        if (view === "twoMonths" && width === 1440) {
          const positions = await page.$$eval('.admin-cal-month-section', nodes => nodes.map(n => ({ left: n.getBoundingClientRect().left, top: n.getBoundingClientRect().top })));
          assert.equal(positions.length, 2); assert.equal(positions[0].top, positions[1].top); assert.ok(positions[1].left > positions[0].left);
        }
        await page.evaluate(() => { const node = Array.from(document.querySelectorAll<HTMLButtonElement>('.admin-cal-item[aria-label="Ver resumen: Duración contenedora QA"]')).find(n => n.getClientRects().length); node?.focus(); });
        await page.keyboard.press("Enter");
        await page.waitForSelector('.admin-cal-summary');
        const summary = await page.$eval('.admin-cal-summary', node => ({ text: node.textContent, focused: document.activeElement === node, values: Array.from(node.querySelectorAll('dl > div')).map(n => ({ label: n.querySelector('dt')?.textContent, value: n.querySelector('dd')?.textContent })) }));
        assert.ok(summary.focused); assert.match(summary.text ?? "", /Empresa calendario QA/); assert.match(summary.text ?? "", /Recinto operativo QA/); assert.match(summary.text ?? "", /Montaje/); assert.match(summary.text ?? "", /Desmontaje/);
        assert.ok(!summary.text?.includes("Sin fecha informada"));
        assert.equal(summary.values.find(v => v.label === "Inicio del evento")?.value, dateTime.format(start));
        assert.equal(summary.values.find(v => v.label === "Fin del evento")?.value, dateTime.format(end));
        if (evidence && view === "twoMonths") await page.screenshot({ path: join(evidence, `${theme}-${width}-summary.png`) });
        await page.keyboard.press("Escape"); await page.waitForSelector('.admin-cal-summary', { hidden: true });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Ver resumen: Duración contenedora QA");
        const layout = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(layout.pageWidth <= layout.viewport, JSON.stringify(layout));
        if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `${theme}-${width}-${view}.png`), fullPage: true }); }
        report.cases.push({ theme, width, view, days: days.length, layout, source: `/api/admin/calendar; real PG event ${container.id}`, summary: "real event-ops panel fields; keyboard focus/Escape return" });
      }
      await page.click('[aria-label="Vista de eventos"] button[aria-label="Lista"]');
      await page.waitForSelector('.admin-events-calendar', { hidden: true });
      await page.click('[aria-label="Vista de eventos"] button[aria-label="Tarjetas"]');
      assert.equal(await page.$eval('[aria-label="Vista de eventos"] button[aria-label="Tarjetas"]', n => n.getAttribute('aria-pressed')), "true");
      await page.click('[aria-label="Vista de eventos"] button[aria-label="Calendario"]');
      await page.goto(`${base}/eventos`, { waitUntil: "networkidle0" });
      await page.waitForSelector('.admin-events-calendar');
      assert.equal(await page.evaluate(() => localStorage.getItem("ledbox-admin-view:eventos")), "calendar");
    }
    assert.deepEqual(report.errors, []); report.status = "LOCAL_REAL_API_PASS";
  } catch (error) { report.status = "FAIL"; report.failure = String(error); throw error; }
  finally {
    if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, "calendar-ui.json"), JSON.stringify(report, null, 2)); }
    await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect();
  }
});
