import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * Salidas de la demo (docs/DEMO-INTERACTIVA.md §3, criterios 8 y 9): una sandbox escribe, así que todo
 * lo que sale hacia afuera tiene que pasar por `salidaPermitida`. Test de fuente: si alguien agrega un
 * `fetch(`, un import de `resend` o un `wa.me` nuevo, falla acá y obliga a pasar por el punto central.
 */

const root = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", ".claude", "qa-local"]);

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const rel = (file: string) => relative(root, file).split("\\").join("/");
const code = (file: string) => readFileSync(file, "utf8");
/** Fuente sin comentarios (los comentarios pueden nombrar `fetch(` o `wa.me` sin llamarlos). */
const stripped = (file: string) => code(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sources = (...dirs: string[]) => dirs.flatMap((dir) => walk(join(root, dir))).filter((file) => /\.(ts|tsx|mjs|js|cjs)$/.test(file));

const ROUTES = sources("app/api").filter((file) => file.endsWith("/route.ts"));

test("solo lib/server/mail/transport.ts importa resend", () => {
  const offenders = sources("lib", "app", "components", "scripts")
    .filter((file) => /from\s+["']resend["']|require\(\s*["']resend["']\s*\)|import\(\s*["']resend["']\s*\)/.test(stripped(file)))
    .map(rel);
  assert.deepEqual(offenders, ["lib/server/mail/transport.ts"]);
});

