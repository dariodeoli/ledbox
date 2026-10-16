import assert from "node:assert/strict";
import { test } from "node:test";
import { readSelectedPrices, selectedPriceValue } from "../lib/import-selected-prices";
function row(cambios: unknown) { const parsed = readSelectedPrices({ productos: [{ codigo: "A", cambios }] }); assert.ok(parsed.ok); return parsed.rows[0]; }
test("explicit price instructions distinguish omitted/KEEP/CLEAR/zero; malformed replacements never clear", () => {
    assert.deepEqual(row({}).cambios, {});
    assert.equal(selectedPriceValue({ op: "KEEP" }, "listPrice"), undefined);
    assert.equal(selectedPriceValue({ op: "CLEAR" }, "listPrice"), 0);
    assert.equal(selectedPriceValue({ op: "CLEAR" }, "tarifasFinal") instanceof Array, true);
    for (const value of [null, undefined, "", "null", "25000", -1, 1.2, NaN, 2147483648])
        assert.ok(row({ listPrice: { op: "REPLACE", value } }).errores.length);
    assert.equal(row({ listPrice: { op: "REPLACE", value: 0 } }).errores.length, 0);
    assert.ok(row({ listPrice: { op: "CLEAR", value: null } }).errores.length);
    assert.ok(row({ tarifasFinal: { op: "REPLACE", value: null } }).errores.length);
    assert.equal(row({ tarifasFinal: { op: "REPLACE", value: [] } }).errores.length, 0);
});
test("canonical tier and price validators reject unsupported fields; identity-only sparse row is supported", () => {
    assert.equal(row({ wholesalePrice: { op: "REPLACE", value: 5000 } }).errores.length, 0);
    assert.equal(row({ tarifasMayorista: { op: "REPLACE", value: [{ fromDays: 3, mode: "TOTAL", price: 9000 }] } }).errores.length, 0);
    for (const cambios of [{ cantidad: { op: "CLEAR" } }, { fotos: { op: "CLEAR" } }, { tarifasFinal: { op: "REPLACE", value: [{ fromDays: 0, mode: "TOTAL", price: 2 }] } }])
        assert.ok(row(cambios).errores.length);
    const parsed = readSelectedPrices({ productos: [{ codigo: "A", cambios: {} }, { codigo: "A", cambios: {} }] });
    assert.ok(parsed.ok);
    assert.ok(parsed.rows.every(r => r.errores.some(e => /repetido/.test(e))));
    assert.equal(readSelectedPrices({ productos: [], categorias: [] }).ok, false);
});
