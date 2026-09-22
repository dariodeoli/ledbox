import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStatementPreview,
  parseStatementAmount,
  parseStatementCsv,
  parseStatementDayKey,
  movementSign,
  statementMatchCandidates,
  statementRowFingerprint,
  statementRowSign,
  suggestStatementMapping,
  validateStatementMapping,
} from "../lib/bank-statement";

/**
 * Reglas puras del extracto bancario (issue #40): lectura del CSV, mapeo
 * asistido, normalización por fila, huella de duplicados y sugerencias de match
 * contra tesorería. El API revalida con estas mismas funciones.
 */

test("extracto: separa comillas, comas y saltos de línea dentro de un campo", () => {
  const csv = parseStatementCsv(
    [
      "Fecha;Descripcion;Referencia;Debito;Credito",
      '15/09/2026;"Transferencia recibida, cliente A";TRF-1;;1500000',
      "16/09/2026;Comision banco;;15000;",
      '"17/09/2026";"Detalle con\nsalto";REF2;;2000',
    ].join("\r\n"),
  );
  assert.equal(csv.delimiter, ";");
  assert.deepEqual(csv.header, ["Fecha", "Descripcion", "Referencia", "Debito", "Credito"]);
  assert.equal(csv.records.length, 3);
  assert.deepEqual(csv.records[0].cells, ["15/09/2026", "Transferencia recibida, cliente A", "TRF-1", "", "1500000"]);
  assert.equal(csv.records[2].cells[1], "Detalle con\nsalto");
  assert.equal(csv.records[2].line, 4);
});

test("extracto: detecta el separador de una planilla pegada (tabuladores)", () => {
  const csv = parseStatementCsv("Fecha\tMonto\tDetalle\n01/09/2026\t-50000\tComision\n");
  assert.equal(csv.delimiter, "\t");
  assert.deepEqual(csv.header, ["Fecha", "Monto", "Detalle"]);
  assert.equal(csv.records.length, 1);
});

test("extracto: mapeo asistido por encabezado y validación de combinaciones", () => {
  const mapping = suggestStatementMapping(["FECHA MOV", "Descripción del movimiento", "Nº doc", "Débitos", "Créditos"]);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.description, 1);
  assert.equal(mapping.reference, 2);
  assert.equal(mapping.debit, 3);
  assert.equal(mapping.credit, 4);
  assert.equal(mapping.amount, -1);
  assert.equal(validateStatementMapping(mapping, ["a", "b", "c", "d", "e"]), null);

  const single = suggestStatementMapping(["Fecha", "Concepto", "Importe"]);
  assert.equal(single.amount, 2);
  assert.equal(validateStatementMapping(single, ["a", "b", "c"]), null);

  assert.match(
    validateStatementMapping({ ...mapping, credit: -1 }, ["a", "b", "c", "d", "e"]) ?? "",
    /débito y crédito/,
  );
  assert.match(validateStatementMapping({ date: -1, description: 1, reference: -1, debit: -1, credit: -1, amount: 2 }, ["a", "b", "c"]) ?? "", /fecha/);
  assert.match(
    validateStatementMapping({ date: 0, description: 0, reference: -1, debit: -1, credit: -1, amount: 2 }, ["a", "b", "c"]) ?? "",
    /columna distinta/,
  );
});

test("extracto: fechas ISO, DD/MM/AAAA y DD-MM-AA; el día inválido se descarta", () => {
  assert.equal(parseStatementDayKey("2026-09-15"), "2026-09-15");
  assert.equal(parseStatementDayKey("15/09/2026"), "2026-09-15");
  assert.equal(parseStatementDayKey("5-9-26"), "2026-09-05");
  assert.equal(parseStatementDayKey("15/09/26"), "2026-09-15");
  assert.equal(parseStatementDayKey("2026/09/15"), "2026-09-15");
  assert.equal(parseStatementDayKey("31/02/2026"), null);
  assert.equal(parseStatementDayKey("15/13/2026"), null);
  assert.equal(parseStatementDayKey(""), null);
  assert.equal(parseStatementDayKey("hoy"), null);
});

test("extracto: montos PYG con separadores, Gs. y signo", () => {
  assert.deepEqual(parseStatementAmount("1.500.000"), { ok: true, amount: 1500000 });
  assert.deepEqual(parseStatementAmount("1,500,000"), { ok: true, amount: 1500000 });
  assert.deepEqual(parseStatementAmount("1500000.00"), { ok: true, amount: 1500000 });
  assert.deepEqual(parseStatementAmount("Gs. 1.500.000"), { ok: true, amount: 1500000 });
  assert.deepEqual(parseStatementAmount("-1500000"), { ok: true, amount: -1500000 });
  assert.deepEqual(parseStatementAmount("(1500000)"), { ok: true, amount: -1500000 });
  assert.deepEqual(parseStatementAmount("1.500.000,00"), { ok: true, amount: 1500000 });
  const cents = parseStatementAmount("1.500.000,50");
  assert.equal(cents.ok, false);
  const bad = parseStatementAmount("mil quinientos");
  assert.equal(bad.ok, false);
  const zero = parseStatementAmount("0");
  assert.equal(zero.ok, false);
});

