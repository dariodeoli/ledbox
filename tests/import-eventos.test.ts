import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEventos, parseEventoDay, parseEventoEstado, parseEventosJson, parseProductosTexto, sinStockMensaje } from "../lib/import-eventos";
import { importHeaders, importModule } from "../lib/import-modules";
import { buildCsv, readSheetFile, templateCsv, templateRows } from "../lib/server/import-tabular";

const base = {
  codigo: "EV-2026-001",
  nombre: "Boda Pérez",
  cliente: { nombre: "Ana Pérez", telefono: "0981 000 000", correo: "ANA@Ejemplo.com" },
  desde: "2026-11-14",
  hasta: "2026-11-15",
  lugar: "Salón X",
  estado: "confirmado",
  productos: [
    { codigo: "527", cantidad: 1 },
    { codigo: "1482", cantidad: 10 },
  ],
  notas: null,
};

const ok = (raw: unknown) => {
  const result = normalizeEventos(raw);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.value;
};

test("fechas: ISO, dd/mm/aaaa, serie de Excel; nunca se adivina", () => {
  assert.equal(parseEventoDay("2026-11-14"), "2026-11-14");
  assert.equal(parseEventoDay("2026-11-14T10:30:00-03:00"), "2026-11-14");
  assert.equal(parseEventoDay("14/11/2026"), "2026-11-14");
  assert.equal(parseEventoDay("3/4/2026"), "2026-04-03", "dd/mm: 3 de abril, no 4 de marzo");
  assert.equal(parseEventoDay("14-11-2026"), "2026-11-14");
  assert.equal(parseEventoDay("46340"), "2026-11-14", "número de serie de una celda de fecha de Excel");
  for (const bad of ["31/02/2026", "2026-13-01", "mañana", "", null, undefined, "14/11/26", "1999-01-01"]) assert.equal(parseEventoDay(bad), null, String(bad));
});

test("estado: alias aceptados y rechazo de lo desconocido", () => {
  assert.equal(parseEventoEstado("Confirmado"), "confirmado");
  assert.equal(parseEventoEstado(" TENTATIVA "), "tentativo");
  assert.equal(parseEventoEstado("cancelado"), "cancelado");
  assert.equal(parseEventoEstado("hecho"), null);
});

test("productos de planilla: «codigo x cantidad» separados por punto y coma", () => {
  assert.deepEqual(parseProductosTexto("527x1; 1482 x 10;PK-1"), { ok: true, lineas: [{ codigo: "527", cantidad: 1 }, { codigo: "1482", cantidad: 10 }, { codigo: "PK-1", cantidad: 1 }] });
  assert.equal(parseProductosTexto("527x0").ok, false);
  assert.equal(parseProductosTexto("x5").ok, false);
});

test("un evento válido se normaliza (teléfono y correo con field-rules)", () => {
  const { eventos, problems } = ok({ eventos: [base] });
  assert.equal(problems.filter((p) => p.nivel === "error").length, 0);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].cliente.correo, "ana@ejemplo.com");
  assert.match(eventos[0].cliente.telefono ?? "", /^\+595/);
  assert.equal(eventos[0].estado, "confirmado");
  assert.deepEqual(eventos[0].productos, [{ codigo: "527", cantidad: 1 }, { codigo: "1482", cantidad: 10 }]);
});

test("errores por evento sin tumbar al resto: código, nombre, cliente, fechas, estado, productos", () => {
  const { eventos, problems } = ok({
    eventos: [
      base,
      { ...base, codigo: "" },
      { ...base, codigo: "EV-2", nombre: "" },
      { ...base, codigo: "EV-3", cliente: {} },
      { ...base, codigo: "EV-4", desde: "no sé" },
      { ...base, codigo: "EV-5", hasta: "2026-11-01" },
      { ...base, codigo: "EV-6", estado: "hecho" },
      { ...base, codigo: "EV-7", productos: [{ codigo: "527", cantidad: 0 }] },
      { ...base, codigo: "EV-8", productos: "527 @ 2" },
      { ...base, codigo: "ev-2026-001" },
    ],
  });
  assert.deepEqual(eventos.map((e) => e.codigo), ["EV-2026-001"]);
  const errors = problems.filter((p) => p.nivel === "error");
  assert.equal(errors.length, 9);
  assert.ok(errors.some((p) => p.tipo === "duplicado" && /fila 1/.test(p.mensaje)), "el código repetido (sin importar mayúsculas) se omite");
  assert.ok(errors.some((p) => p.tipo === "fecha" && /anterior/.test(p.mensaje)));
});

