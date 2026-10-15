import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { formatMoney, formatMoneyCompact } from "../lib/admin-format";
import {
  ADMIN_NAV,
  ADMIN_ROLES,
  adminNavGroups,
  adminNavIcon,
  adminNavLabel,
  isAdminNavItemActive,
} from "../lib/admin-policy";
import { ADMIN_ROUTES } from "../lib/admin-routes";
import type { AdminNotification } from "../lib/admin-types";
import { buildTodayActions, dayDiff, TODAY_ACTIONS_LIMIT, weekEventChip } from "../lib/resumen-actions";
import { monthWindow, parseBalance, weekWindow } from "../lib/server/resumen";

/**
 * Menú por etapas, Resumen nuevo y demo liviana (13-10-2026). Fija el orden del
 * menú por rol, que Firmas y Plantillas sigan siendo rutas con acceso visible,
 * la urgencia de «Para hacer hoy», los montos abreviados sin truncar y el
 * aislamiento por empresa de los endpoints nuevos.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const hrefsFor = (role: Parameters<typeof adminNavGroups>[0]) =>
  adminNavGroups(role).flatMap((group) => group.items.map((item) => item.href));

test("menú por rol: todos ven lo mismo salvo Estado, que es de OWNER/ADMIN", () => {
  const common = [
    "/dashboard",
    "/leads",
    "/presupuestos",
    "/eventos",
    "/clientes",
    "/inventario",
    "/proveedores",
    "/promotoras",
    "/finanzas",
    "/facturacion",
    "/ajustes",
  ];
  for (const role of ADMIN_ROLES) {
    const hrefs = hrefsFor(role);
    const withState = role === "OWNER" || role === "ADMIN";
    assert.deepEqual(hrefs, withState ? [...common, "/estado"] : common, `${role}: menú distinto del esperado`);
  }
  // Sin sesión resuelta (rol desconocido) tampoco se ve Estado.
  assert.equal(hrefsFor(null).includes("/estado"), false);
  assert.equal(hrefsFor(undefined).includes("/estado"), false);
});

test("Ventas es un flujo ordenado lead → presupuesto → evento con contadores reales", () => {
  const ventas = adminNavGroups("VIEWER").find((group) => group.label === "Ventas");
  assert.ok(ventas?.flow, "Ventas se dibuja unida por una línea");
  assert.deepEqual(
    ventas.items.map((item) => [item.href, item.countKey]),
    [
      ["/leads", "leads"],
      ["/presupuestos", "budgets"],
      ["/eventos", "events"],
    ],
  );
  // Solo Ventas lleva contadores.
  const withCount = ADMIN_NAV.flatMap((group) => group.items).filter((item) => item.countKey);
  assert.equal(withCount.length, 3);
  // Inicio y Clientes son ítems sueltos (sin encabezado ni acordeón).
  assert.deepEqual(
    ADMIN_NAV.filter((group) => group.bare).map((group) => group.label),
    ["Inicio", "Clientes"],
  );
});

test("Firmas y Plantillas salen del menú pero siguen siendo rutas y tienen su acceso", () => {
  const items = ADMIN_NAV.flatMap((group) => group.items);
  assert.equal(items.some((item) => item.href === "/firmas" || item.href === "/plantillas"), false);
  for (const route of ["/firmas", "/plantillas"]) {
    assert.ok((ADMIN_ROUTES as readonly string[]).includes(route), `${route} sigue en las rutas del panel`);
    assert.ok(existsSync(new URL(`../app/(admin)/(panel)${route}/page.tsx`, import.meta.url)), `${route}: falta la página`);
  }
  const presupuestos = items.find((item) => item.href === "/presupuestos");
  const ajustes = items.find((item) => item.href === "/ajustes");
  const clientes = items.find((item) => item.href === "/clientes");
  assert.equal(isAdminNavItemActive("/firmas", presupuestos!), true);
  assert.equal(isAdminNavItemActive("/plantillas", clientes!), true);
  assert.equal(isAdminNavItemActive("/clientes/mensajes", clientes!), true);
  assert.equal(isAdminNavItemActive("/plantillas", ajustes!), false);
  assert.equal(isAdminNavItemActive("/firmas", ajustes!), false);
  assert.equal(adminNavLabel("/firmas"), "Firmas");
  assert.equal(adminNavLabel("/plantillas"), "Mensajes");
  assert.equal(adminNavLabel("/clientes/mensajes"), "Mensajes");
  assert.equal(adminNavIcon("/firmas"), "pen");
  // Accesos visibles: pestaña «Firmas» en Presupuestos y «Plantillas» en Ajustes, en ambas pantallas.
  assert.match(repoFile("components/admin/modules/PresupuestosTabs.tsx"), /href: "\/firmas", label: "Firmas"/);
  assert.match(repoFile("components/admin/modules/PresupuestosModule.tsx"), /<PresupuestosTabs active=\{showRequests \? "solicitudes" : "presupuestos"\}/);
  assert.match(repoFile("components/admin/modules/FirmasModule.tsx"), /<PresupuestosTabs active="firmas" \/>/);
  assert.match(repoFile("components/admin/modules/AjustesTabs.tsx"), /href: "\/plantillas", label: "Plantillas"/);
  assert.match(repoFile("components/admin/modules/AjustesModule.tsx"), /<AjustesTabs active=\{section\} \/>/);
  assert.match(repoFile("components/admin/modules/PlantillasModule.tsx"), /<ClientesTabs active="mensajes" \/>/);
});

test("los links internos a /firmas y /plantillas apuntan a rutas que existen", () => {
  // Único uso fuera del módulo: el enlace «Plantillas» del diálogo de mensajes.
  assert.match(repoFile("components/admin/AdminMessageTemplateDialog.tsx"), /href="\/plantillas"/);
  for (const file of ["lib/module-help.ts"]) {
    for (const match of repoFile(file).matchAll(/href: "(\/[a-z-]+)(?:[?"/])/g)) {
      assert.ok((ADMIN_ROUTES as readonly string[]).includes(match[1]), `${file}: ruta ${match[1]} inexistente`);
    }
  }
});

test("menú móvil: Inicio, Leads, Presupuestos, Eventos y Más", () => {
  const source = repoFile("components/admin/AdminMobileNav.tsx");
  const labels = [...source.matchAll(/\{ href: "(\/[a-z]+)", label: "([^"]+)"/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(labels, ["/dashboard:Inicio", "/leads:Leads", "/presupuestos:Presupuestos", "/eventos:Eventos"]);
  assert.match(source, /<span className="admin-bottomnav-label">Más<\/span>/);
});

test("los endpoints nuevos exigen sesión y acotan todo a la empresa activa", () => {
  for (const route of ["app/api/admin/nav-counts/route.ts", "app/api/admin/resumen/route.ts"]) {
    const source = repoFile(route);
    assert.match(source, /requireAdminContext\(\)/, `${route}: sin sesión`);
    assert.match(source, /auth\.context\.organizationId/, `${route}: sin empresa activa`);
  }
  const service = repoFile("lib/server/resumen.ts");
  // Toda consulta del servicio (las relaciones anidadas heredan la del padre) lleva la empresa.
  const queries = [...service.matchAll(/db\.\w+\.\w+\(\{\s*where: (?=([\s\S]{0,160}))/g)].map((match) => match[1]);
  // El saldo por cobrar pasó a SQL agregado: cada filtro lleva la empresa parametrizada.
  assert.ok(queries.length >= 15, "se esperan las consultas del Resumen");
  const rawSql = service.slice(service.indexOf("$queryRaw"), service.indexOf("db.clientPayment.aggregate"));
  assert.equal((rawSql.match(/"organizationId" = \$\{organizationId\}/g) ?? []).length, 2, "SQL del saldo sin empresa");
  for (const query of queries) assert.match(query, /organizationId|rejectedChequeWhere/, `consulta sin empresa: ${query}`);
  // El alta manual exige clients.write y nace en la empresa activa.
  const lead = repoFile("app/api/admin/leads/route.ts");
  assert.match(lead, /requireAdminContext\("clients\.write"\)/);
  assert.match(lead, /organizationId: auth\.context\.organizationId/);
});

test("el menú pide los contadores con sesión activa y no dibuja contador sin dato", () => {
  const shell = repoFile("components/admin/AdminShell.tsx");
  assert.match(shell, /\/api\/admin\/nav-counts/);
  assert.match(shell, /hasCount \?/);
  assert.match(shell, /typeof count === "number" && count > 0/);
});

test("montos abreviados en millones con es-PY y nunca truncados", () => {
  assert.equal(formatMoneyCompact(47_835_000), "Gs 47,8 M");
  assert.equal(formatMoneyCompact(1_000_000), "Gs 1 M");
  assert.equal(formatMoneyCompact(1_234_500_000), "Gs 1.234,5 M");
  // Bajo el millón se muestra el monto completo.
  assert.equal(formatMoneyCompact(950_000), formatMoney(950_000));
  assert.equal(formatMoneyCompact(0), formatMoney(0));
  assert.equal(formatMoneyCompact(Number.NaN), formatMoney(0));
  // El CSS nunca corta los montos del Resumen.
  const css = repoFile("app/globals.css");
  const rule = css.match(/\.admin-money-value \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /white-space: nowrap/);
  assert.doesNotMatch(rule, /text-overflow|overflow: hidden/);
});

function notification(partial: Partial<AdminNotification> & Pick<AdminNotification, "id" | "kind" | "level">): AdminNotification {
  return { title: "T", subtitle: null, date: "2026-10-13", href: "/eventos", ...partial };
}

const NO_RESUMEN = { money: { receivable: 0, overdueAmount: 0, overdueCount: 0, collectedMonth: 0 }, attention: { newLeads: 0, oldestLeadDay: null, rejectedCheques: 0, proofsToConfirm: 0, proofsAmount: 0 } };

test("«Para hacer hoy» ordena por urgencia: rojo, ámbar, cian, resto", () => {
  const actions = buildTodayActions({
    today: "2026-10-13",
    resumen: {
      money: { ...NO_RESUMEN.money, overdueCount: 2, overdueAmount: 8_000_000 },
      attention: { newLeads: 3, oldestLeadDay: "2026-10-09", rejectedCheques: 1, proofsToConfirm: 2, proofsAmount: 5_000_000 },
    },
    notifications: [
      notification({ id: "supplier_due:1", kind: "supplier_due", level: "soon", title: "Proveedor", href: "/finanzas" }),
      notification({ id: "checklist:1", kind: "checklist", level: "soon", title: "Feria" }),
      notification({ id: "expected_due:1", kind: "expected_due", level: "overdue", title: "Cliente", href: "/finanzas" }),
      // Cubiertos por los agregados: no se duplican.
      notification({ id: "lead:1", kind: "lead", level: "info", href: "/leads" }),
      notification({ id: "payment_proof:1", kind: "payment_proof", level: "info", href: "/finanzas" }),
      notification({ id: "collection_due:1", kind: "collection_due", level: "overdue", href: "/finanzas" }),
    ],
  });
  assert.deepEqual(
    actions.map((action) => [action.id, action.tone]),
    [
      ["mora", "danger"],
      ["cheques", "danger"],
      ["expected_due:1", "danger"],
      ["leads", "warn"],
      ["checklist:1", "warn"],
      ["comprobantes", "info"],
      ["supplier_due:1", "neutral"],
    ],
  );
  assert.match(actions[0].title, /2 cobros en mora · Gs 8\.000\.000/);
  assert.equal(actions[0].href, "/finanzas/por-cobrar");
  assert.equal(actions[3].href, "/leads?estado=NEW");
  assert.match(actions[3].detail, /hace 4 días/);
  assert.equal(actions[5].href, "/finanzas/por-confirmar");
  for (const action of actions) assert.ok(action.label.length > 0 && action.href.startsWith("/"));
  assert.equal(TODAY_ACTIONS_LIMIT, 5);
});

test("«Para hacer hoy» sin datos queda vacío (la pantalla dice «Todo al día») y sin resumen usa solo los avisos", () => {
  assert.deepEqual(buildTodayActions({ today: "2026-10-13", resumen: NO_RESUMEN, notifications: [] }), []);
  const onlyFeed = buildTodayActions({
    today: "2026-10-13",
    resumen: null,
    notifications: [notification({ id: "task:1", kind: "task", level: "overdue", title: "Llamar" })],
  });
  assert.equal(onlyFeed.length, 1);
  // Una mora individual del feed se muestra si el agregado no la cubre.
  const uncovered = buildTodayActions({
    today: "2026-10-13",
    resumen: NO_RESUMEN,
    notifications: [notification({ id: "collection_due:9", kind: "collection_due", level: "overdue", href: "/finanzas" })],
  });
  assert.equal(uncovered[0]?.tone, "danger");
  const source = repoFile("components/admin/modules/ResumenModule.tsx");
  assert.match(source, /title="Todo al día"/);
  assert.match(source, /<AdminLoadingRows rows=\{4\}/);
  assert.match(source, /Ver todos \(/);
});

test("diferencia de días entre claves de día", () => {
  assert.equal(dayDiff("2026-10-13", "2026-10-09"), 4);
  assert.equal(dayDiff("2026-11-01", "2026-10-31"), 1);
  assert.equal(dayDiff("2026-10-13", "2026-10-13"), 0);
});

test("chip de «Esta semana»: checklist, seña pendiente y sin checklist, sin inventar «listo»", () => {
  assert.deepEqual(weekEventChip({ tasksTotal: 4, tasksDone: 0, depositPending: 0 }), { label: "Checklist 0/4", tone: "danger" });
  assert.deepEqual(weekEventChip({ tasksTotal: 4, tasksDone: 2, depositPending: 0 }), { label: "Checklist 2/4", tone: "warn" });
  assert.deepEqual(weekEventChip({ tasksTotal: 4, tasksDone: 4, depositPending: 2_000_000 }), { label: "Seña pendiente · Gs 2.000.000", tone: "warn" });
  assert.deepEqual(weekEventChip({ tasksTotal: 4, tasksDone: 4, depositPending: 0 }), { label: "Listo", tone: "ok" });
  assert.deepEqual(weekEventChip({ tasksTotal: 0, tasksDone: 0, depositPending: 0 }), { label: "Sin checklist", tone: "neutral" });
});

test("ventanas del mes y de la semana en el día de Asunción", () => {
  const now = new Date("2026-10-13T15:00:00Z"); // 12:00 en Asunción
  const month = monthWindow(now);
  assert.equal(month.key, "2026-10");
  assert.ok(month.start.getTime() < month.end.getTime());
  assert.ok(month.start.getTime() <= now.getTime() && now.getTime() < month.end.getTime());
  const week = weekWindow(now);
  assert.equal(Math.round((week.end.getTime() - week.start.getTime()) / 86_400_000), 7);
  assert.ok(week.start.getTime() <= now.getTime() && now.getTime() < week.end.getTime());
  // Diciembre cierra en enero del año siguiente.
  assert.equal(monthWindow(new Date("2026-12-20T12:00:00Z")).key, "2026-12");
  assert.ok(monthWindow(new Date("2026-12-20T12:00:00Z")).end.getTime() > new Date("2026-12-31T12:00:00Z").getTime());
});

test("demo: franja fina, bienvenida solo la primera vez y lista compacta", () => {
  const shell = repoFile("components/admin/AdminShell.tsx");
  assert.match(shell, /<strong>DEMO<\/strong> · Datos de ejemplo: no se guarda nada/);
  assert.match(shell, /Recorrido guiado/);
  assert.doesNotMatch(shell, /admin-demo-banner/);
  const intro = repoFile("components/admin/DemoIntro.tsx");
  assert.match(intro, /if \(requested \|\| !seen\)/, "se abre solo si es la primera vez o la piden");
  assert.match(intro, /markSeen\(\)/);
  assert.match(intro, /try \{[\s\S]*localStorage\.setItem[\s\S]*\} catch/);
  const page = repoFile("app/(admin)/(panel)/demo/page.tsx");
  assert.doesNotMatch(page, /AdminKpi/, "la demo ya no repite una grilla de KPIs");
  assert.match(page, /admin-demo-cases-list/);
});

test("resumen: parseBalance normaliza bigint, string y nulos a PYG entero", async () => {
  assert.equal(parseBalance(BigInt(4000000)), 4000000);
  assert.equal(parseBalance("1500000"), 1500000);
  assert.equal(parseBalance(null), 0);
  assert.equal(parseBalance(-5), 0);
});

test("buildTodayActions: cobros vencidos llevan concepto, cliente y monto", async () => {
  const actions = buildTodayActions({
    today: "2026-10-13",
    resumen: null,
    notifications: [
      notification({ id: "expected_due:1", kind: "expected_due", level: "overdue", title: "Personal", label: "Anticipo", amount: 4000000, href: "/finanzas" }),
    ],
  });
  assert.equal(actions[0].title, "Anticipo vencido · Personal · Gs 4.000.000");
});
