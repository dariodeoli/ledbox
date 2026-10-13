import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/budget-event-auto.pg.test.ts
test("evento automático al aprobar: portal, panel, borrador, límite del plan, concurrencia y empresas aisladas", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { ensureEventForApprovedBudget, createEventForBudget } = await import("../lib/server/budget-event");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { BUDGET_CODE_ALPHABET } = await import("../lib/public-config");
  const portalApprove = (await import("../app/api/portal/budget/[token]/approve/route")).POST;

  async function org(label: string, planId: string | null = null) {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: `Auto ${label}`, slug: `au-${id}`, planId } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: `Cliente ${label}` } });
    return { id, client: client.id };
  }
  const budget = async (o: { id: string; client: string }, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await db.budget.create({ data: { id, organizationId: o.id, clientId: o.client, title: `Presu ${id.slice(0, 4)}`, status: "SENT", subtotal: 1_000_000, total: 1_000_000, publicToken: Array.from({ length: 20 }, (_, i) => BUDGET_CODE_ALPHABET[(id.charCodeAt(i) + i) % BUDGET_CODE_ALPHABET.length]).join("").match(/.{4}/g)!.join("-"), ...extra } as never });
    await db.budgetItem.create({ data: { id: randomUUID(), budgetId: id, name: "Pantalla LED", quantity: 1, days: 1, unitPrice: 1_000_000, subtotal: 1_000_000 } });
    return id;
  };
  const approve = (id: string) => db.budget.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByName: "Cliente" } });
  const A = await org("A");
  const B = await org("B");
  const actor = (o: { id: string }) => portalAuditContext(o.id, "Cliente Test");
  const events = (o: { id: string }) => db.event.findMany({ where: { organizationId: o.id } });

  try {
    // 1. Portal: aprobar crea el evento CONFIRMED vinculado, auditado como portal.
    const portalBudget = await budget(A, { deliveryAt: new Date(Date.UTC(2034, 1, 1, 15)) });
    const token = (await db.budget.findUniqueOrThrow({ where: { id: portalBudget } })).publicToken!;
    const response = await portalApprove(
      new Request("http://localhost/api/portal/budget/x/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ana Pérez", consent: true }) }),
      { params: Promise.resolve({ token }) },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const afterPortal = await db.budget.findUniqueOrThrow({ where: { id: portalBudget }, include: { event: true } });
    assert.equal(afterPortal.status, "APPROVED");
    assert.equal(afterPortal.event?.status, "CONFIRMED");
    assert.equal(afterPortal.event?.organizationId, A.id);
    assert.equal(afterPortal.event?.startsAt?.toISOString(), "2034-02-01T15:00:00.000Z");
    const createAudit = await db.auditLog.findFirst({ where: { organizationId: A.id, entity: "Event", entityId: afterPortal.eventId! } });
    assert.ok(createAudit, "creación auditada");
    assert.match(JSON.stringify(createAudit), /Ana Pérez/);

    // 2. Panel (mismo camino con el contexto del usuario): crea y es idempotente.
    const panelBudget = await budget(A);
    await approve(panelBudget);
    const plan = { organizationId: A.id, organization: { id: A.id, name: "A", slug: "a", planId: null } };
    const first = await ensureEventForApprovedBudget({ organizationId: A.id, budgetId: panelBudget, actor: actor(A), plan });
    assert.equal(first.event, "created");
    const again = await ensureEventForApprovedBudget({ organizationId: A.id, budgetId: panelBudget, actor: actor(A), plan });
    assert.equal(again.event, "unchanged");
    assert.equal((await events(A)).length, 2);

    // 3. Evento en borrador → CONFIRMED, sin crear otro.
    const draftEvent = randomUUID();
    await db.event.create({ data: { id: draftEvent, organizationId: A.id, clientId: A.client, name: "Borrador", status: "DRAFT" } });
    const draftBudget = await budget(A, { eventId: draftEvent });
    await approve(draftBudget);
    const confirmed = await ensureEventForApprovedBudget({ organizationId: A.id, budgetId: draftBudget, actor: actor(A) });
    assert.equal(confirmed.event, "confirmed");
    assert.equal((await db.event.findUniqueOrThrow({ where: { id: draftEvent } })).status, "CONFIRMED");
    assert.equal((await events(A)).length, 3);

    // 4. Concurrencia: seis llamadas simultáneas crean UN solo evento (y el botón manual pierde con 409).
    const racing = await budget(A);
    await approve(racing);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => ensureEventForApprovedBudget({ organizationId: A.id, budgetId: racing, actor: actor(A) })),
      db.$transaction((tx) => createEventForBudget(tx, { organizationId: A.id, organization: { id: A.id, name: "A", slug: "a", planId: null } }, racing, { confirmDraft: false })).then(() => "manual-ok", (e: Error) => e.message),
    ]);
    assert.equal(await db.event.count({ where: { organizationId: A.id } }), 4);
    assert.equal(await db.budget.count({ where: { eventId: { not: null }, id: racing } }), 1);
    assert.ok(results.filter((r) => typeof r === "object" && r.event === "created").length + (results[5] === "manual-ok" ? 1 : 0) === 1, "una sola creación");

    // 5. Límite del plan: queda aprobado, sin evento y con auditoría del motivo.
    const planId = randomUUID();
    await db.plan.create({ data: { id: planId, code: `t-${planId}`, name: "Tope", maxEventsPerMonth: 1, priceMonthly: 0 } });
    const L = await org("Limitada", planId);
    await db.event.create({ data: { id: randomUUID(), organizationId: L.id, clientId: L.client, name: "Ya usado", status: "CONFIRMED" } });
    const limited = await budget(L);
    await approve(limited);
    const failed = await ensureEventForApprovedBudget({ organizationId: L.id, budgetId: limited, actor: actor(L) });
    assert.equal(failed.event, "failed");
    const afterLimit = await db.budget.findUniqueOrThrow({ where: { id: limited } });
    assert.equal(afterLimit.status, "APPROVED");
    assert.equal(afterLimit.eventId, null);
    assert.equal(await db.event.count({ where: { organizationId: L.id } }), 1);
    const failAudit = await db.auditLog.findFirst({ where: { organizationId: L.id, entity: "Budget", entityId: limited } });
    assert.match(JSON.stringify(failAudit), /No se creó el evento automáticamente/);

    // 6. Otra empresa no se toca: un presupuesto de A no se procesa con el contexto de B y B queda sin eventos.
    const cross = await ensureEventForApprovedBudget({ organizationId: B.id, budgetId: panelBudget, actor: actor(B) });
    assert.equal(cross.event, "failed");
    assert.equal((await events(B)).length, 0);
  } finally {
    // Datos descartables: la base entera se borra al terminar.
  }
});
