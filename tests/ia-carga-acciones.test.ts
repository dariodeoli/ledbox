import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { IA_MATCH_CLARO, IA_MATCH_DUDOSO, IA_REGISTROS_MAX } from "../lib/ia-carga";
import {
  analizarCarga,
  asignarExistentes,
  candidatosDeCliente,
  candidatosDeProducto,
  fechaDeTexto,
  hoyAsuncion,
  instruccionesIa,
  montoDeTexto,
  metodoDePago,
  normalizarAnalisis,
  puntuarCliente,
  puntuarProducto,
  similitudTexto,
  type ClienteCartera,
  type ProductoCartera,
} from "../lib/server/ia-carga";
import type { IaProvider } from "../lib/server/ia-carga";

/**
 * «Carga con IA» #122: matching contra lo existente (sin duplicar), acciones
 * (crear/vincular/registrar cobro), montos en Gs y fechas en lenguaje natural,
 * y el pre-mortem del issue (ambiguos, idempotencia, entidad sin resolver,
 * permisos, privacidad y límites). Todo con un **proveedor mockeado** (sin red).
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** Jueves 01-10-2026: referencia fija para fechas relativas. */
const HOY = "2026-10-01";

// ── Montos en Gs (issue #122 §3) ────────────────────────────────────────────

test("los montos se resuelven desde las formas del texto", () => {
  assert.equal(montoDeTexto("750.000"), 750_000);
  assert.equal(montoDeTexto("Gs 750.000"), 750_000);
  assert.equal(montoDeTexto("₲ 500000"), 500_000);
  assert.equal(montoDeTexto("750 mil"), 750_000);
  assert.equal(montoDeTexto("750k"), 750_000);
  assert.equal(montoDeTexto("Gs 750k"), 750_000);
  assert.equal(montoDeTexto("1.500.000"), 1_500_000);
  assert.equal(montoDeTexto("2 millones"), 2_000_000);
  assert.equal(montoDeTexto("1,5 millones"), 1_500_000);
  assert.equal(montoDeTexto("750,50"), 750, "los centavos no existen en PYG: queda el entero");
  assert.equal(montoDeTexto(500_000), 500_000);
  assert.equal(montoDeTexto("abc"), null);
  assert.equal(montoDeTexto(""), null);
  assert.equal(montoDeTexto(null), null);
});

// ── Fechas en lenguaje natural (issue #122 §3) ──────────────────────────────

test("las fechas relativas se resuelven contra el día de la empresa", () => {
  assert.equal(fechaDeTexto("hoy", { hoy: HOY }), HOY);
  assert.equal(fechaDeTexto("ayer", { hoy: HOY }), "2026-09-30");
  assert.equal(fechaDeTexto("anteayer", { hoy: HOY }), "2026-09-29");
  assert.equal(fechaDeTexto("mañana", { hoy: HOY }), "2026-10-02");
  assert.equal(fechaDeTexto("pasado mañana", { hoy: HOY }), "2026-10-03");
  assert.equal(fechaDeTexto("hhoy", { hoy: HOY }), null);
});

test("los días de la semana respetan el modo y lo explícito", () => {
  assert.equal(fechaDeTexto("jueves", { hoy: HOY }), HOY, "hoy es jueves: cercano");
  assert.equal(fechaDeTexto("viernes", { hoy: HOY }), "2026-10-02");
  assert.equal(fechaDeTexto("viernes", { hoy: HOY, modo: "pasado" }), "2026-09-25");
  assert.equal(fechaDeTexto("lunes", { hoy: HOY, modo: "futuro" }), "2026-10-05");
  assert.equal(fechaDeTexto("lunes", { hoy: HOY }), "2026-09-28", "cercano elige el más próximo");
  assert.equal(fechaDeTexto("jueves pasado", { hoy: HOY }), "2026-09-24", "«pasado» exige la semana anterior");
  assert.equal(fechaDeTexto("próximo jueves", { hoy: HOY }), "2026-10-08");
});

test("las fechas cortas y con mes se completan con el año de hoy", () => {
  assert.equal(fechaDeTexto("3/10", { hoy: HOY }), "2026-10-03");
  assert.equal(fechaDeTexto("3 de octubre", { hoy: HOY }), "2026-10-03");
  assert.equal(fechaDeTexto("3 de octubre de 2027", { hoy: HOY }), "2027-10-03");
  assert.equal(fechaDeTexto("31 de febrero", { hoy: HOY }), null);
});

test("hoyAsuncion usa la zona de la empresa", () => {
  assert.equal(hoyAsuncion(new Date("2026-10-01T12:00:00Z")), "2026-10-01");
  assert.equal(hoyAsuncion(new Date("2026-10-02T02:00:00Z")), "2026-10-01", "madrugada UTC sigue siendo el día anterior en Asunción");
});

