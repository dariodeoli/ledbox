import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer-core";

const base = process.env.QUOTE_TEST_BASE_URL;
const chrome = process.env.QUOTE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = process.env.QUOTE_EVIDENCE_DIR ?? "/private/var/folders/jt/v4h3s4hs3wxf82mqzn6qtgg80000gn/T/opencode/ledbox-quote-qa";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? "") && existsSync(chrome));

test("quote list/board/mobile: menu geometry, keyboard, column alignment and status parity", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const org = `ui-${suffix}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  mkdirSync(evidence, { recursive: true });
  try {
    await db.organization.create({ data: { id: org, name: "Quote UI QA", slug: org } });
    const user = await db.adminUser.create({ data: { id: `ui-user-${suffix}`, name: "QA user", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: `ui-member-${suffix}`, adminUserId: user.id, organizationId: org, role: "OWNER" } });
    const client = await db.client.create({ data: { id: `ui-client-${suffix}`, organizationId: org, name: "QA client" } });
    for (let i = 0; i < 3; i++) await db.budget.create({ data: { id: `ui-budget-${suffix}-${i}`, organizationId: org, clientId: client.id, title: `QA presupuesto ${i} con nombre extenso para revisar dos líneas sin invadir otra columna`, status: i === 2 ? "SENT" : "DRAFT", total: 123456789, items: { create: { id: `ui-item-${suffix}-${i}`, name: "Servicio libre", quantity: 1, days: 1, unitPrice: 123456789, subtotal: 123456789 } } } });
    const { createSession } = await import("../lib/server/auth");
    const session = await createSession(user, org);
    const page = await browser.newPage();
    await page.setViewport({ width: 1470, height: 741 });
    await page.setCookie({ name: "ledbox_session", value: session.jwt, url: base!, httpOnly: true });
    await page.goto(`${base}/presupuestos?vista=list`, { waitUntil: "networkidle0" });
    await page.waitForSelector('.admin-table--presupuestos .admin-table-row');
    const alignment = await page.evaluate(() => {
      const table = document.querySelector('.admin-table--presupuestos')!;
      const head = [...table.querySelectorAll('.admin-table-head > [role="columnheader"]')];
      return [...table.querySelectorAll('.admin-table-row')].every((row) => [...row.children].every((cell, index) => {
        const a = cell.getBoundingClientRect(); const b = head[index].getBoundingClientRect();
        return Math.abs(a.left - b.left) < .5 && Math.abs(a.right - b.right) < .5;
      }));
    });
    assert.equal(alignment, true, "all column edges must align exactly");
    const checkMenu = async (selector: string) => {
      console.log(`Checking menu: ${selector}`);
      const trigger = await page.waitForSelector(selector);
      await trigger!.evaluate((node) => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      await page.waitForFunction((selector) => { const node = document.querySelector(selector)!; const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === node || (hit !== null && node.contains(hit)); }, {}, selector);
      await trigger!.click();
      console.log(await trigger!.evaluate((node) => { const r = node.getBoundingClientRect(); return { expanded: node.getAttribute("aria-expanded"), rect: {x:r.x,y:r.y,w:r.width,h:r.height}, hit: document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300) }; }));
      await page.screenshot({ path: `${evidence}/trigger.png` });
      await page.waitForSelector('.admin-menu-pop', { timeout: 5000 });
      console.log(await page.evaluate(() => { const pop = document.querySelector(".admin-menu-pop")!; const r = pop.getBoundingClientRect(); return { parent: pop.parentElement?.tagName, rect: { x:r.x, y:r.y, w:r.width, h:r.height }, viewport: {w:innerWidth,h:innerHeight}, style: getComputedStyle(pop).position }; }));
      await page.screenshot({ path: `${evidence}/menu.png` });
      await page.waitForFunction(() => {
        const pop = document.querySelector('.admin-menu-pop')!; const r = pop.getBoundingClientRect();
        return pop.parentElement === document.body && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), "menuitem");
      await page.keyboard.press("End");
      assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('.admin-menu-pop [role="menuitem"]')].at(-1)), true);
      await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelectorAll('.admin-menu-pop [role="menuitem"]')[1]), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.$('.admin-menu-pop'), null);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup')), "menu");
      await trigger!.click(); await page.waitForSelector('.admin-menu-pop');
      await page.click(".admin-kpis");
      assert.equal(await page.$('.admin-menu-pop'), null);
    };
    await checkMenu('.admin-table--presupuestos .admin-table-row button[aria-haspopup="menu"]');
    await page.click('button[aria-label="Tablero"]');
    await page.waitForSelector('.admin-board-card');
    assert.equal(await page.$$eval('.admin-board-card[data-status="DRAFT"]', (nodes) => nodes.length), 2);
    assert.equal(await page.$$eval('.admin-board-card[data-status="SENT"]', (nodes) => nodes.length), 1);
    await checkMenu('.admin-board-card button[aria-haspopup="menu"]');
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForSelector('.admin-cards');
    const sidebarBackdrop = await page.$(".admin-sidebar-backdrop");
    if (sidebarBackdrop) { await page.click('button[aria-label="Cerrar menú"]'); await page.waitForSelector(".admin-sidebar-backdrop", { hidden: true }); }
    await checkMenu('.admin-cards button[aria-haspopup="menu"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "mobile must not overflow the page");
    // Force the actual table CSS in a narrow viewport too, without changing module behavior.
    await page.setViewport({ width: 1470, height: 741 });
    await page.waitForSelector('button[aria-label="Lista"]'); await page.click('button[aria-label="Lista"]'); await page.waitForSelector('.admin-table--presupuestos');
    await page.evaluate(() => document.querySelector<HTMLElement>('.admin-table--presupuestos')!.parentElement!.style.width = '360px');
    assert.equal(await page.evaluate(() => { const wrap = document.querySelector('.admin-table--presupuestos')!.parentElement!; return wrap.scrollWidth > wrap.clientWidth && getComputedStyle(wrap).overflowX === 'auto'; }), true);
    // Exercise actual create/edit forms, not synthetic DOM handlers.
    const product = await db.inventoryItem.create({ data: { id: `ui-product-${suffix}`, organizationId: org, name: "QA selectable product", category: "QA", listPrice: 250000, imageUrl: "/assets/products/pantalla-led.png" } });
    await page.reload({ waitUntil: "networkidle0" });
    const clickText = async (text: string) => {
      const buttons = await page.$$('button');
      for (const button of buttons) if ((await button.evaluate((node) => node.textContent?.trim())) === text) { await button.click(); return; }
      throw new Error(`Button not found: ${text}`);
    };
    const field = async (label: string) => {
      const id = await page.evaluate((text) => [...document.querySelectorAll('label')].find((node) => node.textContent?.trim() === text)?.htmlFor, label);
      assert.ok(id, `Field not found: ${label}`);
      return (await page.$(`[id="${id}"]`))!;
    };
    await clickText("Nuevo presupuesto");
    if (process.env.QUOTE_CSS_FRAGMENT) await page.addStyleTag({ content: readFileSync(process.env.QUOTE_CSS_FRAGMENT, "utf8") });
    const clientField = await field("Cliente"); await clientField.type("QA client");
    await page.waitForSelector('.admin-combobox-option:not(.admin-combobox-option--create)');
    await clientField.press("Enter");
    await page.waitForSelector('button[aria-label="Quitar la selección de Cliente"]');
    await (await field("Título")).type("QA form persistence");
    assert.equal(await page.$('button[aria-label="Vincular QA selectable product"]'), null, "suggestions start collapsed");
    await clickText("Agregar ítem");
    await page.waitForSelector('button[aria-label="Vincular QA selectable product"]');
    await page.click('button[aria-label="Vincular QA selectable product"]');
    assert.equal(await (await field("Ítem 1")).evaluate((node) => (node as HTMLInputElement).value), product.name);
    await clickText("Agregar ítem");
    await clickText("Agregar servicio libre");
    await (await field("Ítem 2")).type("Free text service");
    const lastPriceId = await page.evaluate(() => [...document.querySelectorAll('label')].filter((node) => node.textContent?.trim() === "Precio unitario").at(-1)?.htmlFor);
    assert.ok(lastPriceId);
    await page.type('[id="' + lastPriceId + '"]', "50000");
    for (const width of [1470, 390, 360]) {
      await page.setViewport({ width, height: 844 });
      await page.screenshot({ path: `${evidence}/create-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewport({ width: 1470, height: 844 });
    await clickText("Guardar borrador");
    await page.waitForFunction(() => document.body.textContent?.includes("creado como borrador"), { timeout: 10000 });
    const saved = await db.budget.findFirstOrThrow({ where: { organizationId: org, title: "QA form persistence" }, include: { items: true } });
    assert.equal(saved.items.length, 2);
    assert.equal(saved.items.find((item) => item.inventoryId === product.id)?.unitPrice, 250000);
    assert.equal(saved.items.find((item) => item.name === "Free text service")?.inventoryId, null);
    await page.waitForSelector(`button[aria-label="Editar presupuesto: ${saved.title}"]`);
    await page.click(`button[aria-label="Editar presupuesto: ${saved.title}"]`);
    await page.waitForSelector('.admin-dialog');
    await clickText("Guardar");
    await page.waitForFunction(() => !document.querySelector('.admin-dialog'));
    const persisted = await db.budgetItem.findMany({ where: { budgetId: saved.id } });
    assert.equal(persisted.find((item) => item.inventoryId === product.id)?.unitPrice, 250000);
    // Review regression: clearing/retyping a unit price must retain the discount.
    const discounted = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "QA discount preservation", subtotal: 1000, discount: 200, total: 800, items: { create: { id: randomUUID(), name: "Discounted service", quantity: 1, days: 1, unitPrice: 1000, subtotal: 1000 } } } });
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(`button[aria-label="Editar presupuesto: ${discounted.title}"]`);
    await page.click(`button[aria-label="Editar presupuesto: ${discounted.title}"]`);
    await page.waitForSelector(".admin-dialog");
    const unitId = await page.evaluate(() => [...document.querySelectorAll<HTMLLabelElement>(".admin-dialog label")].find((node) => node.textContent?.trim() === "Precio unitario")?.htmlFor);
    assert.ok(unitId);
    const unit = (await page.$('[id="' + unitId + '"]'))!;
    await unit.click({ count: 3 }); await unit.press("Backspace"); await unit.type("1000");
    const finalInput = await field("Precio final (Gs)");
    assert.equal(await finalInput.evaluate((node) => (node as HTMLInputElement).value.replace(/[^0-9]/g, "")), "800");
    await clickText("Guardar"); await page.waitForFunction(() => !document.querySelector(".admin-dialog"));
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: discounted.id } })).discount, 200);
    // Sticky actions must be visible and opaque at 1366px, including after scroll.
    await page.setViewport({ width: 1366, height: 741 });
    await page.waitForSelector(".admin-table--presupuestos");
    for (const scroll of [0, 600]) {
      await page.evaluate((left) => { document.querySelector(".admin-table--presupuestos")!.parentElement!.scrollLeft = left; }, scroll);
      await page.waitForFunction(() => {
        const row = document.querySelector(".admin-table--presupuestos .admin-table-row .admin-cell--actions")!;
        const head = document.querySelector(".admin-table--presupuestos .admin-table-head > :last-child")!;
        const a = row.getBoundingClientRect(), b = head.getBoundingClientRect();
        return a.right <= innerWidth && a.left >= 0 && Math.abs(a.left - b.left) < .5 && getComputedStyle(row).position === "sticky" && getComputedStyle(row).backgroundColor !== "rgba(0, 0, 0, 0)";
      });
    }
    console.log("Verified: actual create form derives product name/price, keeps free text lines, and edit/save preserves inventory association.");
    console.log("Verified: list/board/card menus remain inside viewport; Escape/outside/keyboard work; all 11 columns align; 2 DRAFT + 1 SENT are preserved; narrow table scrolls, mobile page does not.");
  } catch (error) { console.error(error); throw error; } finally { await browser.close(); await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
