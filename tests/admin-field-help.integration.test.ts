import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import puppeteer from "puppeteer-core";

test("kit: ayuda con hover/foco/toque y moneda compacta mantiene Int, sin overflow en ambos temas", { skip: process.env.LEDBOX_FIELD_HELP_BROWSER !== "1" }, async () => {
  const evidence = process.env.LEDBOX_FIELD_HELP_EVIDENCE;
  const report: { cases: unknown[]; pageErrors: string[]; status?: string; error?: string } = { cases: [], pageErrors: [] };
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AdminTable,AdminRow,AdminCell}from'./components/admin/AdminUI';import{MoneyField,TextField,NumberField,SelectField}from'./components/admin/AdminFields';
  const columns=['Artículo','Categoría','Tipo','Cantidad','Libres','Costo diario','Precios','Estado','Acciones'];
  function Fixture(){const[m,setM]=useState('2147483647');return <div className="admin-root" data-theme="dark"><main className="fixture-form"><h1>Campos ilustrativos</h1><div className="admin-form-group admin-form-group--prices"><MoneyField id="money" label="Precio" help="Precio en guaraníes por unidad y día. No cambia el costo interno ni la tarifa base de otros presupuestos." value={m} onChange={setM}/><NumberField label="Desde días" help="Umbral del tramo; no altera otras tarifas." value="3" onChange={()=>{}}/><MoneyField label="Precio desde el umbral" help="Tarifa aplicada cuando se alcanza el tramo de días." value="123456789" onChange={()=>{}}/></div><div className="admin-form-grid"><TextField label="Artículo" help="Nombre que identifica el producto." value="Ejemplo" onChange={()=>{}}/><SelectField label="Tipo" help="Clase de producto de este registro." value="EQUIPMENT" onChange={()=>{}} options={[{value:'EQUIPMENT',label:'Equipo'}]}/></div><MoneyField id="full" label="Sin ancho compacto" compact={false} value="123456789" onChange={()=>{}}/><output id="raw">{m}</output><AdminTable view="inventario" label="Contrato ilustrativo de nueve columnas" columns={columns.map(label=>({label}))}><AdminRow>{columns.map(label=><AdminCell key={label}>{label}</AdminCell>)}</AdminRow></AdminTable></main></div>};createRoot(document.getElementById('fixture')).render(<Fixture/>);`;
  const fixtureSource = source.replace('<AdminCell key={label}>', '<AdminCell key={label} className={label === "Acciones" ? "admin-cell--actions" : undefined}>');
  const js = await build({ stdin: { contents: fixtureSource, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
  const tokens = readFileSync("node_modules/owncoding-ui/dist/tokens.css", "utf8");
  const { default: tailwindConfig } = await import(new URL("../tailwind.config.mjs", import.meta.url).href);
  const css = await postcss([tailwindcss(tailwindConfig)]).process(readFileSync("app/globals.css", "utf8").replace('@import "owncoding-ui/tokens.css";', tokens), { from: "app/globals.css" });
  const server = createServer((req, res) => {
    if (req.url === "/client.js") { res.setHeader("content-type", "text/javascript"); res.end(js.outputFiles[0].text); return; }
    if (req.url === "/style.css") { res.setHeader("content-type", "text/css"); res.end(css.css); return; }
    res.setHeader("content-type", "text/html"); res.end('<html lang="es"><head><link rel="stylesheet" href="/style.css"><style>.fixture-form{padding:16px;display:grid;gap:16px}</style></head><body><div id="fixture"></div><script src="/client.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage(); page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  try {
    for (const theme of ["dark", "light"]) for (const width of [360, 390, 1440]) {
      await page.setViewport({ width, height: 900, hasTouch: width < 500, isMobile: false });
      await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle0" });
      await page.waitForSelector("#money"); await page.$eval(".admin-root", (n, t) => n.setAttribute("data-theme", t), theme);
      const layout = await page.$eval("#money", (n) => { const input = n as HTMLInputElement, s = getComputedStyle(n), c = document.createElement("canvas").getContext("2d")!; c.font = `${s.fontSize} ${s.fontFamily}`; return { value: input.value, width: n.clientWidth, textWidth: c.measureText(input.value).width + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight), pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }; });
      assert.equal(layout.value, "2.147.483.647"); assert.ok(layout.textWidth <= layout.width); assert.ok(layout.pageWidth <= width);
      if (width === 1440) { assert.ok(layout.width <= 224); assert.ok(await page.$eval("#full", (n) => n.clientWidth > 224)); }
      const table = await page.$eval(".admin-table--inventario", (n) => {
        const head = n.querySelector<HTMLElement>(".admin-table-head")!, row = n.querySelector<HTMLElement>(".admin-table-row")!;
        return { headerTemplate: getComputedStyle(head).gridTemplateColumns, rowTemplate: getComputedStyle(row).gridTemplateColumns, header: Array.from(head.children).map(c => c.getBoundingClientRect().left), row: Array.from(row.children).map(c => c.getBoundingClientRect().left), headerActionRight: head.lastElementChild!.getBoundingClientRect().right - parseFloat(getComputedStyle(head.lastElementChild!).paddingRight), rowActionRight: row.lastElementChild!.getBoundingClientRect().right - parseFloat(getComputedStyle(row.lastElementChild!).paddingRight), internalScroll: n.parentElement!.scrollWidth > n.parentElement!.clientWidth };
      });
      assert.equal(table.header.length, 9); assert.equal(table.row.length, 9); assert.equal(table.headerTemplate, table.rowTemplate); assert.deepEqual(table.header.slice(0, 8), table.row.slice(0, 8)); assert.ok(Math.abs(table.headerActionRight - table.rowActionRight) <= 1);
      const button = '.admin-field-help button[aria-label="Ayuda sobre Precio"]';
      const buttonSize = await page.$eval(button, (n) => { const r = n.getBoundingClientRect(); return { width: r.width, height: r.height }; });
      assert.ok(buttonSize.width >= 44 && buttonSize.height >= 44);
      for (const mode of ["hover", "focus", "tap"] as const) {
        await page.mouse.move(0, 0); await page.$eval(button, (n) => n.blur());
        if (mode === "hover") await page.hover(button);
        if (mode === "focus") await page.$eval(button, (n) => n.focus());
        if (mode === "tap") await page.tap(button);
        await page.waitForSelector('[role="tooltip"]', { visible: true, timeout: 4000 });
        const tip = await page.$eval('[role="tooltip"]', (n) => { const r = n.getBoundingClientRect(); return { text: n.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, id: n.id }; });
        assert.ok(tip.text?.includes("guaraníes")); assert.ok(tip.left >= 0 && tip.right <= width && tip.top >= 0 && tip.bottom <= 900);
        assert.equal(await page.$eval(button, (n) => n.getAttribute("aria-describedby")), tip.id);
        if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `help-${theme}-${width}-${mode}.png`) }); }
        await page.keyboard.press("Escape"); await page.waitForSelector('[role="tooltip"]', { hidden: true });
      }
      await page.$eval("#money", (n) => { const input = n as HTMLInputElement; input.focus(); input.select(); }); await page.keyboard.type("2147483648", { delay: 40 });
      await page.waitForFunction(() => document.querySelector("#money")?.getAttribute("aria-invalid") === "true");
      assert.equal(await page.$eval("#raw", (n) => n.textContent), "2147483648");
      assert.ok(await page.$(".admin-field-error[role=alert]"));
      await page.$eval("#money", (n) => { const input = n as HTMLInputElement; input.focus(); input.select(); }); await page.keyboard.type("0", { delay: 40 });
      await page.waitForFunction(() => document.querySelector("#raw")?.textContent === "0");
      assert.equal(await page.$eval("#money", (n) => n.getAttribute("aria-invalid")), null);
      report.cases.push({ theme, width, layout, table, buttonSize, interactions: ["hover", "focus", "tap", "Escape"], storageExcessRetained: true, zeroValid: true });
    }
    assert.deepEqual(report.pageErrors, []); report.status = "LOCAL_PASS";
    if (evidence) writeFileSync(join(evidence, "fields.json"), JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "FAIL"; report.error = String(error);
    if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(join(evidence, "fields.json"), JSON.stringify(report, null, 2)); }
    throw error;
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
