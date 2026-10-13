import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("eventos: el 409 de cierre trae código y la UI ofrece «Cerrar igual» con nota obligatoria, solo con permiso de escritura", () => {
  const api = read("app/api/admin/events/route.ts");
  assert.match(api, /409, "closure_blocked"/);
  const adminApi = read("lib/admin-api.ts");
  assert.match(adminApi, /return code \? \{ ok: false, error: message, code \}/);
  const ui = read("components/admin/modules/EventosModule.tsx");
  assert.match(ui, /result\.code === "closure_blocked"/);
  assert.match(ui, /Cerrar igual/);
  assert.match(ui, /forceClose: true, forceCloseNote: note/);
  assert.match(ui, /form=\{forceFormId\}/);
  assert.match(ui, /note\.length < 5 \|\| note\.length > 400/);
  assert.match(ui, /\{writable && closeBlock \?/);
  assert.match(ui, /const closable = writable &&/);
});

test("incidentes: «Unidad sin identificar» solo para retenidos por cantidad en ítems con unidades", async () => {
  const { isUnidentifiedUnitIncident, UNIDENTIFIED_UNIT_LABEL } = await import("../lib/inventory-incident-label");
  assert.equal(UNIDENTIFIED_UNIT_LABEL, "Unidad sin identificar");
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: null, inventory: { _count: { units: 3 } } }), true);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: null, inventory: { _count: { units: 0 } } }), false);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: false, unitId: null, inventory: { _count: { units: 3 } } }), false);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: "u1", inventory: { _count: { units: 3 } } }), false);
  assert.equal(isUnidentifiedUnitIncident({ heldByQuantity: true, unitId: null, inventory: {} }), false);
  assert.match(read("components/admin/modules/InventoryIncidents.tsx"), /isUnidentifiedUnitIncident\(incident\)/);
  assert.match(read("app/api/admin/inventory/incidents/route.ts"), /_count: \{ select: \{ units: true \} \}/);
});

test("finanzas: «Pagar» del trabajo de proveedor es un AdminDialog con footer, dirty y form={id}; el monto no cambia", () => {
  const src = read("components/admin/modules/FinanzasModule.tsx");
  const start = src.indexOf("savePayJob(event");
  assert.ok(start > 0);
  const block = src.slice(src.indexOf("{writable && payJob && payJobRow ?"), src.indexOf("<AdminDataState", src.indexOf("{writable && payJob && payJobRow ?")));
  assert.match(block, /<AdminDialog/);
  assert.match(block, /dirty=\{JSON\.stringify\(payJob\) !== JSON\.stringify\(payJobBase\)\}/);
  assert.match(block, /form=\{payJobFormId\}/);
  assert.doesNotMatch(block, /admin-inline-form/);
  assert.match(src, /amount: String\(supplierJobBalance\(job\) \|\| ""\)/);
  assert.match(src, /const amount = Number\(payJob\.amount\);/);
});

test("create-event: el tope del plan se repite dentro de la transacción, después del FOR UPDATE", () => {
  const src = read("app/api/admin/budgets/[id]/create-event/route.ts");
  const tx = src.indexOf("db.$transaction");
  const lock = src.indexOf('FROM "Budget"', tx);
  const locked = src.indexOf("lockedEventLimitViolation(tx", tx);
  const create = src.indexOf("tx.event.create", tx);
  assert.ok(tx > 0 && lock > tx && locked > lock && create > locked);
  assert.match(src, /error instanceof PlanLimitError/);
  assert.match(read("lib/server/plan-limits.ts"), /FROM "Organization" WHERE "id" = \$\{context\.organizationId\} FOR NO KEY UPDATE/);
});

test("catálogo público: la preorden responde 429 al superar el tope diario por empresa, además del rate-limit por IP", () => {
  // La lógica común (rate-limit, honeypot, tope diario e idempotencia) vive en un solo handler que usan
  // el endpoint público y el mayorista; cada ruta solo aporta su llave de rate-limit y su resolver.
  const route = read("app/api/catalog/[orgSlug]/preorder/route.ts");
  const wholesale = read("app/api/catalog/[orgSlug]/mayorista/[token]/preorder/route.ts");
  assert.match(route, /rateKey: "catalog:preorder"/);
  assert.match(wholesale, /rateKey: "catalog:wholesale"/);
  for (const source of [route, wholesale]) assert.match(source, /handlePreorder\(request/);
  const src = read("lib/server/catalog-preorder-http.ts");
  assert.match(src, /rateLimit\(`\$\{options\.rateKey\}:/);
  assert.match(src, /preorderDailyLimit\(context\.organization\.id, \{ priceList: context\.priceList \}\)/);
  assert.match(src, /status: 429/);
  assert.match(src, /"Retry-After"/);
  assert.ok(src.indexOf("preorderDailyLimit(") > src.indexOf("context.demo"));
});

test("descripción pública: tope de 600, campo opcional en la edición, catálogo la muestra y la migración es aditiva e idempotente", async () => {
  const { FIELD_LIMITS } = await import("../lib/field-rules");
  assert.equal(FIELD_LIMITS.publicDescription, 600);
  const api = read("app/api/admin/inventory/route.ts");
  assert.match(api, /body\.publicDescription/);
  assert.match(api, /FIELD_LIMITS\.publicDescription/);
  assert.match(api, /"publicDescription",\n  "visibleOnWeb"/);
  const ui = read("components/admin/modules/InventarioModule.tsx");
  assert.match(ui, /label="Descripción para el catálogo"\n\s+optional/);
  assert.match(ui, /maxLength=\{FIELD_LIMITS\.publicDescription\}/);
  assert.match(read("components/catalog-public/CatalogBrowser.tsx"), /item\.description \?/);
  const catalog = read("lib/server/catalog-public.ts");
  assert.match(catalog, /publicDescription: true/);
  assert.doesNotMatch(catalog.slice(catalog.indexOf("async function loadVisibleRows"), catalog.indexOf("export type PublicRange")), /notes: true/);
  const sql = read("prisma/migrations/202610150004_inventory_public_description/migration.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "publicDescription" TEXT;/);
  assert.doesNotMatch(sql, /NOT NULL|DROP|UPDATE|DELETE/);
  assert.match(read("prisma/schema.prisma"), /publicDescription\s+String\?/);
});

test("auditoría: recordAudit acepta un cliente tx opcional y la garantía audita dentro de su transacción", () => {
  const audit = read("lib/server/audit.ts");
  assert.match(audit, /recordAudit\(entry: AuditEntry, tx\?: Prisma\.TransactionClient\)/);
  assert.match(audit, /if \(tx\) throw error;/);
  const deposit = read("lib/server/security-deposit.ts");
  const start = deposit.indexOf("export async function transitionBudgetSecurityDeposit");
  const body = deposit.slice(start, deposit.indexOf("export type EquipmentReturnState"));
  assert.ok(body.indexOf("recordAudit(") > body.indexOf("db.$transaction") && body.indexOf("recordAudit(") < body.indexOf("  });\n  return { ...result.after"));
  assert.match(body, /\n      tx,\n    \);/);
});
