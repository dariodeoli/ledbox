import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

/** Ejecuta el formulario real con hooks controlados: no replica el flujo fiscal. */
function harness() {
  const file = ts.createSourceFile("ClientFiscalFields.tsx", readFileSync("components/admin/modules/ClientFiscalFields.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = file.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "ClientFiscalFields")!;
  const state: unknown[] = [], refs: { current: unknown }[] = [];
  let si = 0, ri = 0, calls = 0;
  let resolve!: (value: unknown) => void;
  const changes: unknown[] = [];
  const render = runInNewContext(ts.transpileModule(declaration.getText(file).replace(/^export /, "") + "\nClientFiscalFields;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, {
    React: { Fragment: "fragment", createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }) },
    useState: (initial: unknown) => { const i = si++; if (!(i in state)) state[i] = initial; return [state[i], (next: unknown) => { state[i] = next; }]; },
    useRef: (initial: unknown) => { const i = ri++; return refs[i] ?? (refs[i] = { current: initial }); },
    useEffect: () => {},
    adminSend: () => { calls++; return new Promise((r) => { resolve = r; }); },
    ...Object.fromEntries(["AdminButton", "AdminNote", "TextField", "RucField"].map((x) => [x, x])),
    formatNumber: String, formatDateTime: String,
    representativeName: (value: string) => {
      const [surname, given, ...rest] = value.split(",").map((part) => part.trim()).filter(Boolean);
      return surname && given && rest.length === 0 ? `${given} ${surname}` : "";
    },
  });
  const draw = (ruc = "1234567-0") => { si = ri = 0; return render({ ruc, legalName: "", snapshot: null, confirmed: false, onChange: (p: unknown) => changes.push(p) }); };
  return { draw, changes, calls: () => calls, finish: async (name = "RAZÓN FICTICIA") => {
    resolve({ ok: true, data: { name, fullRuc: "1234567-0", confirmationToken: "signed-test", ownData: { provenance: {}, quota: {} } } });
    await Promise.resolve(); await Promise.resolve();
  } };
}
type Node = { type?: string; props?: Record<string, any> };
function nodes(tree: any): Node[] { return Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : []; }
function extract(tree: any) { return nodes(tree).find((n) => n.type === "AdminButton" && n.props?.children.includes("Extraer datos del RUC"))!; }

test("Extraer consulta al clic, bloquea doble clic y aplica solo identidad fiscal editable", async () => {
  const h = harness(); let tree = h.draw();
  assert.equal(h.calls(), 0);
  const button = extract(tree); button.props!.onClick(); button.props!.onClick();
  assert.equal(h.calls(), 1);
  await h.finish(); tree = h.draw();
  assert.equal(h.changes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.changes[0])), { ruc: "1234567-0", legalName: "RAZÓN FICTICIA", rucConfirmationToken: "signed-test", rucSnapshot: null });
});

test("editar A→B→A mientras consulta descarta el resultado aunque el RUC final coincida", async () => {
  const h = harness(); let tree = h.draw(); extract(tree).props!.onClick();
  nodes(tree).find((n) => n.type === "RucField")!.props!.onChange("7654321-0");
  tree = h.draw("7654321-0"); nodes(tree).find((n) => n.type === "RucField")!.props!.onChange("1234567-0");
  h.draw(); await h.finish(); tree = h.draw();
  assert.equal(nodes(tree).some((n) => n.type === "AdminButton" && n.props?.children.includes("Confirmar RUC y razón social")), false);
  assert.equal(h.changes.length, 2);
});

test("el formulario de extracción no expone la procedencia técnica del snapshot", () => {
  const source = readFileSync("components/admin/modules/ClientFiscalFields.tsx", "utf8");
  const form = source.slice(source.indexOf("export function ClientFiscalFields"));
  assert.equal(form.includes('aria-label="Procedencia fiscal"'), false);
  assert.equal(form.includes("source.sourcePage"), false);
  assert.equal(form.includes("source.publicationDate"), false);
  assert.equal(form.includes("source.importedAt"), false);
  assert.equal(form.includes("proposal?.lookedUpAt"), false);
  assert.match(source, /aria-label="Snapshot fiscal confirmado"/);
});

test("una persona devuelta como apellido, nombres prellena el representante en orden legible", async () => {
  const h = harness();
  extract(h.draw()).props!.onClick();
  await h.finish("DE OLIVEIRA ORTIGOZA, DARIO ALFONSO");
  assert.deepEqual(JSON.parse(JSON.stringify(h.changes[0])), {
    ruc: "1234567-0",
    legalName: "DE OLIVEIRA ORTIGOZA, DARIO ALFONSO",
    legalRepresentative: "DARIO ALFONSO DE OLIVEIRA ORTIGOZA",
    rucConfirmationToken: "signed-test",
    rucSnapshot: null,
  });
});
