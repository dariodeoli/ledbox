import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { DEFAULT_APPEARANCE, adjustBrandColor, parseAppearance, readAppearance } from "../lib/appearance";
import { auditChanges } from "../lib/server/audit";
import { jsonError } from "../lib/server/http";

test("servicio real de Apariencia persiste módulos en su empresa y rechaza opciones inválidas sin escribir", async () => {
  // Ejecuta el servicio productivo que usa PATCH; sólo las lecturas/escrituras se sustituyen por memoria.
  const source = ts.createSourceFile("org-presentation.ts", readFileSync("lib/server/org-presentation.ts", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "saveOrgAppearance");
  assert.ok(declaration);
  let stored = readAppearance({ ...DEFAULT_APPEARANCE, home: { categoryLayout: "cards", order: ["categorias", "catalogo", "hero"], hidden: ["contacto"], editorial: { title: "Texto propio" } } });
  let writes = 0, audits = 0;
  const compiled = ts.transpileModule(`${declaration.getText(source).replace(/^export /, "")}\nsaveOrgAppearance;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const save = runInNewContext(compiled, {
    db: { organization: {
      findUnique: async ({ where }: { where: { id: string } }) => { assert.equal(where.id, "org-own"); return { appearance: stored }; },
      update: async ({ where, data }: { where: { id: string }; data: { appearance: typeof stored } }) => { assert.equal(where.id, "org-own"); writes++; stored = data.appearance; },
    }, organizationRentalSettings: { findUnique: async () => ({ storefrontAccent: null, storefrontTagline: null }) } },
    readAppearance, parseAppearance, adjustBrandColor, jsonError, auditChanges,
    recordAudit: async () => { audits++; }, saveRentalSettings: async () => assert.fail("no se cambia el color ni la frase"),
    STOREFRONT_TAGLINE_MAX: 160, JSON, Response,
  }) as (context: unknown, body: unknown) => Promise<Response>;
  const context = { organizationId: "org-own", organization: { name: "Empresa ficticia" } };
  const before = JSON.stringify(stored);
  const invalid = await save(context, { home: { categoryLayout: "invalid" } });
  assert.equal(invalid.status, 400); assert.equal(JSON.stringify(stored), before); assert.equal(writes, 0); assert.equal(audits, 0);
  const changed = await save(context, { organizationId: "org-foreign-ignored", home: { categoryLayout: "accordion" } });
  assert.equal(changed.status, 200);
  assert.equal(stored.home.categoryLayout, "accordion");
  assert.equal(stored.home.editorial.title, "Texto propio");
  assert.equal(stored.home.order[0], "categorias");
  assert.deepEqual(stored.home.hidden, ["contacto"]);
  assert.equal(writes, 1); assert.equal(audits, 1);
  assert.equal((await save(context, { template: "industrial" })).status, 200);
  assert.equal(stored.home.categoryLayout, "accordion");
  assert.equal(stored.home.editorial.title, "Texto propio");
  assert.equal(stored.template, "industrial");
});