// ── Métodos de pago ─────────────────────────────────────────────────────────

test("el método de pago se canoniza contra la lista del panel", () => {
  assert.equal(metodoDePago("transferencia"), "Transferencia");
  assert.equal(metodoDePago("por transferencia bancaria"), "Transferencia");
  assert.equal(metodoDePago("en cheques"), "Cheque");
  assert.equal(metodoDePago("efectivo"), "Efectivo");
  assert.equal(metodoDePago("tarjeta"), "Tarjeta");
  assert.equal(metodoDePago("cripto"), null);
  assert.equal(metodoDePago(""), null);
});

// ── Similitud y candidatos ──────────────────────────────────────────────────

test("la similitud castiga las coincidencias de una sola palabra", () => {
  assert.equal(similitudTexto("Juan Pérez", "juan perez"), 100);
  assert.equal(similitudTexto("constructora sur", "Constructora Sur SA"), 92);
  assert.equal(similitudTexto("Pérez", "Juan Pérez"), 78, "un apellido suelto no es match claro");
  assert.equal(similitudTexto("constructora del sur sa", "constructora sur"), 73);
  assert.equal(similitudTexto("a", "b"), 0);
});

const CARTERA_CLIENTES: ClienteCartera[] = [
  { id: "c1", nombre: "Constructora Sur SA", empresa: "Constructora Sur", ruc: "80012345-6", telefono: "+595 981123456" },
  { id: "c2", nombre: "María González", empresa: null, ruc: null, telefono: null },
  { id: "c3", nombre: "María González Pérez", empresa: null, ruc: null, telefono: null },
  { id: "c4", nombre: "Juan Pérez", empresa: null, ruc: null, telefono: "0972 000 111" },
];

const CARTERA_PRODUCTOS: ProductoCartera[] = [
  { id: "p1", nombre: "Pantalla LED 3x2", sku: "PL-001", categoria: "Pantallas" },
  { id: "p2", nombre: "Tótem táctil", sku: null, categoria: "Tótems" },
];

test("el cliente se puntúa por nombre, empresa, RUC y teléfono", () => {
  assert.equal(puntuarCliente({ nombre: "constructora sur sa" }, CARTERA_CLIENTES[0]).confianza, 100);
  assert.equal(puntuarCliente({ nombre: "Otra", ruc: "80012345-6" }, CARTERA_CLIENTES[0]).confianza, 100);
  assert.equal(puntuarCliente({ nombre: "Otra", ruc: "80012345-6" }, CARTERA_CLIENTES[0]).detalle, "RUC 80012345-6");
  assert.equal(puntuarCliente({ nombre: "Otra", telefono: "0981-123-456" }, CARTERA_CLIENTES[0]).confianza, 98);
  assert.equal(puntuarCliente({ nombre: "Otra", empresa: "constructora sur" }, CARTERA_CLIENTES[0]).confianza, 100, "empresa exacta");
  assert.ok(puntuarCliente({ nombre: "Otra", empresa: "constructora del sur" }, CARTERA_CLIENTES[0]).confianza >= IA_MATCH_DUDOSO);
  assert.ok(puntuarCliente({ nombre: "Nadie" }, CARTERA_CLIENTES[0]).confianza < IA_MATCH_DUDOSO);
});

test("el producto se puntúa por SKU o por nombre (+ categoría)", () => {
  assert.equal(puntuarProducto({ nombre: "Otra", sku: "pl-001" }, CARTERA_PRODUCTOS[0]).confianza, 100);
  assert.equal(puntuarProducto({ nombre: "Pantalla LED 3x2" }, CARTERA_PRODUCTOS[0]).confianza, 100);
  const conCategoria = puntuarProducto({ nombre: "Tótem táctil LED", categoria: "Tótems" }, CARTERA_PRODUCTOS[1]);
  assert.ok(conCategoria.confianza >= IA_MATCH_DUDOSO);
  assert.ok(puntuarProducto({ nombre: "Micrófono" }, CARTERA_PRODUCTOS[0]).confianza < IA_MATCH_DUDOSO);
});

test("los candidatos priorizan el match claro y limitan los dudosos", () => {
  const candidatos = candidatosDeCliente({ nombre: "constructora sur" }, CARTERA_CLIENTES);
  assert.equal(candidatos[0].id, "c1");
  assert.ok(candidatos[0].confianza >= IA_MATCH_CLARO);
  assert.equal(candidatosDeCliente({ nombre: "Nadie de nadie" }, CARTERA_CLIENTES).length, 0);
  const productos = candidatosDeProducto({ nombre: "pantalla led", sku: null }, CARTERA_PRODUCTOS);
  assert.equal(productos[0].id, "p1");
});

// ── Acciones: crear vs vincular (issue #122 §1) ─────────────────────────────

