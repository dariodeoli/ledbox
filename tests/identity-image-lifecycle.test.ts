import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as geometry from "../lib/image-framing";

type Node = { type: unknown; props: Record<string, any> };
const source = ts.createSourceFile("AdminUI.tsx", readFileSync("components/admin/AdminUI.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bitmap = { image: {}, width: 400, height: 200, release() {} };
const file = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "fixture.png", { type: "image/png" });
const image = { base64: "prepared", mime: "image/webp", dataUrl: "data:image/webp;base64,prepared", width: 200, height: 200, size: 10 };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
function all(node: any): Node[] { if (Array.isArray(node)) return node.flatMap(all); return node?.props ? [node, ...all(node.props.children)] : []; }

/** Ejecuta el componente real con estado/ref/cleanup persistentes y JSX inerte. */
function harness(name: string, extras: Record<string, unknown> = {}) {
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.ok(component);
  const states: any[] = [], refs: any[] = [], effects: Array<{ deps: any[]; cleanup?: () => void }> = [];
  let si = 0, ri = 0, ei = 0, writes = 0;
  const queued: Array<() => void> = [];
  const React = { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }), Fragment: "fragment" };
  const useState = (initial: any) => { const index = si++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (value: any) => { writes++; states[index] = typeof value === "function" ? value(states[index]) : value; }]; };
  const useRef = (initial: any) => refs[ri++] ?? (refs[ri - 1] = { current: initial });
  const useEffect = (callback: () => unknown, deps: any[]) => {
    const index = ei++, prior = effects[index];
    if (prior && prior.deps.length === deps.length && deps.every((value, i) => Object.is(value, prior.deps[i]))) return;
    queued.push(() => { prior?.cleanup?.(); const cleanup = callback(); effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup as () => void : undefined }; });
  };
  const compiled = ts.transpileModule(`${component.getText(source).replace(/^export /, "")}\n${name};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const renderComponent = runInNewContext(compiled, { React, useState, useRef, useEffect, useId: () => "qa", ...geometry, loadImageSource: async () => bitmap, detectIdentityImageMime: () => true, AdminDialog: "dialog", AdminButton: "button", AdminLoadingRows: "loading", NumberField: "field", AdminIdentityImageEditor: "editor", AbortController, URL, File, Uint8Array, window: { location: { href: "http://localhost:3150/perfil", origin: "http://localhost:3150" } }, ...extras }) as (props: any) => Node;
  return {
    render(props: unknown) { si = 0; ri = 0; ei = 0; const tree = renderComponent(props); for (const effect of queued.splice(0)) effect(); return tree; },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
    writes: () => writes,
  };
}
const applyButton = (tree: Node) => all(tree.props.footer({ requestClose() {} })).find(node => node.props.variant === "primary")!;

test("preparar tras desmontar/cancelar/cambiar archivo no llama onApply; doble clic sólo prepara una vez", async () => {
  for (const transition of ["unmount", "cancel", "new-file", "disabled"]) {
    let applied = 0, preparations = 0;
    const pending = deferred();
    const editor = harness("AdminIdentityImageEditor", { prepareIdentityImage: () => { preparations++; return pending.promise; } });
    const props = { file: file(), mode: "avatar", onApply: () => { applied++; }, onCancel() {} };
    editor.render(props); await flush(); const tree = editor.render(props);
    applyButton(tree).props.onClick(); applyButton(tree).props.onClick();
    assert.equal(preparations, 1, "single-flight inmediato, antes del rerender");
    if (transition === "unmount") editor.unmount();
    if (transition === "cancel") tree.props.onClose();
    if (transition === "new-file") editor.render({ ...props, file: file() });
    if (transition === "disabled") editor.render({ ...props, disabled: true });
    await flush(); const before = editor.writes();
    pending.resolve({ ok: true, image }); await flush();
    assert.equal(applied, 0, transition); assert.equal(editor.writes(), before, `${transition}: ningún finally/error tardío cambia estado`);
    editor.unmount();
  }
});

test("preparación vigente sí aplica una vez", async () => {
  let applied = 0; const pending = deferred();
  const editor = harness("AdminIdentityImageEditor", { prepareIdentityImage: () => pending.promise });
  const props = { file: file(), mode: "logo", onApply: () => { applied++; }, onCancel() {} };
  editor.render(props); await flush(); applyButton(editor.render(props)).props.onClick();
  pending.resolve({ ok: true, image }); await flush(); assert.equal(applied, 1); editor.unmount();
});

test("fetch de imagen actual se aborta al desmontar y no reabre el editor tarde", async () => {
  const pending = deferred(); let signal: AbortSignal | undefined;
  const upload = harness("AdminImageUpload", { fetch: (_: string, options: { signal: AbortSignal }) => { signal = options.signal; return pending.promise; } });
  const props = { label: "Foto", preview: null, editSrc: "/api/admin/me/avatar", onPrepared() {} };
  let tree = upload.render(props);
  all(tree).find(node => node.type === "button" && node.props.children.includes("Editar encuadre"))!.props.onClick();
  upload.unmount(); assert.equal(signal?.aborted, true); const before = upload.writes();
  pending.resolve({ ok: true, blob: async () => new Blob(["old"]) }); await flush();
  assert.equal(upload.writes(), before);
});

test("cambiar origen invalida fetch anterior; reabrir archivo ignora callback de editor cancelado", async () => {
  const requests = [deferred(), deferred()]; let request = 0, prepared = 0;
  const upload = harness("AdminImageUpload", { fetch: () => requests[request++].promise });
  const props = { label: "Logo", preview: null, editSrc: "/api/logo/light", onPrepared() { prepared++; } };
  const edit = (tree: Node) => all(tree).find(node => node.type === "button" && node.props.children.includes("Editar encuadre"))!.props.onClick();
  edit(upload.render(props));
  const next = { ...props, editSrc: "/api/logo/dark" };
  upload.render(next); edit(upload.render(next)); const before = upload.writes();
  requests[0].resolve({ ok: true, blob: async () => new Blob(["old"]) }); await flush(); assert.equal(upload.writes(), before);
  requests[1].resolve({ ok: true, blob: async () => new Blob(["new"]) }); await flush();
  const oldEditor = all(upload.render(next)).find(node => node.type === "editor")!; assert.ok(oldEditor);
  oldEditor.props.onCancel();
  const tree = upload.render(next);
  const input = all(tree).find(node => node.type === "input" && node.props.type === "file")!;
  input.props.onChange({ target: { files: [file()], value: "selected" } });
  const newEditor = all(upload.render(next)).find(node => node.type === "editor")!; assert.ok(newEditor);
  oldEditor.props.onApply(image); assert.equal(prepared, 0, "callback anterior no entrega una imagen tras reabrir");
  newEditor.props.onApply(image); assert.equal(prepared, 1); upload.unmount();
});
