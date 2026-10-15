import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
const base = process.env.PORTAL_AUDIT_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && process.env.TEST_DATABASE_URL);

test("portal: revisión rechaza cuerpos JSON inválidos sin cambiar presupuesto ni solicitudes", { skip: !enabled }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { generatePublicToken } = await import("../lib/server/budget-portal");
  const org = randomUUID();
  try {
    await db.organization.create({ data: { id: org, name: "Portal inválidos QA", slug: `portalvalidation-${org}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Evento QA", publicToken: generatePublicToken(), status: "SENT", subtotal: 1000, total: 1000 } });
    for (const body of [null, [], true, "texto"]) {
      const response = await fetch(`${base}/api/portal/budget/${budget.publicToken}/revision`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `revisionvalidation-${org}` }, body: JSON.stringify(body) });
      assert.equal(response.status, 400, await response.clone().text());
      assert.deepEqual(await db.budget.findUniqueOrThrow({ where: { id: budget.id } }), budget);
      assert.equal(await db.budgetChangeRequest.count({ where: { budgetId: budget.id } }), 0);
    }
  } finally {
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
