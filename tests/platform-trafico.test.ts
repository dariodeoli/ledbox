import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
  countryFromHeaders,
  dailySalt,
  demoModuleOf,
  deviceFromUa,
  hostKindMap,
  isBotUa,
  normalizePath,
  parseBeaconBody,
  referrerHostOf,
  visitorHash,
} from "../lib/platform/trafico-core";
import { shouldSendMetrics } from "../lib/analytics/should-send";
import { businessViews, formatDuration, formatPct, parseSite, splitHosts, type SiteHosts } from "../lib/platform/trafico-view";
import type { HostRow } from "../lib/platform/queries/trafico";
import { asuncionMidnight, computeDelta, resolvePeriod } from "../lib/platform/periods";

const root = process.cwd();
const HOSTS = hostKindMap({
  siteUrl: "https://ledbox.online",
  productUrl: "https://eventos.ledbox.online",
  demoUrl: "https://demo.ledbox.online",
  clientUrl: "https://clientes.ledbox.online",
  adminUrl: "https://app.ledbox.online",
});
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const goodBody = { viewId: "view-abcdef12", sessionId: "sess-abcdef12", host: "ledbox.online", path: "/productos/pantalla-led", referrer: "https://www.google.com/search?q=led", durationSec: 12, scrollPct: 55.4, isEntry: true };

test("normalizePath: sin query ni fragmento y en minúsculas", () => {
  assert.equal(normalizePath("/productos/Pantalla-LED?utm=1#x"), "/productos/pantalla-led");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath("/catalogo/mi-empresa?code=ABC"), "/catalogo/mi-empresa");
});

test("normalizePath: el token del portal, firma, comparación y pedido nunca se guarda", () => {
  const secret = "lbxq_Zk39sLmPqR7vT2xYw0aB";
  assert.equal(normalizePath(`/p/${secret}`), "/p/:token");
  assert.equal(normalizePath(`/firma/${secret}/documento`), "/firma/:token/documento");
  assert.equal(normalizePath(`/firma/${secret}/auditoria?x=1`), "/firma/:token/auditoria");
  assert.equal(normalizePath(`/comparar/${secret}`), "/comparar/:token");
  assert.equal(normalizePath(`/pedido/${secret}`), "/pedido/:token");
  assert.equal(normalizePath(`/tienda/mi-empresa/mayorista/${secret}`), "/tienda/mi-empresa/mayorista/:token");
  for (const path of [`/p/${secret}`, `/firma/${secret}/documento`, `/tienda/mi-empresa/mayorista/${secret}`]) {
    assert.ok(!normalizePath(path)!.includes(secret));
  }
});

test("normalizePath: ids del panel demo pasan a :id y los módulos se conservan", () => {
  assert.equal(normalizePath("/eventos/demo_event_123"), "/eventos/:id");
  assert.equal(normalizePath("/presupuestos/clx9abcd1234efgh5678"), "/presupuestos/:id");
  assert.equal(normalizePath("/clientes/3f2b8c1e-1111-4222-8333-444455556666"), "/clientes/:id");
  assert.equal(normalizePath("/inventario/42"), "/inventario/:id");
  assert.equal(normalizePath("/finanzas"), "/finanzas");
  assert.equal(normalizePath("/ajustes/empresa"), "/ajustes/empresa");
});

test("normalizePath: rechaza lo que no es un path usable", () => {
  for (const bad of ["", "producto", "//evil.com", "/a\\b", "/a\u0000b", 5, null, undefined, `/${"a".repeat(400)}`]) {
    assert.equal(normalizePath(bad), null, String(bad));
  }
  assert.ok(normalizePath(`/${"a/".repeat(50)}`)!.split("/").length <= 9);
});

test("demoModuleOf: módulo = primer segmento; la entrada es «entrada»", () => {
  assert.equal(demoModuleOf("/"), "entrada");
  assert.equal(demoModuleOf("/demo"), "entrada");
  assert.equal(demoModuleOf("/finanzas/cobros"), "finanzas");
  assert.equal(demoModuleOf("/eventos/:id"), "eventos");
});

