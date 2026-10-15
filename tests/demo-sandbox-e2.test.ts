import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isValidNs, makeSeedIds, newSandboxNs, wrapTx } from "../lib/server/demo-ns";
import { sandboxVigente, SANDBOX_IDLE_MS } from "../lib/server/demo-sandbox";

/**
 * Demo interactiva E2 (docs/DEMO-INTERACTIVA.md §1 y §2): reescritura del seed por `ns`, vigencia de la sandbox
 * y tests de fuente de la separación por host (401 cruzado), la cookie, los topes y las rutas del portal.
 * Lo que necesita Postgres vive en `demo-sandbox.pg.test.ts`.
 */

const root = process.cwd();
const src = (path: string) =>
  readFileSync(join(root, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("ns: 10 caracteres base32 al azar", () => {
  const seen = new Set(Array.from({ length: 200 }, () => newSandboxNs()));
  assert.equal(seen.size, 200);
  for (const ns of seen) assert.ok(isValidNs(ns), ns);
  assert.equal(isValidNs("demo"), false);
  assert.throws(() => makeSeedIds("../x"));
});

test("seed: ids demo_ pasan a sbx_<ns>_, correos a +<ns>, y la reescritura es idempotente", () => {
  const ids = makeSeedIds("abcdefghij");
  assert.equal(ids.sid("client_tigo"), "sbx_abcdefghij_client_tigo");
  assert.equal(ids.mapString("demo_client_tigo"), "sbx_abcdefghij_client_tigo");
  assert.equal(ids.mapString("demo_client_logo_demo_client_tigo"), "sbx_abcdefghij_client_logo_sbx_abcdefghij_client_tigo");
  assert.equal(ids.mapString("demo_visitor"), "sbx_abcdefghij_visitor");
  assert.equal(ids.mapString("valeria.ortiz@ledbox.demo"), "valeria.ortiz+abcdefghij@ledbox.demo");
  assert.equal(ids.mapString("eventos@tigo.demo"), "eventos@tigo.demo", "los correos de clientes no cambian");
  assert.equal(ids.mapString("org_demo"), "org_demo", "solo el prefijo demo_ al comienzo de un id");
  assert.equal(ids.mapString("Evento demo_x"), "Evento sbx_abcdefghij_x");
  for (const value of ["demo_budget_aprobado", "valeria.ortiz@ledbox.demo", "D3M9-5G97-4XKW-2M8R-T3HN", "demo-pedido-nuevo-0001"]) {
    const once = ids.mapString(value);
    assert.equal(ids.mapString(once), once, `idempotente: ${value}`);
  }
});

test("seed: tokens y códigos al azar por sandbox, estables dentro de una sandbox", () => {
  const a = makeSeedIds("aaaaaaaaaa");
  const b = makeSeedIds("bbbbbbbbbb");
  for (const literal of ["D3M9-5G97-4XKW-2M8R-T3HN", "demo-pedido-nuevo-0001", "lbxw_demo-agencia-pixel-mayorista-0001", "D3M0-ROC1-9F7K-2QW4"]) {
    assert.notEqual(a.tk(literal), literal);
    assert.equal(a.tk(literal), a.tk(literal), "estable");
    assert.notEqual(a.tk(literal), b.tk(literal), "distinto por sandbox");
    assert.equal(a.mapString(literal), a.tk(literal), "el borde de escritura usa el mismo token");
  }
  assert.match(a.tk("D3M9-5G97-4XKW-2M8R-T3HN"), /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){4}$/, "con la forma del código del portal");
  assert.match(a.tk("lbxw_demo-agencia-pixel-mayorista-0001"), /^lbxw_/);
  assert.notEqual(a.codeSalt, b.codeSalt);
});

test("seed: mapDeep respeta fechas, buffers y valores de Prisma", () => {
  const ids = makeSeedIds("abcdefghij");
  const date = new Date("2026-10-14T10:00:00Z");
  const bytes = new Uint8Array([1, 2, 3]);
  const buffer = Buffer.from("demo_x");
  class Marker {}
  const marker = new Marker();
  const out = ids.mapDeep({ id: "demo_a", when: date, data: bytes, buf: buffer, marker, nested: { list: ["demo_b", 3, null] }, none: null });
  assert.equal(out.id, "sbx_abcdefghij_a");
  assert.equal(out.when, date);
  assert.equal(out.data, bytes);
  assert.equal(out.buf, buffer);
  assert.equal(out.marker, marker);
  assert.deepEqual(out.nested, { list: ["sbx_abcdefghij_b", 3, null] });
});

test("seed: wrapTx reescribe los argumentos de los modelos y no toca el SQL crudo", async () => {
  const ids = makeSeedIds("abcdefghij");
  const seen: unknown[] = [];
  const fake = {
    client: { createMany: async (args: unknown) => seen.push(args), findMany: async (args: unknown) => seen.push(args) },
    $queryRawUnsafe: async (sql: string) => seen.push(sql),
  };
  const tx = wrapTx(fake, ids);
  await tx.client.createMany({ data: [{ id: "demo_client_tigo", email: "eventos@tigo.demo" }] });
  await tx.client.findMany({ where: { id: { in: ["demo_client_lg"] } } });
  await tx.$queryRawUnsafe("select 'demo_x'");
  assert.deepEqual(seen, [
    { data: [{ id: "sbx_abcdefghij_client_tigo", email: "eventos@tigo.demo" }] },
    { where: { id: { in: ["sbx_abcdefghij_client_lg"] } } },
    "select 'demo_x'",
  ]);
});

test("vigencia: 1 h sin uso o 24 h desde la creación, lo que llegue primero", () => {
  const now = Date.UTC(2026, 9, 14, 12, 0, 0);
  const created = new Date(now - 10 * 60_000);
  const base = { demoReady: true, demoExpiresAt: new Date(now + 23 * 3_600_000), demoLastSeenAt: new Date(now - 10 * 60_000), createdAt: created };
  assert.equal(sandboxVigente(base, now), true);
  assert.equal(sandboxVigente({ ...base, demoLastSeenAt: new Date(now - SANDBOX_IDLE_MS - 1) }, now), false, "más de 1 h sin uso");
  assert.equal(sandboxVigente({ ...base, demoLastSeenAt: new Date(now - SANDBOX_IDLE_MS + 60_000) }, now), true);
  assert.equal(sandboxVigente({ ...base, demoExpiresAt: new Date(now - 1) }, now), false, "pasaron las 24 h");
  assert.equal(sandboxVigente({ ...base, demoReady: false }, now), false, "sin sembrar no abre");
  assert.equal(sandboxVigente({ ...base, demoLastSeenAt: null, createdAt: new Date(now - 2 * 3_600_000) }, now), false, "sin uso registrado cuenta desde la creación");
});

test("401 cruzado: getAuthenticatedAdmin lee una cookie u otra según el host y valida la empresa contra el host", () => {
  const auth = src("lib/server/auth.ts");
  const fn = auth.slice(auth.indexOf("export async function getAuthenticatedAdmin"));
  assert.match(fn, /onSandboxHost\(\)/);
  assert.match(fn, /demoHost \? authConfig\.demoCookieName : authConfig\.sessionCookieName/);
  assert.match(fn, /sessionMatchesHost\(session, demoHost\)/);
  assert.match(auth, /isDemoOrg !== demoHost\) return false/, "empresa de la demo en host real, o real en host demo, es sesión inválida");
  assert.match(auth, /sandboxVigente\(organization, now\)/, "una sandbox vencida no abre aunque no se haya purgado");
  assert.match(auth, /demoLastSeenAt/);
  assert.match(auth, /SANDBOX_TOUCH_INTERVAL_MS/);
  assert.match(auth, /after\(work\)/, "demoLastSeenAt se escribe en after()");
  // Cookie de la demo: httpOnly, Lax, Secure en producción y sin domain (solo el host demo).
  const cookie = auth.slice(auth.indexOf("export async function setDemoSessionCookie"), auth.indexOf("export async function clearDemoSessionCookie"));
  assert.match(cookie, /httpOnly: true/);
  assert.match(cookie, /sameSite: "lax"/);
  assert.match(cookie, /secure: process\.env\.NODE_ENV === "production"/);
  assert.doesNotMatch(cookie, /domain/);
  assert.match(src("lib/server/config.ts"), /demoCookieName: "ledbox_demo"/);
  const tenancy = src("lib/server/tenancy.ts");
  assert.match(tenancy, /\(demo \|\| sandbox\) !== \(await onSandboxHost\(\)\)[\s\S]{0,120}"Unauthorized", 401/, "requireAdminContext también corta el cruce");
});

