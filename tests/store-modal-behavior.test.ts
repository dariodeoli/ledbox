import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function modal() {
  const source = ts.createSourceFile("ThemePortal.tsx", readFileSync("components/catalog-public/ThemePortal.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "useModalBehavior")!;
  const selector = source.statements.find(n => ts.isVariableStatement(n) && n.getText(source).startsWith("const FOCUSABLE"))!;
  const events = new Map<string, Function>();
  let cleanup: Function = () => {}, closed = 0, restored = 0;
  const previous = { focus: () => { restored++; document.activeElement = previous; } };
  const panel = { focus: () => { document.activeElement = panel; }, contains: (node: unknown) => node === panel, querySelectorAll: () => [] };
  let stack: unknown[] = [panel];
  const document = { activeElement: previous as unknown, body: { style: { overflow: "auto" } }, querySelectorAll: () => stack,
    addEventListener: (name: string, callback: Function) => events.set(name, callback), removeEventListener: (name: string) => events.delete(name) };
  const hook = runInNewContext(ts.transpileModule(selector.getText(source) + "\n" + fn.getText(source).replace(/^export /, "") + "\nuseModalBehavior;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    document, useRef: (value: unknown) => ({ current: value }), useEffect: (callback: Function) => { cleanup = callback(); },
  });
  hook({ current: panel }, () => { closed++; });
  return { document, panel, previous, setStack: (next: unknown[]) => { stack = next; }, closed: () => closed, restored: () => restored,
    key: (key: string) => { let prevented = false; events.get("keydown")!({ key, preventDefault: () => { prevented = true; }, stopPropagation() {} }); return prevented; }, cleanup: () => cleanup() };
}

test("modal tienda conserva foco de origen, bloquea scroll y lo restaura al cerrar", () => {
  const m = modal(); assert.equal(m.document.activeElement, m.panel); assert.equal(m.document.body.style.overflow, "hidden");
  assert.equal(m.key("Tab"), true); m.cleanup();
  assert.equal(m.document.activeElement, m.previous); assert.equal(m.restored(), 1); assert.equal(m.document.body.style.overflow, "auto");
});
test("Escape sólo cierra el modal superior, incluido carrito bajo otro diálogo", () => {
  const m = modal(); m.setStack([m.panel, {}]); m.key("Escape"); assert.equal(m.closed(), 0);
  m.setStack([m.panel]); m.key("Escape"); assert.equal(m.closed(), 1); m.cleanup();
});
