import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import puppeteer, { type ElementHandle } from "puppeteer-core";

// Fixture del kit real, sin endpoints ni DB. Pilot verifica luego el SHA integrado.
test("kit real: normalización, selectores, teclado/modal y evidencia responsive", { skip: process.env.LEDBOX_KIT_QA !== "1", timeout: 120_000 }, async () => {
  const evidence = process.env.LEDBOX_KIT_EVIDENCE;
  assert.ok(evidence, "indicar un directorio de evidencia externo al worktree");
  const output = await build({ entryPoints: ["tests/fixtures/admin-kit.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' } });
  const rawCss = await readFile("app/globals.css", "utf8");
  const tokens = await readFile("node_modules/owncoding-ui/dist/tokens.css", "utf8");
  const css = (await postcss([tailwind("./tailwind.config.mjs"), autoprefixer]).process(tokens + rawCss.replace('@import "owncoding-ui/tokens.css";', ""), { from: undefined })).css;
  const server = createServer((request, response) => {
    if (request.url === "/kit.js") { response.setHeader("Content-Type", "text/javascript"); response.end(output.outputFiles[0].contents); }
    else if (request.url === "/kit.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/kit.css"><body><div id="admin-root" class="admin-root" data-theme="dark"><div id="kit"></div></div><script src="/kit.js"></script></body></html>'); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await puppeteer.launch({ executablePath: process.env.E2E_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    await mkdir(evidence, { recursive: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push(String(error)); console.error(String(error)); });
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#phone");
    const state = () => page.$eval("#state", (node) => JSON.parse(node.textContent ?? "{}"));
    const fill = async (selector: string, value: string) => {
      await page.$eval(selector, (node, text) => {
        const input = node as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    };
    assert.equal((await state()).phone, "+54 91123456789", "el default no pisa el país existente");
    await fill("#phone", "+595 981 123456");
    assert.equal((await state()).phone, "+595 981123456", "pegado internacional conserva código y dígitos");
    await fill("#email", "  OWNER@EXAMPLE.COM  ");
    assert.equal((await state()).email, "owner@example.com");
    await fill("#amount", "2.147.483.648");
    assert.equal((await state()).amount, "2147483648");
    assert.equal(await page.$eval("#amount", (node) => node.getAttribute("aria-invalid")), "true");
    assert.equal(await page.$eval("#amount", (node) => node.hasAttribute("maxlength")), false);
    await fill("#amount", "900719925474099312345");
    assert.equal((await state()).amount, "900719925474099312345", "sin redondear/truncar dígitos fuera de rango");
    await page.waitForFunction(() => (document.getElementById("amount") as HTMLInputElement).value.replace(/\D/g, "") === "900719925474099312345");
    assert.equal(await page.$eval("#amount", (node) => (node as HTMLInputElement).value.replace(/\D/g, "")), "900719925474099312345");
    await fill("#amount", "2.147.483.647");
    assert.equal(await page.$eval("#amount", (node) => node.getAttribute("aria-invalid")), null);
    await fill("#percent", "12.50");
    assert.equal((await state()).percent, "12,50");
    await fill("#percent", "101");
    assert.equal(await page.$eval("#percent", (node) => node.getAttribute("aria-invalid")), "true");
    await fill("#percent", "12,5");
    await fill("#city", "Ciudad manual sin catálogo");
    assert.equal((await state()).department, "", "no conserva departamento ajeno al texto manual");
    await fill("#city", "Asun");
    await page.focus("#city");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal((await state()).city, "Asunción");
    assert.equal((await state()).department, "Asunción");
    await fill("#bank", "cont");
    await page.focus("#bank");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal((await state()).bank, "Banco Continental");
    await page.click("#open-dialog");
    await page.waitForSelector('[role="dialog"]');
    await page.click("#entity");
    await page.type("#entity", "sonido");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    assert.equal((await state()).entity, "a", "búsqueda secundaria y elección por teclado");
    assert.equal(await page.$eval("#entity", (node) => (node as HTMLInputElement).name), "entity");
    assert.equal(await page.$eval("#entity", (node) => node.getAttribute("aria-required")), "true");
    await page.focus("#percent");
    await page.click("#entity");
    await page.keyboard.press("Escape");
    assert.ok(await page.$('[role="dialog"]'), "Escape cierra sugerencias antes del diálogo");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    // Los fixtures son archivos locales; nunca se suben a un API.
    const fakePdf = resolve(evidence, "falso.pdf");
    const pdf = resolve(evidence, "ejemplo.pdf");
    await writeFile(fakePdf, "texto renombrado");
    await writeFile(pdf, "%PDF-1.7\n%fixture local\n");
    await (await page.$("#attachment") as ElementHandle<HTMLInputElement>).uploadFile(fakePdf);
    await page.waitForFunction(() => document.querySelector("#attachment")?.getAttribute("aria-invalid") === "true");
    assert.equal((await state()).attachment, "");
    await (await page.$("#attachment") as ElementHandle<HTMLInputElement>).uploadFile(pdf);
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).attachment === "ejemplo.pdf");
    const probes = [];
    for (const theme of ["light", "dark"] as const) for (const width of [360, 390, 1440]) {
      await page.setViewport({ width, height: width < 500 ? 844 : 1000 });
      await page.$eval("#admin-root", (node, theme) => node.setAttribute("data-theme", theme), theme);
      const kpis = await page.$$eval("#high-total-kpis .admin-kpi-value", (nodes) => nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const card = node.closest(".admin-kpi")!.getBoundingClientRect();
        const style = getComputedStyle(node);
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        return { value: node.textContent, left: box.left, right: box.right, cardRight: card.right, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, textRight: text.right, whiteSpace: style.whiteSpace, numbers: style.fontVariantNumeric, overflow: style.overflow };
      }));
      assert.equal(kpis.at(-1)!.value, "Gs 2.148.384.798", "F06: suma real preservada completa");
      for (const kpi of kpis) {
        assert.ok(kpi.left >= 0 && kpi.right <= width && kpi.textRight <= kpi.cardRight, `${theme}/${width}: KPI fuera de tarjeta/página: ${JSON.stringify(kpi)}`);
        assert.ok(kpi.scrollWidth <= kpi.clientWidth, "sin recortar dígitos");
        assert.equal(kpi.whiteSpace, "nowrap");
        assert.equal(kpi.numbers, "tabular-nums");
        assert.equal(kpi.overflow, "visible");
      }
      const probe = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, phoneWidth: document.getElementById("phone")!.getBoundingClientRect().width, phoneHeight: document.getElementById("phone")!.getBoundingClientRect().height, countryHeight: document.querySelector('.admin-shared-phone button[role="combobox"]')!.getBoundingClientRect().height }));
      assert.equal(probe.overflow, false, `${theme}/${width}: desborde de página`);
      await page.screenshot({ path: resolve(evidence, `kit-${theme}-${width}.png`), fullPage: true });
      assert.ok(probe.phoneWidth > 100, JSON.stringify(probe));
      if (width < 500) assert.ok(probe.phoneHeight >= 44 && probe.countryHeight >= 44);
      probes.push({ theme, ...probe, kpis });
      await page.screenshot({ path: resolve(evidence, `kit-${theme}-${width}.png`), fullPage: true });
      await page.click("#open-dialog");
      await page.click('.admin-shared-phone button[role="combobox"]');
      await page.waitForSelector('[aria-label="Buscar país"]');
      await page.type('[aria-label="Buscar país"]', "Argentina");
      await page.keyboard.press("Enter");
      assert.ok(await page.$('[role="dialog"]'));
      await page.screenshot({ path: resolve(evidence, `modal-${theme}-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
    }
    assert.deepEqual(errors, []);
    await writeFile(resolve(evidence, "probe-kit.json"), JSON.stringify({ base: "e0f133c", ui: "9dc9ec44216d22e92fad72fc1ad08bf3296a8da2", probes, errors, passed: true }, null, 2));
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