test("host demo: solo demo.<dominio> (y demo.localhost en desarrollo)", async () => {
  const { isDemoHostName } = await import("../lib/server/demo-host");
  assert.equal(isDemoHostName("demo.ledbox.online"), true);
  assert.equal(isDemoHostName("DEMO.ledbox.online:3000"), true);
  assert.equal(isDemoHostName("app.ledbox.online"), false);
  assert.equal(isDemoHostName("clientes.ledbox.online"), false);
  assert.equal(isDemoHostName(""), false);
  assert.equal(isDemoHostName("demo.ledbox.online.evil.com"), false);
  assert.equal(isDemoHostName("demo.localhost:3000"), process.env.NODE_ENV !== "production");
});

test("/api/demo/session: sandbox solo en el host demo, reiniciar, DELETE, topes y aviso de vencida", () => {
  const route = src("app/api/demo/session/route.ts");
  assert.match(route, /DEMO_SANDBOX_ENABLED/);
  assert.match(route, /onSandboxHost\(\)/);
  // Crear solo por POST, con Origin/Referer del host demo y sin bots; el GET muestra la entrada y no siembra.
  const enter = route.slice(route.indexOf("async function enterSandbox"), route.indexOf("function sameHostOrigin"));
  assert.ok(enter.indexOf('request.method !== "POST"') > 0 && enter.indexOf('request.method !== "POST"') < enter.indexOf("createSandbox("), "el GET no crea");
  assert.ok(enter.indexOf("sameHostOrigin(request)") < enter.indexOf("createSandbox(") && enter.indexOf("isBotUa(") < enter.indexOf("createSandbox("));
  assert.match(route, /Entrar a la demo/);
  assert.match(route, /method="post" action="\/api\/demo\/session"/);
  assert.match(route, /rateLimit\(`demo:session:\$\{trustedIp\(request\)\}`/, "el límite de handleEntry usa la IP confiable");
  assert.doesNotMatch(route, /getClientIp/);
  assert.match(route, /createSandbox\(\{ ip: trustedIp\(request\) \}\)/, "el tope por IP usa el IP confiable, no el primer XFF");
  assert.match(route, /setDemoSessionCookie\(/);
  assert.match(route, /createSession\(sandbox\.user, sandbox\.organizationId, \{ expiresAt: sandbox\.expiresAt \}\)/);
  assert.match(route, /rateLimitResponse\(created\.retryAfter/, "5.ª creación por IP: 429");
  assert.match(route, /\/demo-llena/, "llena: página sin acceso");
  assert.match(route, /after\(purgeExpiredSafely\)/, "purga perezosa en after()");
  assert.match(route, /purgeSandbox\(currentOrgId\)/, "reiniciar purga la anterior");
  assert.match(route, /export async function DELETE[\s\S]*purgeSandbox\(organizationId\)[\s\S]*clearDemoSessionCookie\(\)/);
  assert.match(route, /ledbox_demo_aviso/);
  assert.match(route, /scheduleDemoSandboxLink\(/, "DemoSession.sandboxOrgId");
  // Con la vuelta atrás apagada rige la vitrina de siempre.
  assert.match(route, /if \(!DEMO_SANDBOX_ENABLED\) return enterShowcase/);
  assert.match(src("lib/server/demo-sandbox.ts"), /export const DEMO_SANDBOX_ENABLED = true/);
});

test("sandboxes: alta en dos pasos con advisory lock, topes, SKIP LOCKED y purga que guarda las acciones", () => {
  const lib = src("lib/server/demo-sandboxes.ts");
  assert.match(lib, /pg_advisory_xact_lock\(hashtext\('demo-sandbox'\)\)/);
  assert.match(lib, /demoReady: false/);
  assert.match(lib, /data: \{ demoReady: true/);
  assert.equal((lib.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length, 3, "purga puntual, vencidas y ociosa");
  assert.match(lib, /clearSandboxCache\(ids\.organizationId\)/, "una sandbox recién creada no pasa por empresa real");
  const sandbox = src("lib/server/demo-sandbox.ts");
  assert.match(sandbox, /SANDBOX_MAX_ACTIVE = 150/);
  assert.match(sandbox, /SANDBOX_PER_IP_PER_HOUR = 4/);
  assert.match(sandbox, /SANDBOX_CREATIONS_PER_15_MIN = 60/);
  assert.match(sandbox, /SANDBOX_PURGE_BATCH = 5/);
  assert.match(sandbox, /SANDBOX_FULL_IDLE_MS = 30 \* 60 \* 1000/);
  const purge = lib.slice(lib.indexOf("export async function deleteSandboxRows"), lib.indexOf("export async function purgeSandbox"));
  assert.ok(purge.indexOf("demoSession.update") > 0 && purge.indexOf("demoSession.update") < purge.indexOf("wipeDemoData("), "las acciones se anotan antes de borrar");
  assert.ok(purge.indexOf("wipeDemoData(") < purge.indexOf("organization.delete"));
  assert.match(purge, /adminUser\.deleteMany\(\{ where: \{ demoOrganizationId/);
  assert.match(purge, /!org\.isDemo \|\| !org\.demoParentId\) return false/, "nunca borra otra cosa que una sandbox");
  assert.match(src("scripts/demo-purge.mjs"), /purgeExpiredSandboxes/);
});

test("portal, firma y comparativas de una sandbox: 404 fuera del host demo (criterio 18)", () => {
  const guarded: Array<[string, RegExp]> = [
    ["lib/server/budget-portal.ts", /sandboxHiddenHere\(budget\.organizationId\)\) return null/],
    ["lib/server/signature/portal.ts", /sandboxHiddenHere\(row\.organizationId\)\)\) return null/],
    ["lib/server/quote-comparison.ts", /sandboxHiddenHere\(group\.organizationId\)\)\) return null/],
  ];
  for (const [file, pattern] of guarded) assert.match(src(file), pattern, file);
  for (const route of ["approve", "propose", "proof", "revision", "client-logo", "items/[id]/image", "attachments/[id]"]) {
    assert.match(src(`app/api/portal/budget/[token]/${route}/route.ts`), /if \(await sandboxHiddenHere\(budget\.organizationId\)\) return jsonError\([^)]*404\)/, route);
  }
  assert.match(src("lib/server/signature/portal.ts"), /loadSignatureImage[\s\S]*sandboxHiddenHere\(request\.organizationId\)/);
});

test("QA E1: sendMail falla cerrado y tenancy captura el error de isSandboxOrg", () => {
  const send = src("lib/server/mail/send.ts");
  const gate = send.slice(send.indexOf("let salida"), send.indexOf("if (\"simulado\" in salida)"));
  assert.match(gate, /catch \(error\)/);
  assert.match(gate, /status: "skipped"/);
  assert.match(gate, /return /, "no sigue al proveedor");
  const tenancy = src("lib/server/tenancy.ts");
  assert.match(tenancy, /async function sandboxFlag[\s\S]*catch \(error\)[\s\S]*console\.error[\s\S]*return null/);
  assert.equal((tenancy.match(/await isSandboxOrg\(/g) ?? []).length, 1, "tenancy solo llama a isSandboxOrg a través de sandboxFlag");
});

test("seed: ensureDemoData marca la vitrina isDemo y la siembra de sandbox no toma el candado global", () => {
  const data = src("lib/server/demo-data.ts");
  assert.match(data, /isDemo: true,\s*\n\s*paymentDetails: DEMO_PAYMENT_DETAILS/, "al crear");
  assert.match(data, /!organization\.isDemo\) \{[\s\S]*isDemo: true/, "y al reponerla");
  assert.match(data, /if \(!ids\) \{\s*\n\s*await tx\.\$queryRawUnsafe\("select pg_advisory_xact_lock\(724150114\)/);
  assert.match(data, /export async function seedSandboxData\(organizationId: string, ns: string/);
  assert.match(data, /async function seedDemoData\(organizationId: string, base: Date, ns\?: string\)/);
});

test("WhatsApp: la sesión del panel expone sandbox y whatsappHref lo usa por defecto (solo en el navegador)", () => {
  assert.match(src("lib/server/admin-session.ts"), /const \{ user, organization, role, demo, sandbox \} = context;[\s\S]*\n    sandbox,/);
  const format = src("lib/admin-format.ts");
  assert.match(format, /if \(typeof window !== "undefined"\) whatsappSandbox = sandbox/, "nunca estado compartido en el servidor");
  assert.match(format, /sandbox: options\.sandbox \?\? whatsappSandbox/);
  const shell = src("components/admin/AdminShell.tsx");
  assert.equal((shell.match(/setWhatsappSandbox\(sandbox\)/g) ?? []).length, 2, "payload embebido y recarga de la sesión");
});

test("IP de confianza: TRUSTED_PROXY_HOPS en un solo lugar, compartida por web-metrics y los topes de la demo", async () => {
  const { TRUSTED_PROXY_HOPS, trustedIp } = await import("../lib/server/trusted-ip");
  assert.equal(TRUSTED_PROXY_HOPS, 1);
  const req = (headers: Record<string, string>) => new Request("https://demo.ledbox.online/", { headers });
  assert.equal(trustedIp(req({ "x-forwarded-for": "6.6.6.6, 190.1.1.1" })), "190.1.1.1", "el último; el primero lo escribe el cliente");
  assert.equal(trustedIp(req({ "x-forwarded-for": "190.1.1.1" })), "190.1.1.1");
  assert.equal(trustedIp(req({ "x-real-ip": "190.2.2.2" })), "190.2.2.2");
  assert.equal(trustedIp(req({})), "unknown");
  assert.match(src("lib/server/web-metrics.ts"), /from "@\/lib\/server\/trusted-ip"/);
  assert.equal((src("lib/server/web-metrics.ts") + src("app/api/demo/session/route.ts")).match(/TRUSTED_PROXY_HOPS/g), null, "la constante vive solo en trusted-ip.ts");
});
