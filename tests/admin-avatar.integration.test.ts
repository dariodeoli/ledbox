import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { AdminAvatar, AdminOrgLogo } from "../components/admin/AdminAvatar";

Object.assign(globalThis, { React });

test("identidad: error anterior/posterior a hidratación cae a iniciales, sin alt duplicado, y una URL nueva recupera la imagen", { skip: process.env.LEDBOX_AVATAR_BROWSER !== "1" }, async () => {
  const evidence = process.env.LEDBOX_AVATAR_EVIDENCE;
  const cases: string[] = [];
  const errors: string[] = [];
  const sources = ["/missing.png", "/ok.svg", null];
  const client = await build({
    stdin: { contents: `import React from 'react';import{hydrateRoot}from'react-dom/client';import{AdminAvatar,AdminOrgLogo}from'./components/admin/AdminAvatar';
      const root=hydrateRoot(document.getElementById('fixture'),React.createElement(AdminAvatar,{name:'QA Cliente',src:window.initialSource}));
      window.avatarSource=(src)=>root.render(React.createElement(AdminAvatar,{name:'QA Cliente',src}));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="cyan"/></svg>';
  const server = createServer((req, res) => {
    if (req.url === "/client.js") { res.setHeader("content-type", "text/javascript"); res.end(client.outputFiles[0].text); return; }
    if (req.url === "/ok.svg") { res.setHeader("content-type", "image/svg+xml"); res.end(svg); return; }
    if (req.url?.includes(".png")) { res.writeHead(404); res.end(); return; }
    const source = sources[Number((req.url ?? "/0").slice(1))];
    res.setHeader("content-type", "text/html");
    res.end(`<html lang="es"><body><div id="fixture">${renderToString(createElement(AdminAvatar, { name: "QA Cliente", src: source }))}</div><script>window.initialSource=${JSON.stringify(source)}</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage(); page.on("pageerror", (error) => errors.push(String(error)));
  try {
    for (const [index, source] of sources.entries()) {
      await page.goto(`${base}/${index}`, { waitUntil: "networkidle0" });
      if (source === "/missing.png") {
        assert.deepEqual(await page.$eval("img", (img) => ({ complete: img.complete, width: img.naturalWidth })), { complete: true, width: 0 });
        assert.equal(await page.$(".admin-avatar-text"), null, "SSR aún no hidratado: reproducción del error perdido");
      }
      await page.addScriptTag({ url: `${base}/client.js` });
      if (source !== "/ok.svg") {
        await page.waitForSelector(".admin-avatar-text");
        assert.equal(await page.$eval(".admin-avatar-text", (n) => n.textContent), "QC");
        assert.equal(await page.$("img"), null);
        cases.push(source ? "pre-hydration-error" : "default-initials");
      } else {
        assert.equal(await page.$eval("img", (n) => n.getAttribute("alt")), "");
        await page.evaluate(() => (window as unknown as { avatarSource: (src: string) => void }).avatarSource("/later-missing.png"));
        await page.waitForSelector(".admin-avatar-text");
        assert.equal(await page.$eval(".admin-avatar-text", (n) => n.textContent), "QC");
        cases.push("post-hydration-error");
      }
      await page.evaluate(() => (window as unknown as { avatarSource: (src: string) => void }).avatarSource("/ok.svg"));
      await page.waitForFunction(() => { const img = document.querySelector<HTMLImageElement>("img"); return img?.complete && img.naturalWidth > 0; });
      assert.equal(await page.$(".admin-avatar-text"), null);
      assert.equal(await page.$eval("img", (n) => n.getAttribute("referrerpolicy")), "no-referrer");
      assert.equal(await page.$eval("img", (n) => n.getAttribute("alt")), "");
      assert.equal(await page.$eval(".admin-avatar", (n) => n.getAttribute("aria-hidden")), "true");
      cases.push(`new-source-recovers-${index}`);
      if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `avatar-recovered-${index}.png`) }); }
    }
    const org = renderToString(createElement(AdminOrgLogo, { name: "Empresa", variant: "light" }));
    assert.ok(org.includes("LB"));
    assert.deepEqual(errors, []);
    if (evidence) writeFileSync(join(evidence, "avatar.json"), JSON.stringify({ cases, pageErrors: errors, status: "LOCAL_PASS", source: "real AdminAvatar SSR before explicit hydrateRoot; local HTTP404/valid SVG; no DB or hotlinks", version: JSON.parse(readFileSync("package.json", "utf8")).version }, null, 2));
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
