import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAGE_SIZE,
  SEARCH_LIMIT,
  likePattern,
  parsePage,
  parseTableParams,
  searchAllowed,
  totalPages,
  withParams,
  type Limiter,
} from "../lib/platform/tablas";
import { csvResponse } from "../lib/platform/csv-response";

const spec = { sorts: ["nombre", "alta", "monto"] as const, filterOptions: { activa: ["si", "no"] } };

test("parseTableParams valida orden, filtros, página y detalle contra listas cerradas", () => {
  const ok = parseTableParams({ q: "  Luz  ", orden: "-monto", activa: "si", pag: "3", detalle: "org_1-a" }, spec);
  assert.deepEqual(ok, { q: "Luz", filters: { activa: "si" }, sort: "monto", dir: "desc", page: 3, detail: "org_1-a" });
  const bad = parseTableParams({ orden: "hash; DROP TABLE", activa: "quizás", pag: "-4", detalle: "x'; --" }, spec);
  assert.equal(bad.sort, "nombre");
  assert.equal(bad.dir, "asc");
  assert.deepEqual(bad.filters, {});
  assert.equal(bad.page, 1);
  assert.equal(bad.detail, null);
  assert.equal(parseTableParams({ q: "x".repeat(500) }, spec).q.length, 80);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("abc"), 1);
});

test("paginación de a 30 y total de páginas", () => {
  assert.equal(PAGE_SIZE, 30);
  assert.equal(totalPages(0), 1);
  assert.equal(totalPages(30), 1);
  assert.equal(totalPages(31), 2);
  assert.equal(totalPages(95), 4);
});

test("likePattern escapa comodines para que el texto sea literal", () => {
  assert.equal(likePattern("50%_a\\b"), "%50\\%\\_a\\\\b%");
});

test("withParams conserva lo demás, reemplaza y quita", () => {
  const url = new URL(withParams("/superadmin/empresas", { q: "a", p: "7d", pag: "4", detalle: "z" }, { pag: undefined, orden: "-alta" }), "http://x");
  assert.equal(url.searchParams.get("q"), "a");
  assert.equal(url.searchParams.get("p"), "7d");
  assert.equal(url.searchParams.get("orden"), "-alta");
  assert.equal(url.searchParams.has("pag"), false);
  assert.equal(url.searchParams.get("detalle"), "z");
});

test("criterio 15: la búsqueda 121 en 15 min se niega, y sin texto no cuenta", async () => {
  let calls = 0;
  const limiter: Limiter = async (key, limit) => {
    assert.equal(key, "superadmin:buscar:u1");
    assert.equal(limit, SEARCH_LIMIT);
    calls += 1;
    return { allowed: calls <= limit, retryAfter: 60 };
  };
  for (let i = 1; i <= 120; i += 1) assert.equal(await searchAllowed("u1", "luz", limiter), true, `búsqueda ${i}`);
  assert.equal(await searchAllowed("u1", "luz", limiter), false, "la 121 se niega");
  const before = calls;
  assert.equal(await searchAllowed("u1", "", limiter), true);
  assert.equal(calls, before, "sin texto no gasta intentos");
});

test("si el limitador falla, la búsqueda se niega (cerrado) y queda el aviso", async () => {
  const warn = console.warn;
  const logged: unknown[][] = [];
  console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.equal(await searchAllowed("u1", "luz", async () => { throw new Error("base caída"); }), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(logged.length, 1);
});

test("CSV: =HYPERLINK sale con apóstrofo y los montos negativos quedan numéricos", async () => {
  const response = csvResponse("x.csv", ["Empresa", "Monto"], [["=HYPERLINK(\"http://x\")", -1500], ["+cmd", 2_000_000], ["@x", 0]]);
  const text = await response.text();
  assert.ok(text.includes("'=HYPERLINK("), text);
  assert.ok(text.includes("'+cmd"));
  assert.ok(text.includes("'@x"));
  assert.ok(/;-1500(\r?\n|$)/.test(text) || text.includes(",-1500") || text.includes("-1500"));
  assert.ok(!text.includes("'-1500"));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Type") ?? "", /text\/csv/);
});
