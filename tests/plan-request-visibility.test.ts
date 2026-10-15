import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { jsonError, readJson } from "../lib/server/http";
import { PAGE_SIZE, totalPages } from "../lib/platform/tablas";

function realFunction(file: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn);
  return runInNewContext(ts.transpileModule(fn.getText(source).replace(/^export /, "") + `\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { Response, Date, ...globals });
}

test("solicitud real: guarda/actualiza pendiente del tenant sin cambiar plan; JSON inválido y demo/rol sin escrituras", async () => {
  let auth: any = { ok: true, context: { organizationId: "own", user: { id: "actor", name: "QA", email: "qa@example.invalid" } } };
  const rows: any[] = [];
  let audits = 0, transactions = 0;
  const tx: any = { $queryRaw: async (sql: any) => { assert.ok(sql.values.includes("own")); assert.match(sql.sql, /FOR UPDATE/); return [{ planId: "current" }]; }, planChangeRequest: {
    findFirst: async ({ where }: any) => { assert.equal(where.organizationId, "own"); return rows.find(r => r.status === where.status) ?? null; },
    create: async ({ data }: any) => { const r = { ...data, status: "pending", decidedAt: null, decidedByName: null }; rows.push(r); return r; },
    update: async ({ where, data }: any) => Object.assign(rows.find(r => r.id === where.id), data),
  } };
  const post = realFunction("app/api/admin/plan/requests/route.ts", "POST", {
    requireAdminContext: async (cap: string, options: any) => { assert.equal(cap, "org.manage"); assert.equal(options.sandbox, "deny"); return auth; },
    db: { plan: { findFirst: async () => ({ id: "upgrade", code: "pro", name: "Pro", priceMonthly: 100 }) }, $transaction: async (fn: any) => { transactions++; return fn(tx); } },
    Prisma, randomUUID, jsonError, readJson, NOTE_MAX_LENGTH: 400, formatMoney: String, recordAudit: async () => { audits++; },
  });
  const request = (body: unknown) => new Request("http://localhost/api/admin/plan/requests", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await post(request(null))).status, 400); assert.equal(transactions, 0);
  assert.equal((await post(request({ planId: "upgrade", note: [] }))).status, 400); assert.equal(transactions, 0);
  const first = await post(request({ planId: "upgrade", organizationId: "foreign", note: " Primera " })); assert.equal(first.status, 201); const id = rows[0].id;
  assert.equal((await post(request({ planId: "upgrade", note: "Nueva nota" }))).status, 200);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, id); assert.equal(rows[0].note, "Nueva nota"); assert.equal(rows[0].organizationId, "own"); assert.equal(rows[0].status, "pending"); assert.equal(audits, 2);
  auth = { ok: false, response: jsonError("No autorizado", 403) };
  assert.equal((await post(request({ planId: "upgrade" }))).status, 403); assert.equal(transactions, 2);
});

test("cola real: sólo pendientes no demo, proyección mínima y páginas completas/última acotada", async () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ id: String(i), organization: { id: `org${i}`, name: `Empresa ${i}` }, plan: { name: "Pro" } }));
  const query = realFunction("lib/platform/queries/plan-requests.ts", "loadPendingPlanRequests", {
    PAGE_SIZE, totalPages,
    db: { planChangeRequest: {
      count: async ({ where }: any) => { assert.equal(where.status, "pending"); assert.equal(where.organization.isDemo, false); assert.equal(where.organization.slug.not, "demo"); return 31; },
      findMany: async ({ where, skip, take, select, orderBy }: any) => { assert.equal(where.status, "pending"); assert.equal(where.organization.isDemo, false); assert.equal(select.organization.select.id, true); assert.equal(select.requestedByEmail, undefined); assert.equal(orderBy[1].id, "desc"); return rows.slice(skip, skip + take); },
    } },
  });
  const first = await query(1), last = await query(999); assert.equal(first.rows.length, 30); assert.equal(last.rows.length, 1); assert.equal(last.page, 2); assert.equal(first.total, 31); assert.equal(new Set([...first.rows, ...last.rows].map(r => r.id)).size, 31);
});

test("entrada Superadmin guardada antes de consultar; Ajustes conserva sus secciones y Mensajes sus aliases", () => {
  const page = readFileSync("app/(superadmin)/superadmin/page.tsx", "utf8");
  assert.ok(page.indexOf("await requirePlatformAdmin()") < page.indexOf("loadPendingPlanRequests(parsePage"));
  assert.match(page, /Solicitudes de plan pendientes/); assert.match(page, /TablePager/); assert.match(page, /PlatformRefresh/);
  const settings = readFileSync("components/admin/modules/AjustesTabs.tsx", "utf8"); assert.doesNotMatch(settings, /href: "\/plantillas"/);
  assert.match(readFileSync("components/admin/modules/ClientesTabs.tsx", "utf8"), /\/clientes\/mensajes/);
  for (const file of ["app/(admin)/(panel)/plantillas/page.tsx", "app/(admin)/(panel)/clientes/mensajes/page.tsx"]) assert.match(readFileSync(file, "utf8"), /PlantillasModule/);
});
