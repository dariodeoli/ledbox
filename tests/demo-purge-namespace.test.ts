import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("barrido de purga sólo exceptúa namespace histórico y comprueba reserva sin empresa viva", () => {
  const source = readFileSync("tests/demo-sandbox.pg.test.ts", "utf8");
  const helper = source.slice(source.indexOf("async function leftovers("), source.indexOf('\ntest("demo interactiva E2:', source.indexOf("async function leftovers(")));
  assert.match(helper, /if \(table_name === "OrganizationSlug" && column_name === "organizationId"\) continue;/);
  assert.equal((helper.match(/continue;/g) ?? []).length, 1, "no se omite otra tabla operativa");
  assert.match(helper, /information_schema.columns/);
  assert.match(helper, /found.push\(`\$\{table_name\}/);
  assert.match(helper, /assert.deepEqual\(tombstones/);
  assert.match(helper, /resolveOrganizationSlugId\(`demo-\$\{ns\}`\), null/);
  assert.match(helper, /assert.rejects/); assert.match(helper, /OrganizationSlugTaken/);
  assert.match(helper, /adminUser.count/);
});
