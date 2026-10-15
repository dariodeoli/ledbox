import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assignmentBlockedRange,
  buildAvailability,
  isOutstanding,
  type AssignmentRecord,
} from "../lib/server/inventory-availability";
import { catalogDailyPrice, catalogPriceFor, estimatedSubtotal, listDailyPrice, rentalDaysBetween } from "../lib/catalog-public";
import { billedDays, isEventBilled, quoteProductPrice, readBillingUnit } from "../lib/quote-sharing";
import { canApproveWithoutStock } from "../lib/server/permissions";
import { decideStockApproval, shortageLines, type StockGate } from "../lib/server/approval-stock";
import { overdueReturnOf } from "../lib/server/rental-alerts";
import { readBulkChanges } from "../lib/inventory-bulk";

const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (day: number, hour = 12) => new Date(Date.UTC(2031, 0, day, hour));

// ── P1-1 · precio por evento ────────────────────────────────────────────────

const juego = { listPrice: 660_000, listFromDays: 0, listFromPrice: 0, wholesalePrice: 500_000, wholesaleFromDays: 0, wholesaleFromPrice: 0 };

test("P1-1 (1): un juego POR EVENTO de 660.000 de viernes a domingo cotiza 660.000", () => {
  const days = rentalDaysBetween("2031-01-10", "2031-01-12"); // viernes a domingo, ambos incluidos
  assert.equal(days, 3);
  const row = { ...juego, billingUnit: "EVENT" };
  const unit = listDailyPrice(row, "RETAIL", days);
  assert.equal(unit, 660_000);
  const price = catalogPriceFor(row, "RETAIL");
  assert.equal(price.perEvent, true);
  assert.equal(estimatedSubtotal([{ name: "Juego lounge", quantity: 1, unitPrice: unit, perEvent: price.perEvent }], days), 660_000);
  assert.equal(billedDays("EVENT", days), 1);
  // El umbral «desde X días» de un producto por evento no se activa: la duración no cambia el precio.
  assert.equal(quoteProductPrice({ listPrice: 660_000, listFromDays: 2, listFromPrice: 500_000, billingUnit: "EVENT" }, 3), 660_000);
});

test("P1-1 (2): un producto POR DÍA de 3 días sigue siendo el triple", () => {
  const days = 3;
  for (const billingUnit of ["DAILY", undefined, null]) {
    const row = { ...juego, billingUnit };
    const unit = listDailyPrice(row, "RETAIL", days);
    assert.equal(unit, 660_000);
    const price = catalogPriceFor(row, "RETAIL");
    assert.notEqual(price.perEvent, true);
    assert.equal(estimatedSubtotal([{ name: "Juego", quantity: 1, unitPrice: unit, perEvent: price.perEvent }], days), 1_980_000);
    assert.equal(billedDays(billingUnit, days), 3);
  }
  // La regla «desde X días» de un producto por día sigue aplicando.
  assert.equal(quoteProductPrice({ listPrice: 100, listFromDays: 3, listFromPrice: 80, billingUnit: "DAILY" }, 3), 80);
});

test("P1-1 (4): el mayorista también va con días = 1 cuando el producto es por evento", () => {
  const row = { ...juego, billingUnit: "EVENT" };
  const price = catalogPriceFor(row, "WHOLESALE");
  assert.equal(price.perEvent, true);
  assert.equal(price.unit, 500_000);
  assert.equal(catalogDailyPrice(price, 5), 500_000);
  assert.equal(listDailyPrice(row, "WHOLESALE", 5), 500_000);
  assert.equal(estimatedSubtotal([{ name: "Juego", quantity: 2, unitPrice: 500_000, perEvent: price.perEvent }], 5), 1_000_000);
  assert.equal(quoteProductPrice({ ...juego, billingUnit: "EVENT" }, 5, "WHOLESALE"), 500_000);
});

test("P1-1: «Se cobra» solo acepta por día o por evento", () => {
  assert.equal(readBillingUnit("EVENT"), "EVENT");
  assert.equal(readBillingUnit("DAILY"), "DAILY");
  for (const bad of ["SQUARE_METER_DAILY", "event", "", null, undefined, 1]) assert.equal(readBillingUnit(bad), null);
  assert.equal(isEventBilled("EVENT"), true);
  assert.equal(isEventBilled("DAILY"), false);
  assert.equal(readBulkChanges("items", { billingUnit: "EVENT" })?.billingUnit, "EVENT");
  assert.equal(readBulkChanges("items", { billingUnit: "SQUARE_METER_DAILY" }), null);
  assert.equal(readBulkChanges("items", { billingUnit: null }), null);
});