test("lo dudoso avisa y no inventa: sin estado = borrador, teléfono inválido se descarta, productos repetidos se suman", () => {
  const { eventos, problems } = ok({
    eventos: [{ ...base, estado: null, cliente: { nombre: "Ana", telefono: "123", correo: "no-es-correo" }, productos: [{ codigo: "527", cantidad: 1 }, { codigo: "527", cantidad: 2 }] }],
  });
  assert.equal(eventos[0].estado, "borrador");
  assert.equal(eventos[0].cliente.telefono, null);
  assert.equal(eventos[0].cliente.correo, null);
  assert.deepEqual(eventos[0].productos, [{ codigo: "527", cantidad: 3 }]);
  assert.equal(problems.filter((p) => p.nivel === "error").length, 0);
  assert.ok(problems.some((p) => p.tipo === "estado"));
  assert.equal(problems.filter((p) => p.tipo === "contacto").length, 2);
  assert.ok(problems.some((p) => p.tipo === "producto" && /repetido/.test(p.mensaje)));
});

test("límites del archivo", () => {
  assert.equal(normalizeEventos({ eventos: [] }).ok, false);
  assert.equal(normalizeEventos({ foo: 1 }).ok, false);
  assert.equal(normalizeEventos({ eventos: Array.from({ length: 501 }, (_, i) => ({ ...base, codigo: `E${i}` })) }).ok, false);
  assert.equal(parseEventosJson("{no", 1000).ok, false);
  assert.equal(parseEventosJson(JSON.stringify({ eventos: [base] }), 10).ok, false, "supera el tamaño");
  assert.ok(parseEventosJson(`﻿${JSON.stringify({ eventos: [base] })}`, 10_000).ok, "acepta BOM");
});

test("planilla .csv: plantilla, fila de ejemplo ignorada, cliente plano y productos en texto", () => {
  const module = importModule("eventos");
  assert.ok(module, "el módulo eventos está implementado");
  assert.equal(module.capability, "events.write");
  assert.deepEqual(importHeaders(module), ["codigo", "nombre", "cliente", "telefono", "correo", "desde", "hasta", "lugar", "estado", "productos", "notas"]);
  assert.match(templateCsv(module), /EV-2026-001/);
  const csv = buildCsv([
    importHeaders(module),
    templateRows(module)[1],
    ["EV-10", "Cumple Gómez", "Luis Gómez", "0971 111 222", "", "20/12/2026", "20/12/2026", "Quincho", "Tentativo", "527x2; PK-1x1", "Llevar mantel"],
  ]);
  const sheet = readSheetFile(module, new TextEncoder().encode(csv));
  assert.ok(sheet.ok);
  assert.equal(sheet.rows.length, 1, "la fila de ejemplo no se importa");
  const { eventos, problems } = ok({ eventos: sheet.rows });
  assert.equal(problems.filter((p) => p.nivel === "error").length, 0);
  assert.equal(eventos[0].desde, "2026-12-20");
  assert.equal(eventos[0].estado, "tentativo");
  assert.equal(eventos[0].cliente.nombre, "Luis Gómez");
  assert.deepEqual(eventos[0].productos, [{ codigo: "527", cantidad: 2 }, { codigo: "PK-1", cantidad: 1 }]);
  assert.equal(readSheetFile(module, new TextEncoder().encode("codigo,nombre\nA,B\n")).ok, false, "faltan columnas");
});

test("aviso por línea sin stock", () => {
  assert.equal(sinStockMensaje("Lounge Oslo", 2, 1), "Lounge Oslo: piden 2, hay 1 libre en esas fechas");
  assert.equal(sinStockMensaje("Silla", 5, 0), "Silla: piden 5, hay 0 libres en esas fechas");
});