test("referrerHostOf: solo dominio; nulo si es la misma web o no es http", () => {
  assert.equal(referrerHostOf("https://www.google.com/search?q=led&x=secreto", "ledbox.online"), "google.com");
  assert.equal(referrerHostOf("https://l.instagram.com/?u=abc", "ledbox.online"), "l.instagram.com");
  assert.equal(referrerHostOf("https://eventos.ledbox.online/precios", "ledbox.online"), null);
  assert.equal(referrerHostOf("https://ledbox.online/", "www.ledbox.online"), null);
  assert.equal(referrerHostOf("android-app://com.google.android.gm", "ledbox.online"), null);
  assert.equal(referrerHostOf("no es url", "ledbox.online"), null);
  assert.equal(referrerHostOf("", "ledbox.online"), null);
});

test("deviceFromUa y países", () => {
  assert.equal(deviceFromUa("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(deviceFromUa("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36"), "mobile");
  assert.equal(deviceFromUa(CHROME), "desktop");
  assert.equal(deviceFromUa(null), "desktop");
  const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;
  assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "py" })), "PY");
  assert.equal(countryFromHeaders(headers({ "cf-ipcountry": "XX" })), null);
  assert.equal(countryFromHeaders(headers({ "x-country-code": "<script>" })), null);
  assert.equal(countryFromHeaders(headers({})), null);
});

test("hash del visitante: estable en el día, cambia con el día, la IP y el UA, y no contiene ni IP ni UA", () => {
  const base = { secret: "secreto-de-prueba", ip: "190.104.5.77", ua: CHROME, now: new Date("2026-10-14T15:00:00Z") };
  const hash = visitorHash(base);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(visitorHash({ ...base, now: new Date("2026-10-14T20:00:00Z") }), hash, "mismo día de Paraguay");
  assert.notEqual(visitorHash({ ...base, now: new Date("2026-10-15T15:00:00Z") }), hash, "la sal rota por día");
  assert.notEqual(visitorHash({ ...base, ip: "190.104.5.78" }), hash);
  assert.notEqual(visitorHash({ ...base, ua: "otro navegador de prueba" }), hash);
  assert.notEqual(visitorHash({ ...base, secret: "otro-secreto" }), hash);
  assert.ok(!hash.includes("190") && !hash.includes("Mozilla"));
  // 02:30 UTC todavía es el día anterior en Paraguay.
  assert.equal(visitorHash({ ...base, now: new Date("2026-10-15T02:30:00Z") }), hash);
  assert.notEqual(dailySalt("s", "2026-10-14"), dailySalt("s", "2026-10-15"));
});

test("filtro de bots por UA", () => {
  for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "curl/8.4.0", "Mozilla/5.0 (compatible; AhrefsBot/7.0)", "WhatsApp/2.23", "python-requests/2.31", "HeadlessChrome/120", "Slackbot-LinkExpanding 1.0", "", "x", "Lighthouse"]) {
    assert.equal(isBotUa(ua), true, ua);
  }
  for (const ua of [CHROME, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"]) {
    assert.equal(isBotUa(ua), false, ua);
  }
  assert.equal(isBotUa(null), true);
});

test("validación estricta del cuerpo del beacon", () => {
  const ok = parseBeaconBody(goodBody, HOSTS);
  assert.ok(ok);
  assert.equal(ok.scrollPct, 55);
  assert.equal(ok.path, "/productos/pantalla-led");
  assert.equal(parseBeaconBody({ ...goodBody, durationSec: 99999 }, HOSTS)!.durationSec, 1800, "tope 1800");
  assert.equal(parseBeaconBody({ ...goodBody, durationSec: undefined, scrollPct: undefined }, HOSTS)!.durationSec, null);
  assert.ok(parseBeaconBody({ ...goodBody, host: "WWW.LEDBOX.ONLINE" }, HOSTS), "www del sitio permitido");
  const bad: Array<Record<string, unknown>> = [
    { ...goodBody, host: "evil.com" },
    { ...goodBody, host: "app.ledbox.online.evil.com" },
    { ...goodBody, host: 5 },
    { ...goodBody, viewId: "corto" },
    { ...goodBody, viewId: "con espacios y <script>" },
    { ...goodBody, sessionId: undefined },
    { ...goodBody, path: "sin-barra" },
    { ...goodBody, path: "//evil.com" },
    { ...goodBody, referrer: "x".repeat(500) },
    { ...goodBody, referrer: 5 },
    { ...goodBody, durationSec: -1 },
    { ...goodBody, durationSec: "12" },
    { ...goodBody, durationSec: Number.NaN },
    { ...goodBody, scrollPct: 101 },
    { ...goodBody, scrollPct: -1 },
    { ...goodBody, isEntry: "yes" },
    { ...goodBody, ip: "1.2.3.4" },
    { ...goodBody, userAgent: "x" },
  ];
  for (const body of bad) assert.equal(parseBeaconBody(body, HOSTS), null, JSON.stringify(body).slice(0, 80));
  for (const value of [null, undefined, "texto", 5, [], [goodBody]]) assert.equal(parseBeaconBody(value, HOSTS), null);
});

