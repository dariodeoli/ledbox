import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  portalApprovalByline,
  portalBudgetClosed,
  portalExpired,
  portalHeadDates,
  portalStage,
  portalStatusChip,
  portalTransferDestination,
} from "../lib/portal-view";

/**
 * Rediseño del presupuesto del cliente (13-10-2026, «más entendible»): un solo
 * estado, sin validez tras aprobar, sin jerga interna, una sola sección de
 * pago y sin cuentas internas de caja como destino de transferencia.
 */
const root = process.cwd();
const view = readFileSync(join(root, "app", "(portal)", "_components", "PortalBudgetView.tsx"), "utf8");
const statics = readFileSync(join(root, "app", "(portal)", "_components", "PortalBudgetStatic.tsx"), "utf8");
const nextStep = readFileSync(join(root, "app", "(portal)", "_components", "PortalNextStep.tsx"), "utf8");
const css = readFileSync(join(root, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();

test("un solo estado legible: aprobado no se duplica ni dice «manual» o «digital»", () => {
  for (const status of ["SENT", "APPROVED", "NEGOTIATING"]) {
    const chip = portalStatusChip({ approved: true, status, revisionPending: false, waitingRequest: false, expired: false });
    assert.deepEqual(chip, { label: "Aprobado", tone: "ok" });
  }
  // La vista dibuja exactamente un chip de estado en el encabezado y ninguno del método de aprobación.
  assert.doesNotMatch(view, /budgetApprovalLabel|budgetApprovalTone|budgetApprovalMethodLabel|budgetStatusLabel|APROBADO_MANUAL|APROBADO_DIGITAL/);
  const headStart = view.indexOf('<header className="portal-budget-head">');
  const headEnd = view.indexOf("</header>", headStart);
  assert.equal((view.slice(headStart, headEnd).match(/className="portal-chip"/g) ?? []).length, 1, "el encabezado tiene más de un chip de estado");
});

test("los demás estados tienen su propio texto honesto", () => {
  const base = { approved: false, status: "SENT", revisionPending: false, waitingRequest: false, expired: false };
  assert.equal(portalStatusChip(base).label, "Pendiente de autorización");
  assert.equal(portalStatusChip({ ...base, status: "NEGOTIATING" }).label, "En negociación");
  assert.equal(portalStatusChip({ ...base, revisionPending: true }).label, "Cambios solicitados");
  assert.equal(portalStatusChip({ ...base, waitingRequest: true }).label, "Pedido en revisión");
  assert.equal(portalStatusChip({ ...base, expired: true }).label, "Vencido");
  assert.equal(portalStatusChip({ ...base, status: "CANCELLED" }).label, "Cancelado");
  assert.equal(portalStatusChip({ ...base, status: "LOST" }).label, "Cerrado");
});

test("«qué hacer ahora» cubre todos los estados con una sola etapa", () => {
  const open = { approved: false, status: "SENT", waiting: false, collection: "payment" as const, hasTransfer: false };
  assert.equal(portalStage(open), "authorize");
  assert.equal(portalStage({ ...open, status: "NEGOTIATING" }), "authorize");
  assert.equal(portalStage({ ...open, waiting: true }), "waiting");
  assert.equal(portalStage({ ...open, status: "LOST" }), "closed");
  assert.equal(portalStage({ ...open, status: "CANCELLED" }), "closed");
  const approved = { ...open, approved: true, status: "APPROVED" };
  assert.equal(portalStage({ ...approved, hasTransfer: true }), "pay");
  assert.equal(portalStage({ ...approved, collection: "review" }), "review");
  assert.equal(portalStage({ ...approved, collection: "complete" }), "settled");
  assert.equal(portalStage({ ...approved, hasTransfer: false }), "coordinate");
  assert.equal(portalBudgetClosed("APPROVED"), false);
  // Las dos acciones principales (autorizar y pagar) son las únicas con barra fija en celular.
  assert.match(view, /const stickyKind: "authorize" \| "pay" \| null = /);
});

test("aprobado: sin «Válido hasta» ni cuenta regresiva, solo «Aprobado el …»", () => {
  const rows = portalHeadDates({ approved: true, approvedAt: day(-2), status: "APPROVED", createdAt: day(-10), validUntil: day(-7) });
  assert.deepEqual(rows.map((row) => row.key), ["approved"]);
  assert.equal(rows[0]?.label, "Aprobado el");
  assert.equal(portalExpired(day(-7), true, "APPROVED"), false, "aprobado nunca figura vencido");
  assert.doesNotMatch(statics, /Válido hasta|Sin fecha de vencimiento/);
  assert.doesNotMatch(view, /Válido hasta|Válida hasta|Sin fecha de vencimiento/);
});

test("sin aprobar: emisión y validez no se contradicen", () => {
  // Validez futura: emisión + validez con cuenta regresiva.
  const open = portalHeadDates({ approved: false, approvedAt: null, status: "SENT", createdAt: day(-3), validUntil: day(10) });
  assert.deepEqual(open.map((row) => row.key), ["issued", "valid"]);
  assert.equal(open[1]?.label, "Válido hasta");
  // Emitido DESPUÉS de la validez (dato inconsistente): se muestra lo vencido, sin la emisión que lo contradice.
  const stale = portalHeadDates({ approved: false, approvedAt: null, status: "SENT", createdAt: day(-1), validUntil: day(-4) });
  assert.deepEqual(stale.map((row) => row.key), ["valid"]);
  assert.equal(stale[0]?.label, "Venció el");
  assert.equal(stale[0]?.tone, "danger");
  assert.equal(portalExpired(day(-4), false, "SENT"), true);
  // Perdido o cancelado: sin cuenta regresiva.
  const closed = portalHeadDates({ approved: false, approvedAt: null, status: "CANCELLED", createdAt: day(-9), validUntil: day(3) });
  assert.deepEqual(closed.map((row) => row.key), ["issued"]);
});

test("sin evento no hay campo «Evento» ni «Indefinido»", () => {
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code(statics), /Sin evento asociado|Indefinido|Sin evento/);
  assert.doesNotMatch(code(view), /Sin evento asociado|Indefinido|Sin evento/);
  assert.match(statics, /if \(!name\) return null;/);
});

test("nada de «Vía: Panel»: la aprobación se cuenta en voz del cliente", () => {
  assert.equal(portalApprovalByline({ method: "manual", name: "Operador interno" }), "Aprobado por el equipo de LedBox");
  assert.equal(portalApprovalByline({ method: "digital", name: "Ana Pérez" }), "Autorizado por Ana Pérez");
  assert.doesNotMatch(view, /<dt>Vía<\/dt>|budgetApprovalMethodLabel|Panel<\/dd>/);
  assert.doesNotMatch(view, /dt>Vía/);
});

test("una sola sección de pago, en el orden pedido", () => {
  assert.equal((view.match(/id="portal-pay"/g) ?? []).length, 1, "debe haber una única sección «Pagar»");
  assert.equal((view.match(/aria-labelledby="portal-pay-title"/g) ?? []).length, 1);
  for (const legacy of ["Tus pendientes", "Sin pendientes", "Datos para transferir", ">Enviar comprobante<", "portal-payment-data", 'aria-labelledby="portal-proof"']) {
    assert.ok(!view.includes(legacy), `quedó el bloque duplicado: ${legacy}`);
  }
  assert.equal((view.match(/portal-card-title[^>]*>\s*Resumen/g) ?? []).length, 0);
  assert.doesNotMatch(view, /icon="overview">\s*Resumen/);
  const pay = view.slice(view.indexOf("const payCard = approved"), view.indexOf("return (\n    <article"));
  const order = ["Falta transferir", "Datos bancarios", "Subir comprobante", "Plan de pagos"].map((text) => pay.indexOf(text));
  assert.ok(order.every((index) => index > 0), "faltan subbloques de «Pagar»");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "el orden debe ser: cuánto falta, datos, comprobante, plan");
  // El plan se pliega solo con más de un concepto.
  assert.match(pay, /planCount > 1 \? \(\s*<details/);
});

test("la cuenta de caja del plan nunca es destino de transferencia", () => {
  assert.doesNotMatch(view, /Cuenta destino|expected\.accountName|accountName/);
  // Sin cuenta ni alias bancarios: «a coordinar», aunque el plan tenga una cuenta «Efectivo».
  const onlyHolder = portalTransferDestination({ bank: null, holder: "LedBox SRL", ruc: "80000000-1", account: null, alias: null });
  assert.equal(onlyHolder.kind, "coordinate");
  assert.match(onlyHolder.kind === "coordinate" ? onlyHolder.message : "", /A coordinar/);
  assert.equal(portalTransferDestination(null).kind, "coordinate");
  const bank = portalTransferDestination({ bank: "Itaú", holder: "LedBox SRL", ruc: null, account: "123456", alias: null });
  assert.equal(bank.kind, "bank");
});

test("sin textos técnicos de cálculo y con una línea de ayuda corta", () => {
  assert.doesNotMatch(view, /Precio unitario × cantidad × días|portal-total-formula/);
  assert.doesNotMatch(css, /\.portal-total-formula/);
});

test("celular primero: barra fija con safe-area y columna lateral desde 1024 px", () => {
  assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*?\.portal-mobile-sticky \{[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.portal-mobile-sticky-action \{[^}]*min-height: 48px/);
  assert.match(css, /\.portal-budget-aside \{ display: none;/, "el resumen duplicado no se muestra en celular");
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\.portal-budget-grid \{ grid-template-columns: minmax\(0, 45rem\) 21\.5rem;/);
  assert.match(css, /\.portal-plan-row \{ grid-template-columns: minmax\(0, 1fr\) auto;/, "el plan se ve como ficha en celular");
});

test("jerarquía: encabezado → qué hacer → pagar → detalle → condiciones → documentos → cronología → contacto", () => {
  const at = (text: string) => view.indexOf(text);
  const order = [
    '<header className="portal-budget-head">',
    "<PortalNextStep",
    "{payCard}",
    'aria-labelledby="portal-items"',
    'aria-labelledby="portal-terms"',
    "<PortalQuoteResources",
    "{timeline}",
    'aria-labelledby="portal-help"',
  ].map(at);
  assert.ok(order.every((index) => index > 0), "falta una sección del recorrido");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(nextStep, /Qué tenés que hacer ahora/);
  assert.equal((nextStep.match(/portal-btn--primary/g) ?? []).length, 1, "la tarjeta tiene una sola acción principal");
});

test("no se expone nada nuevo: ni costos internos ni endpoints distintos", () => {
  for (const source of [view, statics, nextStep]) {
    for (const field of ["materialCost", "laborCost", "costEstimate", "costPrice"]) assert.ok(!source.includes(field), field);
  }
  // Los únicos endpoints del portal que usa la vista son los que ya existían.
  const posts = [...view.matchAll(/postPortal\("([a-z]+)"/g)].map((match) => match[1]);
  assert.ok(posts.length > 0 && posts.every((name) => ["approve", "propose", "revision"].includes(name!)), `endpoints inesperados: ${posts.join(", ")}`);
  assert.match(view, /\/api\/portal\/budget\/\$\{encodeURIComponent\(token\)\}\/proof/);
});

test("el saldo del portal sale del mismo helper que el paso de cobro", async () => {
  const { budgetBalance, budgetCollectionStep } = await import("../lib/budget-collection-step");
  assert.equal(budgetBalance({ total: 650_000, collected: 150_000 }), 500_000);
  assert.equal(budgetBalance({ total: 100, collected: 200 }), 0);
  const step = budgetCollectionStep({ total: 650_000, collected: 150_000, advanceAmount: 0, expectedPayments: [] });
  assert.equal(step.amount, budgetBalance({ total: 650_000, collected: 150_000 }));
  const source = readFileSync(join(process.cwd(), "app/(portal)/_components/PortalBudgetView.tsx"), "utf8");
  assert.doesNotMatch(source, /budget\.total - \(budget\.collectedAmount/);
});
