import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import React from "react";
import { buildCsv } from "../lib/admin-export";
function component() {
    const report = { lote: "old-lote", filasPrecio: [{ fila: 1, codigo: "=SUM(1)", estado: "conflicto", mensaje: "Changed" }], reintento: { productos: [{ codigo: "B", cambios: { listPrice: { op: "CLEAR" } } }] } };
    const state: any[] = [null, { filas: [{ fila: 1, codigo: "=SUM(1)", nombre: "A", detalle: "Invalid", errores: ["Invalid"], cambios: [] }] }, "new-lote", "old-lote", [report], false, null];
    let cursor = 0;
    const changes: Array<{
        index: number;
        value: any;
    }> = [];
    let csv = "";
    const AdminButton = () => null, FileField = () => null;
    const exports: any = {};
    const source = ts.transpileModule(readFileSync("components/admin/SelectedPriceImport.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    runInNewContext(source, { exports, React, File, require: (name: string) => {
            if (name === "react")
                return { ...React, useState: () => { const index = cursor++; return [state[index], (value: any) => changes.push({ index, value })]; }, useEffect() { }, useRef: (value: any) => ({ current: value }) };
            if (name === "./AdminUI")
                return { AdminDialog: () => null, AdminButton };
            if (name === "./AdminFields")
                return { FileField, TextField: () => null };
            if (name.includes("admin-export"))
                return { csvFilename: () => "test.csv", downloadCsv: (_name: string, blocks: any) => { csv = buildCsv(blocks); } };
            if (name.includes("admin-format"))
                return { formatMoney: (value: number) => String(value) };
            return {};
        } });
    const tree = exports.SelectedPriceImport({ onClose() { }, onBack() { } });
    const nodes: any[] = [];
    const walk = (node: any) => { if (!node || typeof node !== "object")
        return; if (Array.isArray(node)) {
        node.forEach(walk);
        return;
    } nodes.push(node); walk(node.props?.children); };
    walk(tree);
    walk(tree.props.footer);
    const button = (label: string) => nodes.find(node => node.type === AdminButton && node.props.children === label);
    return { report, state, changes, button, nodes, FileField, csv: () => csv };
}
test("real selective component keeps previous reports on next batch, invalidates preview on upload and prepares only server pending rows", async () => {
    const f = component();
    f.button("Cargar otro lote (conservar reportes)").props.onClick();
    assert.ok(!f.changes.some(c => c.index === 4));
    assert.ok(f.changes.some(c => c.index === 1 && c.value === null));
    f.button("Preparar sólo pendientes para nueva revisión").props.onClick();
    const retry = f.changes.find(c => c.index === 0 && c.value instanceof File)!.value;
    assert.deepEqual(JSON.parse(await retry.text()), f.report.reintento);
    assert.ok(!String(await retry.text()).includes("=SUM"));
    f.nodes.find(n => n.type === f.FileField).props.onSelect(null);
    assert.ok(f.changes.some(c => c.index === 2 && c.value === ""));
});
test("real selective report and preview CSV exports use shared formula neutralization", () => {
    const f = component();
    f.button("Descargar reporte CSV").props.onClick();
    assert.ok(f.csv().includes("'=SUM(1)"));
    f.button("Descargar revisión CSV").props.onClick();
    assert.ok(f.csv().includes("'=SUM(1)"));
    assert.ok(f.csv().includes("Invalid"));
});