test("P1-1: la migración es aditiva, idempotente y con default DAILY; el presupuesto fuerza días = 1 en EVENT", () => {
  const sql = repoFile("prisma/migrations/202610210001_inventory_billing_unit/migration.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "billingUnit" "BillingUnit" NOT NULL DEFAULT 'DAILY'/);
  assert.doesNotMatch(sql, /DROP|UPDATE|DELETE/i);
  assert.match(repoFile("prisma/schema.prisma"), /billingUnit\s+BillingUnit\s+@default\(DAILY\)/);
  const budgets = repoFile("app/api/admin/budgets/route.ts");
  assert.match(budgets, /links\.perEvent\.has\(inventoryId\) \? 1 : days/);
  // La tienda y la conversión usan el «se cobra» del producto, no un DAILY fijo.
  assert.doesNotMatch(repoFile("lib/server/catalog-public.ts"), /billingUnit: "DAILY" as const/);
  // La regla vive en `catalogLineAmounts` (line-pricing) y la usan la conversión y la propuesta de la empresa.
  assert.match(repoFile("lib/server/line-pricing.ts"), /billedDays\(linked\?\.billingUnit, periodDays\)/);
  assert.match(repoFile("lib/server/catalog-convert.ts"), /catalogLineAmounts\(linked,/);
  assert.match(repoFile("lib/server/quote-request-response.ts"), /catalogLineAmounts\(/);
  assert.match(repoFile("components/catalog-public/CatalogBrowser.tsx"), /por evento/);
});

// ── P1-3 · disponibilidad con atraso ────────────────────────────────────────

const event = (id = "ev1") => ({ id, name: "Casamiento", startsAt: at(10), endsAt: at(11), setupAt: null, strikeAt: null });
const copas = { id: "copa", name: "Copa", quantity: 12, status: "AVAILABLE" as const, maintenance: 0 };
function out(extra: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return { id: "a1", inventoryId: "copa", quantity: 12, startsAt: at(10), endsAt: at(11), event: event(), checkedOut: true, checkedIn: false, checkedInAt: null, ...extra };
}

test("P1-3 (1): una copa que salió el sábado sin volver figura ocupada el lunes", () => {
  // Evento sábado 10 → domingo 11 (planeado); hoy es el lunes 12 a la mañana.
  const monday = at(12, 9);
  const mondayRange = { start: at(12, 8), end: at(12, 20) };
  const stillOut = buildAvailability(copas, [out()], mondayRange.start, mondayRange.end, monday);
  assert.equal(stillOut.available, 0, "sigue afuera: no se puede ofrecer a otro evento");
  assert.equal(stillOut.committed, 12);
  // El detalle muestra el rango real del evento, no el extendido.
  assert.equal(stillOut.conflicts[0].endsAt?.toISOString(), at(11).toISOString());
  // Si volvió, queda libre (sin colchón).
  const back = buildAvailability(copas, [out({ checkedIn: true, checkedInAt: at(11, 18) })], mondayRange.start, mondayRange.end, monday);
  assert.equal(back.available, 12);
  // Sin salida registrada, un evento vencido ya no bloquea (comportamiento de siempre).
  const never = buildAvailability(copas, [out({ checkedOut: false })], mondayRange.start, mondayRange.end, monday);
  assert.equal(never.available, 12);
});

test("P1-3: el fin efectivo es max(fin, ahora) más el colchón; un equipo que no está atrasado no cambia", () => {
  const buffers = { beforeMin: 0, afterMin: 24 * 60 };
  const now = at(12, 9);
  const late = assignmentBlockedRange(out(), buffers, now);
  assert.equal(late.end?.toISOString(), new Date(now.getTime() + 24 * 3_600_000).toISOString());
  // Todavía dentro del plazo: fin planeado + colchón.
  const onTime = assignmentBlockedRange(out(), buffers, at(11, 8));
  assert.equal(onTime.end?.toISOString(), new Date(at(11).getTime() + 24 * 3_600_000).toISOString());
  // Con devolución real, manda la devolución (no «ahora»).
  const returned = assignmentBlockedRange(out({ checkedIn: true, checkedInAt: at(11, 20) }), buffers, now);
  assert.equal(returned.end?.toISOString(), new Date(at(11, 20).getTime() + 24 * 3_600_000).toISOString());
  // La vajilla atrasada bloquea también el día siguiente por el colchón de lavado.
  const dishes = buildAvailability({ ...copas, buffers }, [out()], at(13, 9), at(13, 12), now);
  assert.equal(dishes.available, 0);
  assert.equal(isOutstanding(out()), true);
  assert.equal(isOutstanding(out({ checkedIn: true })), false);
  assert.equal(isOutstanding(out({ checkedOut: false })), false);
});

test("P1-3: devoluciones vencidas = salió, no volvió y el fin planeado ya pasó", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: "a1", inventoryId: "copa", quantity: 12, checkoutQuantity: 12, returnedQuantity: 0,
    checkedOut: true, checkedIn: false, checkedInAt: null, startsAt: at(10), endsAt: at(11),
    event: { ...event(), client: { name: "Ana", company: "Eventos SA" } }, inventory: { name: "Copa" }, ...extra,
  });
  const now = at(12, 15);
  const overdue = overdueReturnOf(row(), now);
  assert.equal(overdue?.pending, 12);
  assert.equal(overdue?.hoursLate, 27);
  assert.equal(overdue?.clientName, "Eventos SA");
  assert.equal(overdueReturnOf(row({ returnedQuantity: 5 }), now)?.pending, 7, "devolución parcial: faltan 7");
  assert.equal(overdueReturnOf(row({ returnedQuantity: 12 }), now), null);
  assert.equal(overdueReturnOf(row({ checkedIn: true }), now), null);
  assert.equal(overdueReturnOf(row({ checkedOut: false }), now), null);
  assert.equal(overdueReturnOf(row(), at(11, 8)), null, "todavía en plazo");
});