test("lista cerrada de hosts: el panel se clasifica como panel y localhost solo con permiso", () => {
  assert.equal(HOSTS.get("app.ledbox.online"), "panel");
  assert.equal(HOSTS.get("admin.ledbox.online"), "panel");
  assert.equal(HOSTS.get("demo.ledbox.online"), "demo");
  assert.equal(HOSTS.get("clientes.ledbox.online"), "portal");
  assert.equal(HOSTS.get("eventos.ledbox.online"), "eventos");
  assert.equal(HOSTS.get("www.ledbox.online"), "site");
  assert.equal(HOSTS.has("localhost"), false);
  assert.equal(hostKindMap({ siteUrl: "https://ledbox.online", productUrl: "", demoUrl: "", clientUrl: "", adminUrl: "" }, { allowLocal: true }).has("localhost"), true);
});

test("DNT, entorno y flag de pruebas", () => {
  assert.equal(shouldSendMetrics({ doNotTrack: "1", nodeEnv: "production" }), false);
  assert.equal(shouldSendMetrics({ doNotTrack: "1", nodeEnv: "development", debugFlag: "1" }), false);
  assert.equal(shouldSendMetrics({ doNotTrack: "0", nodeEnv: "production" }), true);
  assert.equal(shouldSendMetrics({ doNotTrack: null, nodeEnv: "production" }), true);
  assert.equal(shouldSendMetrics({ doNotTrack: null, nodeEnv: "development" }), false);
  assert.equal(shouldSendMetrics({ doNotTrack: null, nodeEnv: "development", debugFlag: "1" }), true);
  assert.equal(shouldSendMetrics({ doNotTrack: undefined, nodeEnv: undefined }), false);
});

test("rango de Paraguay: medianoche local, anterior de igual duración, delta «nuevo»", () => {
  const now = new Date("2026-10-14T02:30:00Z"); // 13-10 23:30 en Paraguay
  const hoy = resolvePeriod("hoy", now);
  assert.equal(hoy.start.toISOString(), "2026-10-13T03:00:00.000Z");
  assert.equal(hoy.end.toISOString(), "2026-10-14T03:00:00.000Z");
  assert.deepEqual(hoy.days, ["2026-10-13"]);
  const semana = resolvePeriod("7d", new Date("2026-10-14T15:00:00Z"));
  assert.equal(semana.days.length, 7);
  assert.equal(semana.prevDays.length, 7);
  assert.equal(semana.prevEnd.getTime(), semana.start.getTime());
  assert.equal(semana.end.getTime() - semana.start.getTime(), semana.start.getTime() - semana.prevStart.getTime());
  const anterior = resolvePeriod("mes-anterior", new Date("2026-10-14T15:00:00Z"));
  assert.equal(anterior.days[0], "2026-09-01");
  assert.equal(anterior.days.at(-1), "2026-09-30");
  assert.equal(asuncionMidnight("2026-10-14").toISOString(), "2026-10-14T03:00:00.000Z");
  assert.deepEqual(computeDelta(5, 0), { kind: "nuevo" });
  assert.deepEqual(computeDelta(0, 0), { kind: "igual" });
  assert.deepEqual(computeDelta(150, 100), { kind: "pct", pct: 50, direction: "up" });
});

test("no queda el rango propio de tráfico: todo usa lib/platform/periods.ts", () => {
  assert.equal(existsSync(join(root, "lib", "platform", "trafico-range.ts")), false);
});

