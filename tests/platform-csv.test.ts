import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCsv, csvCell } from "../lib/admin-export";

test("csvCell neutraliza fórmulas con = + @ tab y retorno", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+595981123456"), "'+595981123456");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tcmd"), "'\tcmd");
  assert.equal(csvCell("\rcmd"), "\"'\rcmd\"");
});

test("csvCell: guion seguido de algo que no es número se neutraliza", () => {
  assert.equal(csvCell("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
  assert.equal(csvCell("-1+2"), "'-1+2");
  assert.equal(csvCell("- 5"), "'- 5");
  assert.equal(csvCell("-"), "'-");
});

test("csvCell: los números negativos siguen siendo números", () => {
  assert.equal(csvCell(-1500), "-1500");
  assert.equal(csvCell(-0.5), "-0.5");
  assert.equal(csvCell("-1500"), "-1500");
  assert.equal(csvCell("-12,5"), "-12,5");
  assert.equal(csvCell(0), "0");
});

test("csvCell: texto normal, vacío y comillas no cambian de comportamiento", () => {
  assert.equal(csvCell("Hola"), "Hola");
  assert.equal(csvCell("a-b"), "a-b");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell("a;b"), "\"a;b\"");
  assert.equal(csvCell("di \"x\""), "\"di \"\"x\"\"\"");
});

test("buildCsv aplica la neutralización a título, encabezado y celdas", () => {
  const csv = buildCsv([{ title: "=T", header: ["@h", "monto"], rows: [["=HYPERLINK(1)", -2500]] }]);
  assert.ok(csv.includes("'=T"));
  assert.ok(csv.includes("'@h;monto"));
  assert.ok(csv.includes("'=HYPERLINK(1);-2500"));
});
