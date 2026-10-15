import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function sourceOf(path: string) { return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function namedFunction(source: ts.SourceFile, name: string) {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(found, `falta ${name}`); return found.getText(source);
}
function evaluate(code: string, context: Record<string, unknown>) { return runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context); }

test("Directorio difiere navegación SPA hasta confirmar edición; cancelar conserva cambios", () => {
  const tabs = sourceOf("components/admin/modules/ClientesTabs.tsx");
  const editor = sourceOf("components/admin/modules/PlantillasModule.tsx");
  let pending: (() => void) | null = null;
  const navigation: string[] = [];
  const requestChange = evaluate(`${namedFunction(editor, "requestChange")}\nrequestChange;`, {
    busy: false, dirty: true, setPendingChange: (factory: () => () => void) => { pending = factory(); },
  }) as (action: () => void) => void;
  const onLinkClick = evaluate(`${namedFunction(tabs, "onLinkClick")}\nonLinkClick;`, {
    onNavigate: (href: string) => requestChange(() => navigation.push(href)),
  }) as (event: unknown) => void;
  const event = (overrides = {}) => {
    let prevented = false;
    const link = { getAttribute: (name: string) => name === "href" ? "/clientes" : null, hasAttribute: () => false };
    return { event: { button: 0, target: { closest: () => link }, preventDefault: () => { prevented = true; }, ...overrides }, prevented: () => prevented };
  };
  const click = event(); onLinkClick(click.event);
  assert.equal(click.prevented(), true); assert.deepEqual(navigation, []); assert.ok(pending);
  pending = null; // Cancelar sólo cierra el diálogo y no ejecuta la acción diferida.
  assert.deepEqual(navigation, []);
  onLinkClick(event().event); assert.ok(pending); (pending as () => void)();
  assert.deepEqual(navigation, ["/clientes"]);
  pending = null;
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    const modified = event({ [modifier]: true }); onLinkClick(modified.event);
    assert.equal(modified.prevented(), false); assert.equal(pending, null);
  }
  assert.match(readFileSync("components/admin/modules/PlantillasModule.tsx", "utf8"), /onNavigate=\{\(href\) => requestChange\(\(\) => router\.push\(href\)\)\}/);
});

test("reclasificar cambia form.category sin descartar texto ni título y reinicia modelo anterior", () => {
  const source = sourceOf("components/admin/modules/PlantillasModule.tsx");
  let handler: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "SelectField") {
      const attrs = node.attributes.properties;
      const label = attrs.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "label") as ts.JsxAttribute | undefined;
      if (label?.initializer && ts.isStringLiteral(label.initializer) && label.initializer.text === "Categoría de la plantilla") {
        const change = attrs.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "onChange") as ts.JsxAttribute;
        assert.ok(change.initializer && ts.isJsxExpression(change.initializer) && change.initializer.expression && ts.isArrowFunction(change.initializer.expression));
        handler = change.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(handler);
  const form = { id: "qa", category: "client", title: "Personalizada", body: "Hola {{cliente}}", active: false };
  let changed = form, model = "client_bienvenida", error = "error anterior";
  const onChange = evaluate(`(${handler.getText(source)})`, { form, setForm: (value: typeof form) => { changed = value; }, setModelKey: (value: string) => { model = value; }, setError: (value: string) => { error = value; } }) as (category: string) => void;
  onChange("event");
  assert.equal(changed.category, "event"); assert.equal(changed.body, form.body); assert.equal(changed.title, form.title); assert.equal(changed.active, false);
  assert.equal(model, ""); assert.equal(error, "");
});
