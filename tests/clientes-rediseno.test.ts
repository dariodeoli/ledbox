import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { asuncionMonth, clientPrimaryAction, isDormant, lastClientEvent, matchesKpi, portfolioKpis } from "../lib/client-portfolio";

const repoFile = (path: string) => readFileSync(path, "utf8");
const NOW = new Date("2026-10-13T15:00:00Z").getTime();

function client(over: Record<string, unknown> = {}) {
  return {
    type: "FINAL" as const,
    active: true,
    createdAt: "2026-01-10T12:00:00Z",
    catalogLinkActive: false,
    metrics: { balance: 0, lastActivityAt: "2026-09-01T12:00:00Z" as string | null },
    ...over,
  };
}

test("KPIs de la cartera: cada uno cuenta lo mismo que filtra", () => {
  const list = [
    client(),
    client({ active: false, metrics: { balance: 500_000, lastActivityAt: "2026-09-20T00:00:00Z" } }),
    client({ type: "RESELLER", catalogLinkActive: true, createdAt: "2026-10-02T12:00:00Z" }),
    client({ type: "RESELLER", catalogLinkActive: false }),
    client({ type: "FINAL", catalogLinkActive: true }), // link sin ser mayorista: no cuenta
    client({ metrics: { balance: 250_000, lastActivityAt: "2026-02-01T00:00:00Z" } }),
  ];
  const kpis = portfolioKpis(list, NOW);
  assert.equal(kpis.total, 6);
  assert.equal(kpis.active, 5);
  assert.equal(kpis.withBalance, 2);
  assert.equal(kpis.balanceAmount, 750_000);
  assert.equal(kpis.wholesaleLink, 1);
  assert.equal(kpis.resellers, 2);
  assert.equal(kpis.newThisMonth, 1);
  assert.equal(kpis.dormant, 1);
  for (const [key, count] of [["ACTIVE", 5], ["BALANCE", 2], ["WHOLESALE_LINK", 1], ["NEW_MONTH", 1], ["DORMANT", 1]] as const) {
    assert.equal(list.filter((item) => matchesKpi(item, key, NOW)).length, count, key);
  }
});

test("sin actividad: un cliente recién cargado y sin movimientos no figura dormido", () => {
  assert.equal(isDormant(client({ createdAt: "2026-10-01T00:00:00Z", metrics: { balance: 0, lastActivityAt: null } }), NOW), false);
  assert.equal(isDormant(client({ createdAt: "2025-01-01T00:00:00Z", metrics: { balance: 0, lastActivityAt: null } }), NOW), true);
  assert.equal(isDormant(client({ metrics: { balance: 0, lastActivityAt: "2026-04-14T00:00:00Z" } }), NOW), false);
  assert.equal(isDormant(client({ metrics: { balance: 0, lastActivityAt: "2026-04-12T00:00:00Z" } }), NOW), true);
});

test("el mes de alta se mide en el calendario de Asunción", () => {
  // 01-11 01:00 UTC es 31-10 22:00 en Asunción (UTC-3): todavía es octubre para el negocio.
  assert.equal(asuncionMonth("2026-11-01T01:00:00Z"), "2026-10");
  assert.equal(asuncionMonth("2026-11-01T04:00:00Z"), "2026-11");
});

test("acción principal de la ficha: cobrar > seguir presupuesto > nuevo, siempre con permiso", () => {
  const sent = [{ id: "b1", status: "SENT", createdAt: "2026-09-01T00:00:00Z" }, { id: "b2", status: "SENT", createdAt: "2026-09-10T00:00:00Z" }, { id: "b0", status: "APPROVED", createdAt: "2026-09-20T00:00:00Z" }];
  const all = { collect: true, quote: true };
  assert.deepEqual(clientPrimaryAction({ metrics: { overdue: 10 }, budgets: sent }, all)?.kind, "collect");
  const follow = clientPrimaryAction({ metrics: { overdue: 0 }, budgets: sent }, all);
  assert.equal(follow?.kind, "follow");
  assert.equal(follow?.kind === "follow" ? follow.budgetId : "", "b2", "el enviado más reciente");
  assert.equal(clientPrimaryAction({ metrics: { overdue: 0 }, budgets: [] }, all)?.kind, "quote");
  // Sin permiso de finanzas, la deuda no ofrece «Cobrar»: pasa a la siguiente permitida.
  assert.equal(clientPrimaryAction({ metrics: { overdue: 10 }, budgets: sent }, { collect: false, quote: true })?.kind, "follow");
  // VIEWER: ninguna acción mutante.
  assert.equal(clientPrimaryAction({ metrics: { overdue: 10 }, budgets: sent }, { collect: false, quote: false }), null);
});

