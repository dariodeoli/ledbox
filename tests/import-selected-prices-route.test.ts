import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
function route(globals: Record<string, unknown>) {
    const source = ts.createSourceFile("route.ts", readFileSync("app/api/admin/import/[modulo]/route.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "POST")!;
    return runInNewContext(ts.transpileModule(fn.getText(source).replace(/^export /, "") + ";POST;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { Response, Request, Blob, FormData, JSON, ...globals });
}
async function request(accion = "preview") {
    const form = new FormData();
    form.set("modo", "UPDATE_SELECTED");
    form.set("accion", accion);
    form.set("fuente", "json");
    form.set("json", new File([JSON.stringify({ productos: [{ codigo: "A", cambios: { listPrice: { op: "CLEAR" } } }] })], "prices.json", { type: "application/json" }));
    form.set("catalogo", '{"productos":[]}');
    form.set("confirmationToken", "signed");
    form.set("lote", "lote");
    return new Request("http://localhost/api/admin/import/productos", { method: "POST", body: form });
}
test("real import dispatch routes selected prices before legacy normalizer/apply; preserves guard and module boundary", async () => {
    let calls = 0, legacy = 0, module = "productos", allowed = true;
    const run = route({ guard: async () => allowed ? { ok: true, module: { id: module }, context: { organizationId: "tenant" } } : { ok: false, response: new Response("Forbidden", { status: 403 }) },
        readBodyLimited: async (r: Request) => ({ ok: true, bytes: new Uint8Array(await r.arrayBuffer()) }), TOTAL_BODY_MAX: 1e6,
        textOf: (f: FormData, key: string) => String(f.get(key) ?? ""), fileOf: (f: FormData, key: string) => f.get(key), CATALOG_LIMITS: { jsonBytes: 2e6 },
        rateLimit: async () => ({ allowed: true }), jsonError: (error: string, status: number) => Response.json({ error }, { status }),
        previewSelectedPrices: async (ctx: any, raw: any) => { calls++; assert.equal(ctx.organizationId, "tenant"); assert.equal(raw.productos[0].codigo, "A"); return Response.json({ dispatched: true }); },
        applySelectedPrices: async (_ctx: any, _raw: any, token: string, lote: string) => { calls++; assert.equal(token, "signed"); assert.equal(lote, "lote"); return Response.json({ applied: true }); },
        readSource: () => { legacy++; throw new Error("legacy must not run"); },
    });
    assert.equal((await run(await request(), { params: Promise.resolve({ modulo: module }) })).status, 200);
    assert.equal((await run(await request("apply"), { params: Promise.resolve({ modulo: module }) })).status, 200);
    assert.equal(calls, 2);
    assert.equal(legacy, 0);
    module = "gastos";
    assert.equal((await run(await request(), { params: Promise.resolve({ modulo: module }) })).status, 400);
    assert.equal(calls, 2);
    allowed = false;
    assert.equal((await run(await request(), { params: Promise.resolve({ modulo: "productos" }) })).status, 403);
    assert.equal(calls, 2);
});