function walk(dir: string, files: string[] = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git" || name === ".claude") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(tsx?|jsx?)$/.test(name)) files.push(path);
  }
  return files;
}

test("fuente: el endpoint y la captura no guardan IP ni user agent", () => {
  const server = readFileSync(join(root, "lib/server/web-metrics.ts"), "utf8");
  const insert = server.match(/INSERT INTO "WebView" \(([^)]*)\)/)?.[1] ?? "";
  assert.ok(insert.includes('"visitorHash"'));
  assert.ok(!/ip|agent|\bua\b/i.test(insert), insert);
  const demoInsert = server.match(/INSERT INTO "DemoSession" \(([^)]*)\)/)?.[1] ?? "";
  assert.ok(!/ip|agent|\bua\b/i.test(demoInsert), demoInsert);
  const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
  for (const model of ["WebView", "DemoSession"]) {
    const block = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))![0];
    assert.ok(!/\b(ip|ipAddress|userAgent|ua)\b/i.test(block.replace(/\/\/\/.*$/gm, "")), `${model} no tiene columnas de IP/UA`);
  }
  // La IP y el UA solo entran al hash; no se pasan a ninguna escritura.
  assert.ok(!/record\.(ip|ua|userAgent)|ip:\s*getClientIp[\s\S]{0,40}schedule/.test(server));
  const route = readFileSync(join(root, "app/api/metrics/view/route.ts"), "utf8");
  assert.ok(!/Access-Control/i.test(route + server), "sin CORS abierto");
  assert.ok(/export async function POST/.test(route) && !/export async function (GET|PUT|PATCH|DELETE)/.test(route));
  const session = readFileSync(join(root, "app/api/demo/session/route.ts"), "utf8");
  assert.ok(/if \(!options\?\.reset\) scheduleDemoStart\(request\)/.test(session), "demo_start sale de /api/demo/session (no del reinicio)");
});