test("un candidato claro se propone como vincular; nunca se duplica", () => {
  const analisis = normalizarAnalisis(
    { clientes: [{ nombre: "Constructora Sur", ruc: "80012345-6" }], productos: [{ nombre: "Pantalla LED 3x2", sku: "pl-001" }] },
    ["clientes", "productos"],
  );
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: CARTERA_PRODUCTOS });
  assert.equal(resuelto.clientes[0].accion, "vincular");
  assert.equal(resuelto.clientes[0].existenteId, "c1");
  assert.ok((resuelto.clientes[0].confianza ?? 0) >= IA_MATCH_CLARO);
  assert.equal(resuelto.productos[0].accion, "vincular");
  assert.equal(resuelto.productos[0].existenteId, "p1");
});

test("dos clientes parecidos: el mejor queda preseleccionado con aviso", () => {
  const analisis = normalizarAnalisis({ clientes: [{ nombre: "María González" }] }, ["clientes"]);
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: [] });
  const cliente = resuelto.clientes[0];
  assert.equal(cliente.accion, "vincular", "el mejor candidato se preselecciona (issue #127)");
  assert.equal(cliente.existenteId, "c2", "exacto primero");
  assert.ok(cliente.candidatos.length >= 2, "los demás quedan para cambiar");
  assert.equal(cliente.avisos.some((aviso) => aviso.includes("Sugerido")), false, "un exacto no lleva aviso");
  // Confianza media: el mejor queda preseleccionado y avisa que es sugerencia.
  const dudoso = asignarExistentes(normalizarAnalisis({ clientes: [{ nombre: "Pérez" }] }, ["clientes"]), {
    clientes: CARTERA_CLIENTES,
    productos: [],
  });
  assert.equal(dudoso.clientes[0].accion, "vincular");
  assert.ok(dudoso.clientes[0].avisos.some((aviso) => aviso.includes("Sugerido")));
});

test("sin candidatos se crea; el match de confianza media se preselecciona", () => {
  const analisis = normalizarAnalisis({ clientes: [{ nombre: "Cliente Nuevo" }, { nombre: "Pérez" }] }, ["clientes"]);
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: [] });
  assert.equal(resuelto.clientes[0].accion, "crear");
  assert.equal(resuelto.clientes[0].candidatos.length, 0);
  assert.equal(resuelto.clientes[1].accion, "vincular", "el apellido suelto preselecciona al mejor");
  assert.ok(resuelto.clientes[1].candidatos.length >= 1, "el apellido suelto deja candidatos para cambiar");
  assert.ok(resuelto.clientes[1].avisos.some((aviso) => aviso.includes("Sugerido")));
});

// ── Cobros (issue #122 §2) ──────────────────────────────────────────────────

test("«X me pagó 750 mil ayer» se resuelve con cliente existente, monto y fecha", () => {
  const analisis = normalizarAnalisis(
    { cobros: [{ cliente: "Constructora Sur", monto: "750 mil", fecha: "ayer", metodo: "transferencia" }] },
    ["cobros"],
    { hoy: HOY },
  );
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: [] });
  const cobro = resuelto.cobros[0];
  assert.equal(cobro.monto, 750_000);
  assert.equal(cobro.montoTexto, "750 mil");
  assert.equal(cobro.fecha, "2026-09-30");
  assert.equal(cobro.fechaTexto, "ayer");
  assert.equal(cobro.metodo, "Transferencia");
  assert.equal(cobro.clienteId, "c1");
  assert.equal(cobro.accion, "registrar_pago");
  assert.deepEqual(cobro.avisos, []);
});

test("un cobro sin cliente resoluble queda pendiente, no crea basura", () => {
  const analisis = normalizarAnalisis(
    { cobros: [{ cliente: "Fantasma", monto: "500.000" }] },
    ["cobros"],
    { hoy: HOY },
  );
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: [] });
  const cobro = resuelto.cobros[0];
  assert.equal(cobro.clienteId, null);
  assert.equal(cobro.monto, 500_000);
  assert.ok(cobro.avisos.some((aviso) => aviso.includes("No encontramos")));
});

test("un cobro con monto ilegible avisa y deja el registro sin monto", () => {
  const analisis = normalizarAnalisis({ cobros: [{ cliente: "Juan Pérez", monto: "varios" }] }, ["cobros"], { hoy: HOY });
  const cobro = analisis.cobros[0];
  assert.equal(cobro.monto, null);
  assert.ok(cobro.avisos.some((aviso) => aviso.includes("Monto")));
});

test("los cobros respetan el tope de registros por tipo", () => {
  const muchos = Array.from({ length: IA_REGISTROS_MAX + 3 }, (_, indice) => ({
    cliente: `Cliente ${indice}`,
    monto: "100.000",
  }));
  const salida = normalizarAnalisis({ cobros: muchos }, ["cobros"], { hoy: HOY });
  assert.equal(salida.cobros.length, IA_REGISTROS_MAX);
  assert.ok(salida.avisos.some((aviso) => aviso.includes("Cobros: se recortó")));
});