// ── P1-3 · aprobar con stock ────────────────────────────────────────────────

const blockedGate: StockGate = {
  ok: false,
  lines: ["Copa (piden 12, hay 8)"],
  message: "Falta stock para aprobar: Copa (piden 12, hay 8).",
  reservation: { eventId: "e", eventName: "E", range: null, outcomes: [], requested: 12, reserved: 0, conflicts: 1, failed: false, blocked: true },
};

test("P1-3 (3): «Aprobar igual» solo para OWNER y ADMIN y deja las líneas faltantes para auditar", () => {
  assert.equal(canApproveWithoutStock("OWNER"), true);
  assert.equal(canApproveWithoutStock("ADMIN"), true);
  for (const role of ["FINANCE", "OPERATIONS", "VIEWER"] as const) assert.equal(canApproveWithoutStock(role), false);

  const asOwner = decideStockApproval(blockedGate, false, "OWNER");
  assert.equal(asOwner.kind, "blocked");
  assert.equal(asOwner.kind === "blocked" && asOwner.canForce, true);
  const asFinance = decideStockApproval(blockedGate, false, "FINANCE");
  assert.equal(asFinance.kind === "blocked" && asFinance.canForce, false);

  assert.deepEqual(decideStockApproval(blockedGate, true, "ADMIN"), { kind: "forced", lines: ["Copa (piden 12, hay 8)"] });
  assert.equal(decideStockApproval(blockedGate, true, "FINANCE").kind, "forbidden");
  assert.equal(decideStockApproval(blockedGate, true, "OPERATIONS").kind, "forbidden");
  assert.deepEqual(decideStockApproval({ ok: true, reservation: null }, false, "FINANCE"), { kind: "proceed" });
});

test("P1-3: las líneas de faltante son legibles y las rutas de aprobación pasan por el bloqueo", () => {
  assert.deepEqual(
    shortageLines({ outcomes: [{ inventoryName: "Copa", quantity: 12, available: 8 } as never] }),
    ["Copa (piden 12, hay 8)"],
  );
  const portal = repoFile("app/api/portal/budget/[token]/approve/route.ts");
  const comparison = repoFile("app/api/portal/comparison/[token]/approve/route.ts");
  const panel = repoFile("app/api/admin/budgets/approval/route.ts");
  for (const [name, source] of [["portal", portal], ["comparativa", comparison], ["panel", panel]] as const) {
    assert.ok(source.indexOf("checkStockBeforeApproval(") > 0, `${name}: verifica stock`);
    assert.ok(source.indexOf("checkStockBeforeApproval(") < source.indexOf("tx.budget.updateMany"), `${name}: antes de aprobar`);
  }
  assert.match(repoFile("lib/server/approval-stock.ts"), /Hay piezas sin disponibilidad para esas fechas; el equipo te contacta\./);
  assert.match(portal, /jsonError\(PORTAL_STOCK_MESSAGE, 409, "stock_insufficient"\)/);
  assert.match(panel, /Aprobó igual el presupuesto/);
  assert.match(panel, /user\.name/);
});

test("P1-3 (4): la retención por vencer y las devoluciones vencidas llegan al resumen como avisos", () => {
  const notifications = repoFile("lib/server/notifications.ts");
  assert.match(notifications, /return_overdue:/);
  assert.match(notifications, /hold_expiring:/);
  const alerts = repoFile("lib/server/rental-alerts.ts");
  assert.match(alerts, /HOLD_WARNING_HOURS = 6/);
  assert.match(alerts, /quoteRequestId: \{ not: null \}/);
  assert.match(repoFile("components/admin/modules/EventosModule.tsx"), /<OverdueReturnsPanel \/>/);
  assert.match(repoFile("components/admin/modules/InventarioModule.tsx"), /<OverdueReturnsIndicator \/>/);
});