test("fuente: ningún 'use client' importa la base ni las consultas de plataforma", () => {
  const forbidden = [/@prisma\/client/, /@\/lib\/server\//, /lib\/server\/db/, /@\/lib\/platform\/(queries|guard|trafico-core)/, /node:crypto/, /\.\.\/.*lib\/server/];
  const offenders: string[] = [];
  for (const file of [...walk(join(root, "components")), ...walk(join(root, "app")), ...walk(join(root, "lib"))]) {
    const source = readFileSync(file, "utf8");
    if (!/^\s*["']use client["']/m.test(source.slice(0, 400))) continue;
    for (const line of source.split("\n")) {
      if (!/^\s*import\b/.test(line)) continue;
      if (forbidden.some((re) => re.test(line)) && !/import type/.test(line)) offenders.push(`${relative(root, file)}: ${line.trim()}`);
    }
  }
  const beacon = readFileSync(join(root, "components/analytics/PageBeacon.tsx"), "utf8");
  assert.match(beacon, /^"use client"/);
  assert.deepEqual(offenders.filter((o) => o.includes("components/analytics") || o.includes("platform")), []);
});

test("fuente: las consultas de tráfico están en lib/platform/queries, son de solo lectura y no usan filas sueltas", () => {
  const queries = readFileSync(join(root, "lib/platform/queries/trafico.ts"), "utf8");
  assert.ok(!/\$executeRaw|\.create\(|\.update\(|\.delete\(|INSERT |UPDATE |DELETE /.test(queries));
  assert.ok(!/\$queryRawUnsafe|\$executeRawUnsafe/.test(queries));
});

const HOST_NAMES: SiteHosts = { sitio: "ledbox.online", eventos: "eventos.ledbox.online", portal: "clientes.ledbox.online", demo: "demo.ledbox.online" };
const row = (host: string, views: number, over: Partial<HostRow> = {}): HostRow => ({
  host, isDemo: host === HOST_NAMES.demo, views, viewsPrev: 0, viewsDelta: { kind: "nuevo" }, visitors: views, sessions: views,
  avgSec: null, medianSec: null, avgScrollPct: null, bounceRate: null, ...over,
});

test("splitHosts: la demo va aparte y nunca suma a un sitio ni al total del negocio", () => {
  const rows = [row("demo.ledbox.online", 500), row("ledbox.online", 40), row("clientes.ledbox.online", 7)];
  const { sites, demo } = splitHosts(rows, HOST_NAMES);
  assert.deepEqual(sites.map((s) => [s.label, s.row?.views ?? null]), [["Sitio ledbox.online", 40], ["Landing EventOS", null], ["Portal de clientes", 7]]);
  assert.equal(demo?.views, 500);
  assert.equal(businessViews(rows, HOST_NAMES.demo), 47, "sin las 500 de la demo");
  // Una fila del host de la demo nunca se cuela como sitio, ni aunque llegue sin la marca isDemo.
  const unmarked = splitHosts([row("demo.ledbox.online", 9, { isDemo: false })], HOST_NAMES);
  assert.ok(unmarked.sites.every((s) => s.row === null));
  assert.equal(unmarked.demo?.views, 9);
  // Sin datos: cada sitio queda en null (la pantalla dice «sin datos todavía», no ceros).
  assert.ok(splitHosts([], HOST_NAMES).sites.every((s) => s.row === null));
});

test("formatos de Tráfico: duración, porcentaje y sitio del filtro", () => {
  assert.equal(formatDuration(null), "sin datos");
  assert.equal(formatDuration(42), "42 s");
  assert.equal(formatDuration(65), "1 min 05 s");
  assert.equal(formatPct(null), "sin datos");
  assert.equal(formatPct(33.3), "33,3 %");
  assert.equal(parseSite("eventos"), "eventos");
  assert.equal(parseSite("demo"), null, "la demo no es un sitio filtrable");
  assert.equal(parseSite(undefined), null);
});

test("fuente: la página Tráfico usa el guard, los chips, la demo aparte y «sin datos todavía»", () => {
  const page = readFileSync(join(root, "app/(superadmin)/superadmin/trafico/page.tsx"), "utf8");
  assert.match(page, /await requirePlatformAdmin\(\)/);
  assert.match(page, /<PeriodChips/);
  assert.match(page, /sin datos todavía/);
  assert.match(page, /Conversión demo → lead/);
  const card = readFileSync(join(root, "components/platform/SiteTrafficCard.tsx"), "utf8");
  assert.match(card, /Visitantes \(suma diaria\)/);
  assert.match(card, /No son personas únicas/);
  // Todo lo del negocio excluye el host de la demo; las vistas de la demo salen solo en su sección.
  assert.match(page, /excludeHost: demo/);
  const businessCalls = page.match(/get(Hoy|VistasPorDia|TopPaginas|TopReferrers|Dispositivos)\(.*$/gm) ?? [];
  assert.ok(businessCalls.length >= 5);
  for (const call of businessCalls) assert.match(call, /business|pagesScope|host:/, call);
  const demoSection = page.indexOf('aria-label="Demo"');
  assert.ok(demoSection > 0);
  assert.ok(!/demoRow(\.|\?|\))/.test(page.slice(page.indexOf("return ("), demoSection)), "las vistas de la demo (demoRow) solo se muestran dentro de la sección Demo");
  assert.ok(demoSection > page.indexOf("Vistas por día") && page.indexOf("demoRow") > demoSection || !page.slice(0, demoSection).includes("demoRow.views"));
  // Cada gráfico/tarjeta lleva su nota «fuente · cálculo».
  assert.ok((page.match(/platform-kpi-note/g) ?? []).length >= 9);
  const nav = readFileSync(join(root, "components/platform/PlatformShell.tsx"), "utf8");
  assert.match(nav, /key: "trafico", label: "Tráfico", href: "\/superadmin\/trafico"/);
});

test("fuente: los filtros de plataforma son un form GET de servidor, sin el kit de campos en el cliente", () => {
  const filter = readFileSync(join(root, "components/platform/FilterForm.tsx"), "utf8");
  assert.doesNotMatch(filter, /^\s*["']use client["']/m);
  assert.match(filter, /<form[^>]*method="get"/);
  for (const file of walk(join(root, "components/platform")).concat(walk(join(root, "app/(superadmin)")))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /@\/components\/admin\/AdminFields/, relative(root, file));
  }
});