test("los precios de producto usan la misma inteligencia de montos", () => {
  const salida = normalizarAnalisis(
    { productos: [{ nombre: "Micrófono", precioLista: "850 mil", precioMayorista: "Gs 700.000", precioMinimo: "varios" }] },
    ["productos"],
  );
  const producto = salida.productos[0];
  assert.equal(producto.precioLista, 850_000);
  assert.equal(producto.precioMayorista, 700_000);
  assert.equal(producto.precioMinimo, null);
  assert.ok(producto.avisos.some((aviso) => aviso.startsWith("Precio mínimo")));
});

// ── Camino completo con proveedor mockeado (sin red) ────────────────────────

test("«Constructora Sur me pagó 500.000» no crea un cliente: vincula y registra el cobro", async () => {
  const proveedor: IaProvider = {
    id: "prueba",
    label: "Proveedor de prueba",
    async analizar() {
      return JSON.stringify({
        cobros: [{ cliente: "Constructora Sur", monto: "500.000", fecha: "hoy", metodo: "efectivo" }],
      });
    },
  };
  const analisis = await analizarCarga({
    texto: "Constructora Sur me pagó 500.000 en efectivo",
    tipos: ["cobros"],
    proveedor,
    hoy: HOY,
  });
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: [] });
  assert.equal(resuelto.clientes.length, 0, "no se propone un cliente nuevo");
  assert.equal(resuelto.cobros[0].clienteId, "c1");
  assert.equal(resuelto.cobros[0].monto, 500_000);
  assert.equal(resuelto.cobros[0].fecha, HOY);
});

test("si el modelo también devuelve el cliente del cobro, se propone vincular", async () => {
  const proveedor: IaProvider = {
    id: "prueba",
    label: "Proveedor de prueba",
    async analizar() {
      return JSON.stringify({
        clientes: [{ nombre: "Constructora Sur" }],
        cobros: [{ cliente: "Constructora Sur", monto: "500000" }],
      });
    },
  };
  const analisis = await analizarCarga({ texto: "texto", tipos: ["clientes", "cobros"], proveedor, hoy: HOY });
  const resuelto = asignarExistentes(analisis, { clientes: CARTERA_CLIENTES, productos: [] });
  assert.equal(resuelto.clientes[0].accion, "vincular", "el cliente ya existe: no se duplica");
  assert.equal(resuelto.clientes[0].existenteId, "c1");
});

// ── Pre-mortem (#122 §4): guardas de fuente ─────────────────────────────────

test("montos y fechas se resuelven acá: el prompt pide copiarlos tal cual", () => {
  const instrucciones = instruccionesIa();
  assert.match(instrucciones, /cobros/);
  assert.match(instrucciones, /TAL CUAL/);
  assert.match(instrucciones, /no conviertas/i);
});

test("el análisis no escribe y el texto no se ensancha con datos de la base", () => {
  const route = repoFile("app/api/admin/ia/carga/route.ts");
  assert.doesNotMatch(route, /\.create\(/, "el asistente no escribe: el panel aplica con los endpoints existentes");
  assert.match(route, /inventoryItem\.findMany/, "el matching de productos corre server-side");
  assert.match(route, /asignarExistentes\(analisis/, "el match se resuelve contra la cartera de la empresa activa");
  assert.match(route, /analizarCarga\(\{ texto, tipos, proveedor: iaProviderDeConfig\(config\) \}\)/, "al proveedor solo va el texto");
  assert.match(route, /cobros: registros\.cobros\.length/, "la auditoría suma los cobros");
});

test("el panel aplica cobros con Finanzas, idempotencia y permiso de FIN", () => {
  const dialog = repoFile("components/admin/AdminCargaIa.tsx");
  assert.match(dialog, /canWriteFinance\(rol\)/, "el cobro se ofrece solo con permiso de Finanzas");
  assert.match(dialog, /"\/api\/admin\/finance"/, "el cobro se registra con el endpoint existente");
  assert.match(dialog, /kind: "client"/);
  assert.match(dialog, /idempotencyKey: true/, "cada acción viaja con clave de idempotencia");
  assert.match(dialog, /fila\.accion === "vincular"/, "lo vinculado no se crea");
  assert.match(dialog, /tu rol no puede registrar cobros/, "sin permiso se avisa y no se llama al endpoint");
  const shell = repoFile("components/admin/AdminShell.tsx");
  assert.doesNotMatch(shell, /AdminCargaIaDialog/, "el encabezado ya no monta el diálogo (la IA vive en «Importar»)");
});