test("solo mail/send.ts llama a sendThroughProvider, y siempre después de salidaPermitida(", () => {
  const callers = sources("lib", "app")
    .filter((file) => /\bsendThroughProvider\(/.test(stripped(file)) && rel(file) !== "lib/server/mail/transport.ts")
    .map(rel);
  assert.deepEqual(callers, ["lib/server/mail/send.ts"]);
  const send = stripped(join(root, "lib/server/mail/send.ts"));
  const gate = send.indexOf("salidaPermitida(");
  const provider = send.indexOf("sendThroughProvider(");
  assert.ok(gate > 0 && provider > gate, "salidaPermitida( va antes de sendThroughProvider(");
  assert.match(send, /canal:\s*"mail"/);
  assert.match(send, /"simulado" in salida/, "en sandbox no se envía");
});

/**
 * Usos de `fetch` en el servidor: la llamada (`fetch(`, `fetch (`), la global (`globalThis.fetch`, `global.fetch`,
 * `self.fetch`, `window.fetch`), el alias (`const f = fetch`) y pasarlo como valor (`fetch,` / `(fetch)`).
 * Un método con ese nombre (`cliente.fetch(`) no cuenta.
 */
const FETCH_USE = /(^|[^\w$.])fetch\s*\(|\b(globalThis|global|self|window)\s*(\.|\[\s*["'])\s*fetch\b|=\s*fetch\s*[;,)\n]|[(,]\s*fetch\s*[,)]|=\s*(globalThis|global|self|window)\b[^;\n]*\bfetch\b/;
/** Módulos de red: importados estático, con `import(` o con `require(`, con o sin `node:`. */
const NETWORK_MODULES = "https?|http2|net|tls|dgram|dns|undici|axios|got|node-fetch|cross-fetch|isomorphic-fetch|ky|superagent|needle|request|nodemailer|ws|socket\\.io-client";
const NETWORK_IMPORT = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|\\bimport\\s+)["'](?:node:)?(?:${NETWORK_MODULES})["']|XMLHttpRequest|new\\s+WebSocket\\(|\\bEventSource\\(`);

test("el detector de fetch y de módulos de red atrapa todas las formas", () => {
  for (const bad of [
    "await fetch(url)",
    "await fetch (url)",
    "globalThis.fetch(url)",
    "const f = globalThis.fetch;",
    "const f = fetch;",
    "const send = fetch\n",
    "run(fetch, url)",
    "window[\"fetch\"](url)",
  ]) assert.match(bad, FETCH_USE, bad);
  for (const ok of ["cliente.fetch(url)", "const prefetch = 1", "refetch()", "await fetchRuc(ruc)", "const fetched = []"]) assert.doesNotMatch(ok, FETCH_USE, ok);
  for (const bad of [
    'import http from "node:http"',
    'import { request } from "https"',
    'const net = require("node:net")',
    'const m = await import("undici")',
    'import axios from "axios"',
    'import got from "got"',
    'import fetch from "node-fetch"',
    'import "node:https"',
    "new XMLHttpRequest()",
  ]) assert.match(bad, NETWORK_IMPORT, bad);
  for (const ok of ['import { db } from "./db"', 'import path from "node:path"', 'import crypto from "node:crypto"', 'import { x } from "../lib/got-it"']) assert.doesNotMatch(ok, NETWORK_IMPORT, ok);
});

/** Los componentes `'use client'` corren en el navegador del visitante, no en el servidor: sus fetch no son salidas. */
const isClientComponent = (file: string) => /^\s*(["'])use client\1/.test(stripped(file));
const serverSources = (...dirs: string[]) => sources(...dirs).filter((file) => !isClientComponent(file));

test("el filtro de 'use client' reconoce la directiva", () => {
  const client = join(root, "components/admin/AdminShell.tsx");
  assert.ok(isClientComponent(client), "AdminShell es un componente de cliente");
  assert.ok(!isClientComponent(join(root, "lib/server/ruc.ts")));
});

test("todo fetch( de lib/** y app/** (server actions, rutas, páginas) está en una lista cerrada", () => {
  // ia-carga.ts: proveedor de IA externo (`fetchImpl = fetch`); su única ruta pasa por salidaPermitida (test de abajo).
  const ALLOWED = new Set(["lib/server/ruc.ts", "app/api/auth/callback/google/route.ts", "lib/server/ia-carga.ts"]);
  const offenders = serverSources("lib", "app")
    .filter((file) => FETCH_USE.test(stripped(file)) && !ALLOWED.has(rel(file)))
    .map(rel);
  assert.deepEqual(offenders, [], "una salida nueva debe pasar por salidaPermitida() y agregarse a esta lista a propósito");
  // Los clientes de red alternativos tampoco se cuelan (ni con import() ni con require(), ni en .js/.cjs).
  const clients = serverSources("lib", "app")
    .filter((file) => NETWORK_IMPORT.test(stripped(file)))
    .map(rel);
  assert.deepEqual(clients, []);
});

test("la «Carga con IA» (proveedor externo) pasa por salidaPermitida antes de llamar al proveedor", () => {
  const callers = sources("lib", "app").filter((file) => /\biaProviderDeConfig\(/.test(stripped(file)) && rel(file) !== "lib/server/ia-carga.ts").map(rel);
  assert.deepEqual(callers, ["app/api/admin/ia/carga/route.ts"]);
  const route = stripped(join(root, "app/api/admin/ia/carga/route.ts"));
  const post = route.slice(route.indexOf("export async function POST"));
  const gate = post.indexOf("salidaPermitida(");
  assert.ok(gate > 0 && gate < post.indexOf("iaProviderDeConfig("), "salidaPermitida( va antes del proveedor");
  assert.match(post, /canal:\s*"ia"/);
  assert.match(post, /"simulado" in salida/);
});

test("los únicos fetch( permitidos son la consulta de RUC y el token de Google", () => {
  assert.match(code(join(root, "lib/server/ruc.ts")), /fetch\(/);
  assert.match(code(join(root, "app/api/auth/callback/google/route.ts")), /oauth2\.googleapis\.com/);
});

test("pagos, SIFEN y webhooks, si existen, pasan por salidaPermitida", () => {
  const files = sources("lib/server", "app/api").filter((file) => /pagaya|sifen|webhook/i.test(rel(file)));
  for (const file of files) assert.match(stripped(file), /salidaPermitida\(/, `${rel(file)} no usa salidaPermitida(`);
});

test("wa.me se arma en un solo helper (lib/whatsapp-link.ts)", () => {
  const offenders = sources("lib", "app", "components")
    .filter((file) => /wa\.me|api\.whatsapp\.com|whatsapp:\/\//.test(stripped(file)) && rel(file) !== "lib/whatsapp-link.ts")
    .map(rel);
  assert.deepEqual(offenders, []);
  const helper = code(join(root, "lib/whatsapp-link.ts"));
  assert.match(helper, /if \(options\.sandbox\) return null/, "en sandbox el helper devuelve null");
});

test("las rutas prohibidas en la demo pasan sandbox: \"deny\" en cada método que escribe", () => {
  const PROHIBIDAS = [
    "app/api/admin/api-tokens/route.ts",
    "app/api/admin/api-tokens/[id]/route.ts",
    "app/api/admin/invitations/route.ts",
    "app/api/admin/invitations/[id]/route.ts",
    "app/api/admin/users/route.ts",
    "app/api/admin/profile/password/route.ts",
    "app/api/admin/profile/pin/route.ts",
    "app/api/admin/plan/requests/route.ts",
  ];
  for (const path of PROHIBIDAS) {
    const source = stripped(join(root, path));
    const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
    assert.ok(handlers.length > 0, path);
    handlers.forEach((match, i) => {
      if (match[1] === "GET") return;
      const body = source.slice(match.index!, handlers[i + 1]?.index ?? source.length);
      assert.match(body, /requireAdminContext\([^)]*sandbox:\s*"deny"/, `${path} ${match[1]} sin sandbox: "deny"`);
    });
  }
  // Ninguna ruta nueva cambia correo, clave, PIN, Google, slug o plan sin la marca.
  const sensibles = ROUTES.filter((file) => /\/(api-tokens|invitations|users|password|pin|google|slug|email|plan\/requests)(\/|$)/.test(rel(file)) && rel(file).startsWith("app/api/admin/"))
    .filter((file) => /export async function (POST|PATCH|PUT|DELETE)/.test(code(file)));
  for (const file of sensibles) {
    if (file.includes("/avatars/")) continue;
    assert.match(stripped(file), /sandbox:\s*"deny"/, `${rel(file)} escribe y no tiene sandbox: "deny"`);
  }
});

test("tenancy: el 403 de la demo cubre cookie y API key, y context.sandbox existe", () => {
  const source = stripped(join(root, "lib/server/tenancy.ts"));
  assert.equal((source.match(/SANDBOX_DENIED_MESSAGE/g) ?? []).length, 3, "import + las dos ramas");
  assert.match(source, /sandbox: boolean/);
  assert.match(source, /demo: demo \|\| sandbox/, "la actividad de una sandbox se marca como demo");
  const bearer = source.slice(source.indexOf("async function requireApiTokenContext"));
  assert.match(bearer, /options\?\.sandbox === "deny"/);
});

test("toda ruta que escribe columnas Bytes llama a cuotaArchivosOk(", () => {
  const writers = ROUTES.filter((file) => /parseImageUpload\(|\.arrayBuffer\(\)/.test(stripped(file)));
  assert.ok(writers.length >= 6, "se detectan las rutas de archivos");
  for (const file of writers) assert.match(stripped(file), /cuotaArchivosOk\(/, `${rel(file)} guarda archivos sin cuota de la demo`);
});

test("el plan, el sitio público y los números reales dejan afuera a la demo", () => {
  const plan = stripped(join(root, "lib/server/plan-limits.ts"));
  const fn = plan.slice(plan.indexOf("export async function planLimitViolation"));
  assert.ok(fn.indexOf("isSandboxOrg(") > 0 && fn.indexOf("isSandboxOrg(") < fn.indexOf("resolveOrganizationPlan("), "sin tope de plan en una sandbox");
  const tenancy = stripped(join(root, "lib/server/tenancy.ts"));
  const fallback = tenancy.slice(tenancy.indexOf("export async function resolveDefaultOrganizationId"));
  assert.equal((fallback.match(/isDemo: false/g) ?? []).length, 2, "por slug y por antigüedad");
  assert.match(stripped(join(root, "lib/server/catalog-public.ts")), /NOT:\s*\{\s*isDemo: true,\s*demoParentId:\s*\{\s*not:\s*null/);
  assert.match(stripped(join(root, "lib/platform/sin-demo.ts")), /"isDemo" = false/);
  // El sitemap no lista empresas; si algún día las lista, que filtre isDemo.
  const sitemap = stripped(join(root, "app/sitemap.ts"));
  assert.ok(!/organization\./.test(sitemap) || /isDemo/.test(sitemap), "sitemap con empresas debe excluir isDemo");
});
