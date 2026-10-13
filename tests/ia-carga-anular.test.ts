import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { monedaExtranjeraDeTexto, montoDeTexto, normalizarAnalisis } from "../lib/server/ia-carga";

/**
 * «Carga con IA» #130 (auditoría #123, hallazgos ALTA):
 * IA-1 monedas extranjeras no se interpretan; IA-2 lote auditable + abrir y
 * anular por fila desde el resultado.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// ── IA-1 · Monedas extranjeras ─────────────────────────────────────────────

test("las monedas extranjeras se detectan y no se interpretan como guaraníes", () => {
  assert.equal(monedaExtranjeraDeTexto("USD 100"), "USD");
  assert.equal(monedaExtranjeraDeTexto("100 dólares"), "USD");
  assert.equal(monedaExtranjeraDeTexto("u$s 50"), "USD");
  assert.equal(monedaExtranjeraDeTexto("€ 20"), "EUR");
  assert.equal(monedaExtranjeraDeTexto("20 euros"), "EUR");
  assert.equal(monedaExtranjeraDeTexto("R$ 30"), "BRL");
  assert.equal(monedaExtranjeraDeTexto("Gs 100"), null);
  assert.equal(monedaExtranjeraDeTexto("750 mil"), null);
  assert.equal(monedaExtranjeraDeTexto("1.500.000"), null);
  assert.equal(monedaExtranjeraDeTexto(100), null, "un número ya es PYG");

  assert.equal(montoDeTexto("USD 100"), null, "sin cotización no hay monto");
  assert.equal(montoDeTexto("100 dólares"), null);
  assert.equal(montoDeTexto("€ 20"), null);
  assert.equal(montoDeTexto("Gs 100"), 100);
});

test("un cobro en otra moneda queda vacío con aviso de carga manual", () => {
  const analisis = normalizarAnalisis(
    { cobros: [{ cliente: "NoeCes", monto: "USD 100" }] },
    ["cobros"],
    { texto: "NoeCes me pagó USD 100" },
  );
  const cobro = analisis.cobros[0];
  assert.equal(cobro.monto, null);
  assert.equal(cobro.montoTexto, "USD 100");
  assert.ok(cobro.avisos.some((aviso) => aviso.includes("USD") && aviso.includes("cargalo a mano")), "avisa moneda extranjera");
  assert.equal(cobro.inventados.length, 0, "no es un dato inventado: es una moneda distinta");
});

test("un precio de producto en otra moneda queda vacío con aviso", () => {
  const analisis = normalizarAnalisis(
    { productos: [{ nombre: "Pantalla", precioLista: "USD 50" }] },
    ["productos"],
    { texto: "Pantalla a USD 50" },
  );
  const producto = analisis.productos[0];
  assert.equal(producto.precioLista, null);
  assert.ok(producto.avisos.some((aviso) => aviso.includes("USD")));
});

// ── IA-2 · Lote y anulación ────────────────────────────────────────────────

test("el lote aplicado queda auditado como IaCarga con sus ids", () => {
  const route = repoFile("app/api/admin/ia/lote/route.ts");
  assert.match(route, /entity: "IaCarga"/);
  assert.match(route, /entityId: lote/);
  assert.match(route, /clientes: filas\.clientes\.map\(\(fila\) => fila\.id\)/);
  assert.match(route, /cobros: filas\.cobros\.map\(\(fila\) => fila\.id\)/);
  assert.match(route, /rateLimit\(`ia-lote:/);
  const ui = repoFile("components/admin/AdminCargaIa.tsx");
  assert.match(ui, /const lote = newIdempotencyKey\(\)/, "cada aplicación genera su lote");
  assert.match(ui, /"\/api\/admin\/ia\/lote"/, "el panel registra el lote al aplicar");
});

test("anular exige permiso del tipo y guardas de historial", () => {
  const route = repoFile("app/api/admin/ia/anular/route.ts");
  assert.match(route, /cliente: "clients\.write"/);
  assert.match(route, /producto: "inventory\.write"/);
  assert.match(route, /requireAdminContext\(CAPACIDAD\[tipo\]\)/, "el permiso depende del tipo");
  assert.match(route, /_count: \{ select: \{ events: true, budgets: true, payments: true, invoices: true \} \}/, "historial del cliente");
  assert.match(route, /no se anula/, "con historial no se borra");
  // El ítem se anula con el mismo criterio que el borrado definitivo (blockersFor): asignaciones, incidentes, combos y presupuestos.
  assert.match(route, /annulInventoryItem\(id, lote, auth\.context\)/, "uso del ítem");
  const ops = repoFile("lib/server/trash-ops.ts");
  assert.match(ops, /blockersFor\("InventoryItem"/, "bloqueos del ítem");
  assert.match(ops, /budgetItems/, "presupuestos del ítem");
  assert.match(route, /action: "delete"/, "la anulación del cliente se audita como baja");
  assert.match(ops, /action: "delete"/, "la anulación del ítem se audita como baja");
  assert.match(route, /entity: "Client"/, "la baja del cliente se audita sobre el cliente");
  assert.match(ops, /entity: "InventoryItem"/);
  assert.match(ops, /lote: lote \|\| null/, "la anulación lleva el lote");
  assert.match(route, /Los cobros se anulan desde Finanzas/);
});

test("el resultado permite abrir y anular cada fila con confirmación", () => {
  const ui = repoFile("components/admin/AdminCargaIa.tsx");
  assert.match(ui, /type FilaResultado/);
  assert.match(ui, /const RUTA_TIPO/, "cada tipo tiene su módulo");
  assert.match(ui, /Abrir/, "cada fila se puede abrir en su módulo");
  assert.match(ui, /function anularFila/);
  assert.match(ui, /confirmandoAnular/, "anular pide confirmación");
  assert.match(ui, /Sí, anular/);
  assert.match(ui, /paymentId: fila\.id, action: "cancel"/, "los cobros se anulan con Finanzas");
  assert.match(ui, /"\/api\/admin\/ia\/anular"/, "clientes y productos con el endpoint del lote");
  assert.match(ui, /AdminBadge tone="neutral">Anulado/, "lo anulado queda marcado");
});