test("extracto: vista previa con errores por fila y débito/crédito", () => {
  const csv = parseStatementCsv(
    [
      "Fecha;Descripcion;Referencia;Debito;Credito",
      "15/09/2026;Transferencia cliente;TRF-1;;1500000",
      "16/09/2026;Comision banco;;15000;",
      "31/02/2026;Fecha rota;;1000;",
      "17/09/2026;Débito y crédito juntos;;1000;1000",
      "18/09/2026;Sin monto;;;;",
      "19/09/2026;Pago proveedor;OP-9;250000;",
    ].join("\n"),
  );
  const mapping = suggestStatementMapping(csv.header);
  const preview = buildStatementPreview(csv, mapping);
  assert.equal(preview.total, 6);
  assert.equal(preview.ok, 3);
  assert.equal(preview.errors, 3);
  assert.equal(preview.rows[0].direction, "CREDIT");
  assert.equal(preview.rows[0].amount, 1500000);
  assert.equal(preview.rows[1].direction, "DEBIT");
  assert.equal(preview.rows[1].amount, 15000);
  assert.match(preview.rows[2].error ?? "", /fecha/i);
  assert.match(preview.rows[3].error ?? "", /débito y crédito/i);
  assert.match(preview.rows[4].error ?? "", /débito ni crédito/i);
  assert.equal(preview.rows[5].direction, "DEBIT");
  assert.equal(preview.rows[5].reference, "OP-9");
  assert.equal(preview.rows[5].raw, "19/09/2026;Pago proveedor;OP-9;250000;");
});

test("extracto: una sola columna de monto usa el signo", () => {
  const csv = parseStatementCsv("Fecha;Detalle;Importe\n15/09/2026;Cobro;1500000\n16/09/2026;Pago;-250000\n");
  const mapping = suggestStatementMapping(csv.header);
  assert.equal(mapping.amount, 2);
  const preview = buildStatementPreview(csv, mapping);
  assert.equal(preview.errors, 0);
  assert.equal(preview.rows[0].direction, "CREDIT");
  assert.equal(preview.rows[0].amount, 1500000);
  assert.equal(preview.rows[1].direction, "DEBIT");
  assert.equal(preview.rows[1].amount, 250000);
});

test("extracto: la huella ignora tildes, mayúsculas y espacios de más", () => {
  const first = statementRowFingerprint({
    date: "2026-09-15",
    direction: "CREDIT",
    amount: 1500000,
    description: "Transferencia  Recibida",
    reference: "TRF-1",
  });
  const second = statementRowFingerprint({
    date: "2026-09-15",
    direction: "CREDIT",
    amount: 1500000,
    description: "transferencia recibida",
    reference: "trf-1",
  });
  assert.equal(first, second);
  const other = statementRowFingerprint({
    date: "2026-09-15",
    direction: "DEBIT",
    amount: 1500000,
    description: "Transferencia recibida",
    reference: "TRF-1",
  });
  assert.notEqual(first, other);
});

test("extracto: sugerencias mismo signo, mismo importe y fecha ±3 días", () => {
  const movements = [
    { id: "m1", accountId: "a", counterAccountId: null, direction: "IN", amount: 1500000, occurredAt: "2026-09-16T04:00:00.000Z" },
    { id: "m2", accountId: "a", counterAccountId: null, direction: "OUT", amount: 1500000, occurredAt: "2026-09-15T04:00:00.000Z" },
    { id: "m3", accountId: "a", counterAccountId: null, direction: "IN", amount: 1500000, occurredAt: "2026-09-25T04:00:00.000Z" },
    { id: "m4", accountId: "b", counterAccountId: null, direction: "IN", amount: 1500000, occurredAt: "2026-09-16T04:00:00.000Z" },
    { id: "m5", accountId: "b", counterAccountId: "a", direction: "TRANSFER", amount: 1500000, occurredAt: "2026-09-14T04:00:00.000Z" },
  ];
  const credit = statementMatchCandidates({ date: "2026-09-15", direction: "CREDIT", amount: 1500000 }, movements, "a");
  assert.deepEqual(
    credit.map((movement) => movement.id),
    ["m5", "m1"],
  );
  const debit = statementMatchCandidates({ date: "2026-09-15", direction: "DEBIT", amount: 1500000 }, movements, "a");
  assert.deepEqual(
    debit.map((movement) => movement.id),
    ["m2"],
  );
  assert.equal(statementRowSign("DEBIT"), -1);
  assert.equal(statementRowSign("CREDIT"), 1);
  assert.equal(movementSign({ accountId: "a", counterAccountId: null, direction: "IN" }, "a"), 1);
  assert.equal(movementSign({ accountId: "a", counterAccountId: null, direction: "OUT" }, "a"), -1);
  assert.equal(movementSign({ accountId: "a", counterAccountId: null, direction: "TRANSFER" }, "a"), -1);
  assert.equal(movementSign({ accountId: "b", counterAccountId: "a", direction: "TRANSFER" }, "a"), 1);
  assert.equal(movementSign({ accountId: "b", counterAccountId: null, direction: "IN" }, "a"), 0);
});

test("extracto: la ventana de sugerencias se puede ampliar", () => {
  const movements = [
    { id: "m1", accountId: "a", counterAccountId: null, direction: "IN", amount: 900000, occurredAt: "2026-09-25T04:00:00.000Z" },
  ];
  const row = { date: "2026-09-15", direction: "CREDIT" as const, amount: 900000 };
  assert.deepEqual(statementMatchCandidates(row, movements, "a"), []);
  assert.deepEqual(
    statementMatchCandidates(row, movements, "a", 10).map((movement) => movement.id),
    ["m1"],
  );
});
