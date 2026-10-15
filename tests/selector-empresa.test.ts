import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("la caja «Empresa» abre la lista para cambiar de empresa y llama al PATCH de la sesión", () => {
  const shell = readFileSync("components/admin/AdminShell.tsx", "utf8");
  assert.match(shell, /aria-label="Cambiar de empresa"/);
  assert.match(shell, /function AdminCompanySwitcher/);
  assert.match(shell, /role="menuitemradio"/);
  assert.match(shell, /session\.organizations\.length > 1/);
  assert.match(shell, /fetch\("\/api\/admin\/session", \{\s*method: "PATCH"/);
  const route = readFileSync("app/api/admin/session/route.ts", "utf8");
  assert.match(route, /setActiveOrganization\(result\.context, organizationId\)/);
});

test("selector de empresa: foco inicial, navegación circular, extremos, Escape y Tab sin bloqueo", async () => {
  // Ejecuta el efecto real del componente; no replica su manejador de teclado.
  const ts = await import("typescript");
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync("components/admin/AdminShell.tsx", "utf8");
  const parsed = ts.createSourceFile("AdminShell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const company = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AdminCompanySwitcher");
  assert.ok(company);
  let effect: import("typescript").ArrowFunction | undefined;
  const visit = (node: import("typescript").Node) => {
    if (!effect && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useEffect" && ts.isArrowFunction(node.arguments[0])) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(company);
  assert.ok(effect);
  const listeners = new Map<string, (event: { key?: string; target: unknown; preventDefault?: () => void }) => void>();
  const doc = {
    activeElement: null as unknown,
    addEventListener: (name: string, handler: (event: { key?: string; target: unknown; preventDefault?: () => void }) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const closes: boolean[] = [];
  const first = { getAttribute: () => "false", focus: () => { doc.activeElement = first; } };
  const current = { getAttribute: () => "true", focus: () => { doc.activeElement = current; } };
  const settings = { getAttribute: () => null, focus: () => { doc.activeElement = settings; } };
  const trigger = { focus: () => { doc.activeElement = trigger; } };
  const items = [first, current, settings];
  const cleanup = runInNewContext(ts.transpileModule(`(${effect.getText(parsed)})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    open: true,
    document: doc,
    setOpen: (value: boolean) => closes.push(value),
    rootRef: { current: { contains: (target: unknown) => [...items, trigger].includes(target as typeof first) } },
    menuRef: { current: { querySelectorAll: (selector: string) => {
      assert.match(selector, /menuitemradio/); assert.match(selector, /menuitem/);
      assert.match(selector, /:not\(:disabled\)/); assert.match(selector, /aria-disabled="true"/);
      return items;
    } } },
    triggerRef: { current: trigger },
  }) as () => void;
  assert.equal(doc.activeElement, current, "abre enfocado en la empresa activa");
  const key = (name: string, target = doc.activeElement) => {
    let prevented = false;
    listeners.get("keydown")!({ key: name, target, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  assert.equal(key("ArrowDown"), true); assert.equal(doc.activeElement, settings);
  key("ArrowDown"); assert.equal(doc.activeElement, first, "rota al principio");
  key("ArrowUp"); assert.equal(doc.activeElement, settings, "rota al final");
  key("Home"); assert.equal(doc.activeElement, first);
  key("End"); assert.equal(doc.activeElement, settings);
  assert.equal(key("Escape"), true); assert.equal(doc.activeElement, trigger); assert.equal(closes.at(-1), false);
  first.focus();
  assert.equal(key("Tab"), false, "no cancela el desplazamiento nativo");
  assert.equal(doc.activeElement, first, "no impone otro destino al navegador");
  assert.equal(closes.at(-1), false);
  const previousCloses = closes.length;
  assert.equal(key("ArrowDown", {}), false, "no captura teclado de otros controles");
  assert.equal(closes.length, previousCloses);
  cleanup(); assert.equal(listeners.size, 0);
});
