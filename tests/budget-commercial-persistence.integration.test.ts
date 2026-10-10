import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;
const enabled = process.env.COMMERCIAL_MIGRATION_TEST === "1" && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(url ?? "");
test("isolated commercial migration repeat preserves all legacy rows and archive state", { skip: !enabled }, async () => {
  const db = new PrismaClient();
  const sql = (text: string) => db.$queryRawUnsafe<Array<Record<string, unknown>>>(text);
  const snapshots = async () => ({
    budgets: await sql(`SELECT to_jsonb(b)-ARRAY['discountMode','discountValue','advancePercentBps'] AS row FROM "Budget" b ORDER BY id`),
    items: await sql(`SELECT to_jsonb(b)-ARRAY['priceMode','tariffSnapshot','discountMode','discountValue','discountAmount'] AS row FROM "BudgetItem" b ORDER BY id`),
    inventory: await sql(`SELECT to_jsonb(i) AS row FROM "InventoryItem" i ORDER BY id`),
    payments: await sql(`SELECT to_jsonb(p) AS row FROM "ClientPayment" p ORDER BY id`),
  });
  try {
    const before = await snapshots();
    assert.ok(before.budgets.length > 0 && before.items.length > 0, "requires actual legacy rows before migration");
    const migration = "prisma/migrations/202610100004_budget_commercial_terms/migration.sql";
    const psqlUrl = new URL(url!);
    psqlUrl.searchParams.delete("schema");
    const output = execFileSync("psql", [psqlUrl.toString(), "-v", "ON_ERROR_STOP=1", "-f", migration, "-f", migration], { encoding: "utf8" });
    assert.deepEqual(await snapshots(), before);
    const columns = await sql(`SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND ((table_name='Budget' AND column_name IN ('discountMode','discountValue','advancePercentBps')) OR (table_name='BudgetItem' AND column_name IN ('priceMode','tariffSnapshot','discountMode','discountValue','discountAmount'))) ORDER BY table_name,column_name`);
    assert.equal(columns.length, 8);
    assert.ok(columns.every(row => row.is_nullable === "YES" && row.column_default === null));
    const nonnull = await sql(`SELECT (SELECT count(*) FROM "Budget" WHERE "discountMode" IS NOT NULL OR "discountValue" IS NOT NULL OR "advancePercentBps" IS NOT NULL)::int + (SELECT count(*) FROM "BudgetItem" WHERE "priceMode" IS NOT NULL OR "tariffSnapshot" IS NOT NULL OR "discountMode" IS NOT NULL OR "discountValue" IS NOT NULL OR "discountAmount" IS NOT NULL)::int AS count`);
    assert.equal(nonnull[0].count, 0);
    if (process.env.COMMERCIAL_EVIDENCE_DIR) {
      mkdirSync(process.env.COMMERCIAL_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.COMMERCIAL_EVIDENCE_DIR, "migration-verification.json"), JSON.stringify({ status: "PASS", repeated: true, nullable: true, backfill: false, columns, before, after: await snapshots(), output }, null, 2));
    }
  } finally { await db.$disconnect(); }
});