test("último evento: el más reciente ya iniciado y no cancelado", () => {
  const events = [
    { id: "a", startsAt: "2026-05-01T00:00:00Z", status: "COMPLETED" },
    { id: "b", startsAt: "2026-09-01T00:00:00Z", status: "CANCELLED" },
    { id: "c", startsAt: "2026-08-01T00:00:00Z", status: "COMPLETED" },
    { id: "d", startsAt: "2026-12-01T00:00:00Z", status: "CONFIRMED" },
    { id: "e", startsAt: null, status: "DRAFT" },
  ];
  assert.equal(lastClientEvent(events, NOW)?.id, "c");
  assert.equal(lastClientEvent([], NOW), null);
});

test("lista de Clientes: KPIs-filtro, segmentos reales, búsqueda y una acción por fila", () => {
  const module = repoFile("components/admin/modules/ClientesModule.tsx");
  for (const label of ["Activos", "Con saldo pendiente", "Mayoristas con link", "Nuevos del mes", "Sin actividad"]) assert.ok(module.includes(`label="${label}"`), label);
  assert.equal((module.match(/onSelect=\{\(\) => toggleKpi\(/g) ?? []).length, 5, "cada KPI filtra al tocarlo");
  assert.match(module, /CLIENT_SEGMENTS\.map/);
  assert.match(module, /Buscar por nombre, RUC, teléfono o correo/);
  assert.match(module, /<AdminActionsMenu label=\{`Más acciones de \$\{name\}`\}/, "el resto va en «•••»");
  assert.match(module, /action=\{\s*writable \?/, "Nuevo cliente solo con permiso de escritura");
  assert.match(module, /canQuote \?/, "Nuevo presupuesto solo con permiso de presupuestos");
  // Acciones que ya existían: siguen todas en el menú.
  for (const item of ["Ver ficha", "Nuevo presupuesto", "WhatsApp con plantilla", "Abrir WhatsApp", "Enviar correo", "Ver Instagram", "Abrir sitio web", "Editar"]) {
    assert.ok(module.includes(`label: "${item}"`), `falta «${item}» en el menú de la fila`);
  }
  assert.match(module, /if \(writable\) items\.push\(\{ label: "Editar"/, "Editar solo con permiso");
});

test("lista y alta de Clientes separan empresa, representante legal y contacto; RUC se consulta con Enter", () => {
  const module = repoFile("components/admin/modules/ClientesModule.tsx");
  const form = repoFile("components/admin/modules/ClientQuickForm.tsx");
  const fiscal = repoFile("components/admin/modules/ClientFiscalFields.tsx");
  const css = repoFile("app/globals.css");
  assert.match(form, /label="Representante legal"/);
  assert.match(form, /label="Empresa"/);
  assert.match(form, /Nombre fantasía \/ comercial/);
  assert.match(form, /Nombre del encargado/);
  assert.match(fiscal, /event\.key === "Enter"/);
  assert.match(fiscal, /if \(inFlight\.current \|\| !ruc\.trim\(\)\) return/);
  assert.match(fiscal, /onChange\(\{ ruc: result\.data\.fullRuc, legalName: result\.data\.name,[\s\S]{0,220}rucConfirmationToken/);
  assert.doesNotMatch(fiscal, /Confirmar RUC y razón social/);
  assert.match(module, /Empresa \/ contacto comercial/);
  assert.match(module, /Representante legal/);
  assert.match(module, /cardView = narrow \|\| view === "grid"/);
  assert.match(css, /\.admin-table--clientes \{ --clientes-cols: minmax\(12rem,[^}]*minmax\(9rem,/);
});

test("lista de Clientes: el link mayorista sale de un agregado acotado por empresa", () => {
  const route = repoFile("app/api/admin/clients/route.ts");
  assert.match(route, /catalogAccessToken\.groupBy\(\{[\s\S]{0,200}where: \{ organizationId, clientId: \{ in: clientIds \}, revokedAt: null \}/);
  assert.match(route, /catalogLinkActive: withCatalogLink\.has\(client\.id\)/);
});

test("ficha: acción principal, franja de indicadores, links a presupuesto/evento y catálogo mayorista", () => {
  const ficha = repoFile("components/admin/modules/ClienteFichaModule.tsx");
  assert.match(ficha, /clientPrimaryAction\(detail, \{ collect: canWriteFinance\(role\), quote: canQuote \}\)/);
  assert.match(ficha, /\/presupuestos\?detalle=\$\{encodeURIComponent\(budget\.id\)\}/, "cada presupuesto abre su detalle");
  assert.match(ficha, /\/eventos\?evento=\$\{encodeURIComponent\(event\.id\)\}/, "cada evento abre su ficha");
  for (const label of ["Contratado", "Cobrado", "Saldo", "Eventos", "Último evento"]) assert.ok(ficha.includes(`label="${label}"`), label);
  assert.match(ficha, /client\.type === "RESELLER" \? \(\s*<ClientCatalogAccess/, "el catálogo mayorista se ofrece a los mayoristas");
  const legacy = ficha.slice(ficha.indexOf("function NonWholesaleCatalog"), ficha.indexOf("function BudgetsTab"));
  assert.match(legacy, /if \(status\.data\)[\s\S]*<ClientCatalogAccess/, "un no mayorista con link activo puede revocarlo");
  assert.ok(legacy.includes("Este cliente ya no es mayorista pero tiene un link activo: revocalo si no corresponde."));
  assert.match(ficha, /tabId=\{\(key\) => `ficha-tab-\$\{key\}`\}[\s\S]{0,120}panelId=\{\(\) => "ficha-panel"\}/, "cada pestaña (AdminTabs) con su id y aria-controls");
  const route = repoFile("app/api/admin/clients/route.ts");
  assert.match(route, /take: \(bulk\?\.limit \?\? CLIENT_LIST_LIMIT\) \+ 1/);
  assert.match(route, /Response\.json\(\{ clients: rows, truncated \}\)/);
  assert.ok(repoFile("components/admin/modules/ClientesModule.tsx").includes("Mostrando hasta 200 coincidencias: los indicadores corresponden a estos resultados. La búsqueda consulta toda la cartera."));
  assert.match(ficha, /canWriteClients\(role\)/);
  const css = repoFile("app/globals.css");
  assert.match(css, /\.admin-kpis\.admin-kpis--ficha \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\); \}/, "la franja de la ficha son cinco indicadores en una fila");
  assert.match(css, /\.admin-ficha-main > \.admin-subtabs \{ flex-wrap: nowrap; overflow-x: auto; \}/, "las pestañas se desplazan en móvil");
  assert.match(css, /\.admin-ficha-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/, "la columna lateral pasa debajo");
});


test("GET real de Clientes conserva tope/truncated normal y usa el límite acreditado sólo en modo bulk", async () => {
  const ts = (await import("typescript")).default;
  const { runInNewContext } = await import("node:vm");
  for (const scenario of [{ bulk: false, total: 201, expected: 200, truncated: true }, { bulk: false, total: 2, expected: 2, truncated: false }, { bulk: true, total: 18, expected: 17, truncated: false }]) {
    const queries: any[] = [];
    const rows = Array.from({ length: scenario.total }, (_, index) => ({ id: String(index), name: `Cliente ${index}`, logo: null }));
    const meta = { total: 30, nextCursor: "signed", complete: false, snapshotAt: "2026-10-16T12:00:00Z" };
    const exports: any = {};
    runInNewContext(ts.transpileModule(repoFile("app/api/admin/clients/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, Request, Response, URL, Set,
      require(name: string) {
        if (name.endsWith("/tenancy")) return { requireAdminContext: async () => ({ ok: true, context: { organizationId: "own" } }) };
        if (name.endsWith("/bulk-selection")) return { readBulkSelection: async () => scenario.bulk ? { limit: 17, where: { id: { gt: "cursor" } }, watermark: {}, total: 30, finish: async () => ({ meta }) } : null };
        if (name.endsWith("/db")) return { db: { client: { findMany: async (query: any) => { queries.push(query); return rows; } }, budget: { findMany: async () => [] }, clientPayment: { findMany: async () => [] }, event: { findMany: async () => [] }, catalogAccessToken: { groupBy: async () => [] } } };
        if (name === "./metrics") return { factsByClient: () => new Map(), clientMetrics: () => ({}) };
        if (name.endsWith("/trash-filter")) return { live: { deletedAt: null } };
        return {};
      },
    });
    const response = await exports.GET(new Request(`https://local.invalid/api/admin/clients?q=Ana${scenario.bulk ? "&fields=bulk-selection" : ""}`));
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.clients.length, scenario.expected); assert.equal(body.truncated, scenario.truncated);
    assert.equal(queries[0].take, scenario.bulk ? 18 : 201);
    assert.equal(queries[0].where.organizationId, "own");
    assert.equal(queries[0].where.OR[0].name.contains, "Ana", "la búsqueda se filtra antes del límite");
    assert.equal(body.bulkSelection?.nextCursor, scenario.bulk ? "signed" : undefined);
    assert.equal(queries[0].where.id?.gt, scenario.bulk ? "cursor" : undefined);
  }
});
