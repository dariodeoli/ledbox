import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { auditChanges } from "../lib/server/audit";
import { isJsonObject, jsonError, readJson } from "../lib/server/http";
import { FIELD_MESSAGES, normalizePersonName, personNameValid } from "../lib/field-rules";
import { orgSlugError } from "../lib/platform/alta-empresa";
import { assertOrganizationSlugAvailable, claimOrganizationSlug, OrganizationSlugTaken, resolveOrganizationSlugId } from "../lib/server/organization-slugs";

function realPatch(globals: Record<string, unknown>) {
  const src = ts.createSourceFile("route.ts", readFileSync("app/api/admin/organization/branding/route.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const fn = src.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "PATCH")!;
  return runInNewContext(ts.transpileModule(fn.getText(src).replace(/^export /, "") + "\nPATCH;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { Prisma, Response, isJsonObject, jsonError, readJson, FIELD_MESSAGES, normalizePersonName, personNameValid, orgSlugError, OrganizationSlugTaken, ...globals });
}

test("PATCH productivo: nombre legacy, alias propios, CAS y tenant; demo y fallo no escriben", async () => {
  let row = { id: "own", name: "Empresa", slug: "ledbox", isDemo: false }, writes = 0, locked = false;
  const claims: string[] = [];
  const patch = realPatch({
    requireAdminContext: async (cap: string, options: any) => { assert.equal(cap, "org.manage"); assert.equal(options.sandbox, "deny"); return { ok: true, context: { organizationId: "own" } }; },
    lockOrganizationSlugNamespace: async () => { locked = true; },
    claimOrganizationSlug: async (_tx: unknown, slug: string, id: string) => { assert.equal(id, "own"); if (slug === "occupied") throw new OrganizationSlugTaken(); claims.push(slug); },
    loadOrganizationSlugAliases: async () => claims.filter(x => x !== row.slug).map(slug => ({ slug })),
    db: { $transaction: async (f: any) => f({
      $queryRaw: async (sql: any) => { assert.equal(locked, true); assert.deepEqual(sql.values, ["own"]); return [{ ...row }]; },
      organization: { update: async ({ where, data }: any) => { assert.equal(where.id, "own"); row = { ...row, ...data }; writes++; } },
    }) }, auditChanges, recordAudit: async () => {},
  });
  const req = (body: unknown) => new Request("http://localhost/branding", { method: "PATCH", body: JSON.stringify(body) });
  assert.equal((await patch(req({ name: "Nuevo nombre" }))).status, 200); assert.equal(row.slug, "ledbox"); assert.equal(writes, 1);
  assert.equal((await patch(req({ name: "Otro nombre", slug: "ledbox" }))).status, 200);
  assert.equal((await patch(req({ slug: "new-company" }))).status, 409);
  assert.equal((await patch(req({ slug: "new-company", expectedSlug: "ledbox", organizationId: "foreign" }))).status, 200);
  assert.equal(row.id, "own"); assert.equal(row.slug, "new-company"); assert.deepEqual(claims, ["ledbox", "new-company"]);
  const before = writes;
  assert.equal((await patch(req({ slug: "later-company", expectedSlug: "ledbox" }))).status, 409);
  assert.equal((await patch(req({ slug: "occupied", expectedSlug: "new-company" }))).status, 409); assert.equal(writes, before);
  row.isDemo = true; assert.equal((await patch(req({ slug: "demo-renamed", expectedSlug: row.slug }))).status, 403); assert.equal(writes, before);
  assert.equal((await patch(req(null))).status, 400);
});

test("namespace real: lock global, tombstone/otro tenant bloqueados y claim nunca reasigna", async () => {
  let owners = [{ organizationId: "foreign-deleted" }], locks = 0, inserts = 0;
  const tx: any = { $executeRaw: async (...args: any[]) => { const sql = args[0]; if (String(sql.sql ?? sql[0]).includes("pg_advisory")) locks++; else { assert.match(sql.sql, /ON CONFLICT[\s\S]*DO NOTHING/); inserts++; } },
    $queryRaw: async () => { assert.ok(locks > 0); return owners; }, organization: { findFirst: async () => null } };
  await assert.rejects(() => assertOrganizationSlugAvailable(tx, "old-company", "new-owner"), OrganizationSlugTaken);
  assert.equal(inserts, 0);
  owners = [{ organizationId: "own" }]; await claimOrganizationSlug(tx, "old-company", "own"); assert.equal(inserts, 1);
});

test("resolver real no escoge tenant cuando historia es ambigua o tombstone sin organización", async () => {
  const client: any = { $queryRaw: async () => [{ id: "same" }] };
  assert.equal(await resolveOrganizationSlugId(" Old-Company ", client), "same");
  client.$queryRaw = async () => [{ id: "A" }, { id: "B" }]; assert.equal(await resolveOrganizationSlugId("old-company", client), null);
  client.$queryRaw = async () => []; assert.equal(await resolveOrganizationSlugId("old-company", client), null);
});

test("consumidores y escritores usan el namespace único; migración aditiva conserva tombstones", () => {
  for (const path of ["lib/platform/alta-empresa-server.ts", "prisma/seed.ts", "lib/server/demo-sandboxes.ts", "lib/server/demo-data.ts"]) {
    const source = readFileSync(path, "utf8"); assert.match(source, /assertOrganizationSlugAvailable/); assert.match(source, /claimOrganizationSlug/);
  }
  for (const path of ["lib/server/catalog-public.ts", "lib/server/catalog-access.ts", "lib/server/tenancy.ts", "app/api/mail/logo/[orgSlug]/[variant]/route.ts"]) assert.match(readFileSync(path, "utf8"), /resolveOrganizationSlugId/);
  const migration = readFileSync("prisma/migrations/202611030001_organization_slug_history/migration.sql", "utf8");
  assert.match(migration, /INSERT INTO "OrganizationSlug".*SELECT "slug", "id" FROM "Organization"/);
  assert.doesNotMatch(migration, /ALTER TABLE "Organization"|DELETE FROM|DROP TABLE/);
});
