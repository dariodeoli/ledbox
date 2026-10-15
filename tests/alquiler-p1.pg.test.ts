import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/alquiler-p1.pg.test.ts
test("alquileres P1: precio por evento, atraso y aprobación con stock (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { POST: preorder } = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const { POST: portalApprove } = await import("../app/api/portal/budget/[token]/approve/route");
  const { convertQuoteRequest } = await import("../lib/server/catalog-convert");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const { checkStockBeforeApproval, sendBudgetToReviewForStock } = await import("../lib/server/approval-stock");
  const { listExpiringHolds, listOverdueReturns } = await import("../lib/server/rental-alerts");
  const { listAdminNotifications } = await import("../lib/server/notifications");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { BUDGET_CODE_ALPHABET } = await import("../lib/public-config");

  const HOUR = 3_600_000;
  const day = (n: number) => new Date(Date.UTC(2031, 0, n, 12));
  const future = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  let ipCounter = 100;
  const token = (id: string) => Array.from({ length: 20 }, (_, i) => BUDGET_CODE_ALPHABET[(id.charCodeAt(i) + i) % BUDGET_CODE_ALPHABET.length]).join("").match(/.{4}/g)!.join("-");

  async function org(label: string, opts: { catalog?: boolean } = {}) {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: `P1 ${label}`, slug: `p1-${id.slice(0, 8)}` } });
    if (opts.catalog) {
      await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: id, publicCatalogEnabled: true, publicShowPrices: true, depositPercent: 50, whatsappPhone: "+595981123456" } });
    }
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: `Cliente ${label}` } });
    return { id, slug: `p1-${id.slice(0, 8)}`, client: client.id };
  }
  const item = (o: { id: string }, name: string, extra: Record<string, unknown> = {}) =>
    db.inventoryItem.create({ data: { id: randomUUID(), organizationId: o.id, name, category: "QA", quantity: 1, visibleOnWeb: true, catalogAudience: "BOTH", ...extra } as never });
  const owner = (o: { id: string }) => ({ organizationId: o.id, user: { id: "u", name: "Dueña", email: "u@x", role: "OWNER" } }) as never;

  // Presupuesto SENT con evento (rango día 10-13) y un ítem vinculado.
  async function budgetWithEvent(o: { id: string; client: string }, lines: Array<{ inventoryId: string; quantity: number }>, extra: Record<string, unknown> = {}) {
    const eventId = randomUUID();
    await db.event.create({ data: { id: eventId, organizationId: o.id, clientId: o.client, name: `Evento ${eventId.slice(0, 4)}`, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), status: "CONFIRMED" } });
    const id = randomUUID();
    await db.budget.create({ data: { id, organizationId: o.id, clientId: o.client, eventId, title: `Presu ${id.slice(0, 4)}`, status: "SENT", subtotal: 100_000, total: 100_000, publicToken: token(id), ...extra } as never });
    for (const line of lines) {
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId: id, name: "Ítem", quantity: line.quantity, days: 1, unitPrice: 100_000, subtotal: 100_000 * line.quantity, inventoryId: line.inventoryId } });
    }
    // Sin ítems de inventario igual hace falta un servicio libre para poder aprobar.
    if (lines.length === 0) await db.budgetItem.create({ data: { id: randomUUID(), budgetId: id, name: "Servicio", quantity: 1, days: 1, unitPrice: 100_000, subtotal: 100_000 } });
    return { id, eventId };
  }
  const approvePortal = (tokenValue: string) =>
    portalApprove(
      new Request("http://localhost/api/portal/budget/x/approve", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ipCounter}` }, body: JSON.stringify({ name: "Ana Pérez", consent: true }) }),
      { params: Promise.resolve({ token: tokenValue }) },
    );

  await t.test("la migración del precio por evento aplicada dos veces no falla y deja DAILY por defecto", async () => {
    const { execFileSync } = await import("node:child_process");
    const file = new URL("../prisma/migrations/202610210001_inventory_billing_unit/migration.sql", import.meta.url).pathname;
    for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
    const o = await org("default");
    assert.equal((await item(o, "Mesa")).billingUnit, "DAILY");
  });

  await t.test("P1-1 (1-3): tienda → presupuesto, por evento = 1 día, por día = triple y lo ya convertido no cambia", async () => {
    const o = await org("precio", { catalog: true });
    const juego = await item(o, "Juego lounge", { listPrice: 660_000, wholesalePrice: 500_000, billingUnit: "EVENT" });
    const mesa = await item(o, "Mesa", { listPrice: 100_000, wholesalePrice: 80_000 });
    const res = await preorder(
      new Request(`http://localhost/api/catalog/${o.slug}/preorder`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.2.0.${++ipCounter}` },
        body: JSON.stringify({ name: "Ana Pérez", phone: "+595 981 000 111", email: "ana@example.com", location: "Asunción", from: future(10), to: future(12), items: [{ inventoryId: juego.id, quantity: 1 }, { inventoryId: mesa.id, quantity: 1 }] }),
      }),
      { params: Promise.resolve({ orgSlug: o.slug }) },
    );
    assert.equal(res.status, 201, await res.clone().text());
    const { preorder: created } = (await res.json()) as { preorder: { token: string; subtotal: number } };
    assert.equal(created.subtotal, 660_000 + 100_000 * 3, "el juego una vez y la mesa por 3 días");
    const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: created.token }, include: { items: true } });
    assert.equal(quote.items.find((i) => i.inventoryId === juego.id)?.billingUnit, "EVENT");
    assert.equal(quote.items.find((i) => i.inventoryId === juego.id)?.subtotal, 660_000);
    assert.equal(quote.items.find((i) => i.inventoryId === mesa.id)?.billingUnit, "DAILY");
    assert.equal(quote.items.find((i) => i.inventoryId === mesa.id)?.subtotal, 300_000);

    const out = await convertQuoteRequest(owner(o), quote.id);
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.equal(out.budget.total, 960_000);
    const budget = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: true } });
    const lineOf = (id: string) => budget.items.find((i) => i.inventoryId === id)!;
    assert.deepEqual([lineOf(juego.id).days, lineOf(juego.id).subtotal], [1, 660_000]);
    assert.deepEqual([lineOf(mesa.id).days, lineOf(mesa.id).subtotal], [3, 300_000]);

    // Cambiar el «se cobra» del producto después no toca lo ya convertido (snapshot).
    await db.inventoryItem.update({ where: { id: juego.id }, data: { billingUnit: "DAILY" } });
    await db.inventoryItem.update({ where: { id: mesa.id }, data: { billingUnit: "EVENT" } });
    const after = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: true } });
    assert.equal(after.total, 960_000);
    assert.deepEqual(after.items.map((i) => [i.inventoryId, i.days, i.subtotal]).sort(), budget.items.map((i) => [i.inventoryId, i.days, i.subtotal]).sort());
  });

  await t.test("P1-1 (4): el pedido mayorista convertido va con días = 1 en los productos por evento", async () => {
    const o = await org("mayorista", { catalog: true });
    const juego = await item(o, "Juego lounge", { listPrice: 660_000, wholesalePrice: 500_000, billingUnit: "EVENT" });
    const mesa = await item(o, "Mesa", { listPrice: 100_000, wholesalePrice: 80_000 });
    const lead = await db.lead.create({ data: { id: randomUUID(), organizationId: o.id, name: "Mayorista SA", phone: "+595981000222", email: "may@example.com", reason: "Pedido", consentAt: new Date() } as never });
    const quoteId = randomUUID();
    await db.quoteRequest.create({
      data: {
        id: quoteId, organizationId: o.id, leadId: lead.id, status: "NEW", priceList: "WHOLESALE", startsAt: day(10), endsAt: day(12), durationDays: 3,
        items: { create: [
          { id: randomUUID(), inventoryId: juego.id, productSlug: "J", productName: "Juego lounge", quantity: 1, duration: 3, billingUnit: "EVENT" },
          { id: randomUUID(), inventoryId: mesa.id, productSlug: "M", productName: "Mesa", quantity: 1, duration: 3, billingUnit: "DAILY" },
        ] },
      },
    });
    const out = await convertQuoteRequest(owner(o), quoteId);
    assert.ok(out.ok, JSON.stringify(out));
    if (!out.ok) return;
    const items = (await db.budgetItem.findMany({ where: { budgetId: out.budget.id } }));
    const j = items.find((i) => i.inventoryId === juego.id)!;
    const m = items.find((i) => i.inventoryId === mesa.id)!;
    assert.deepEqual([j.days, j.unitPrice, j.subtotal], [1, 500_000, 500_000]);
    assert.deepEqual([m.days, m.unitPrice, m.subtotal], [3, 80_000, 240_000]);
  });

  await t.test("P1-3 (1): una copa que salió y no volvió sigue ocupada y no se ofrece a otro evento; al devolverla se libera", async () => {
    const o = await org("atraso");
    const copa = await item(o, "Copa", { quantity: 12 });
    const past = (hours: number) => new Date(Date.now() - hours * HOUR);
    const old = await db.event.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, name: "Sábado", setupAt: past(120), startsAt: past(118), endsAt: past(100), strikeAt: past(98), status: "CONFIRMED" } });
    const asg = await db.eventInventory.create({
      data: { id: randomUUID(), eventId: old.id, inventoryId: copa.id, organizationId: o.id, quantity: 12, startsAt: past(120), endsAt: past(98), checkedOut: true, checkedOutAt: past(119), checkoutQuantity: 12 },
    });
    const next = await db.event.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, name: "Hoy", setupAt: past(-1), startsAt: past(-2), endsAt: past(-5), strikeAt: past(-6), status: "CONFIRMED" } });
    const range = { startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 4 * HOUR) };
    const blocked = await commitInventoryAssignment({ organizationId: o.id, eventId: next.id, inventoryId: copa.id, quantity: 4, ...range });
    assert.equal(!blocked.ok && blocked.reason, "insufficient", "atrasada: figura ocupada");

    const overdue = await listOverdueReturns(o.id);
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].pending, 12);
    assert.ok(overdue[0].hoursLate >= 97);
    assert.deepEqual(await listOverdueReturns((await org("otra")).id), [], "otra empresa no la ve");
    const feed = await listAdminNotifications(o.id);
    assert.ok(feed.notifications.some((n) => n.id === `return_overdue:${old.id}` && n.level === "overdue"));

    await db.eventInventory.update({ where: { id: asg.id }, data: { checkedIn: true, checkedInAt: past(2), returnedQuantity: 12 } });
    assert.ok((await commitInventoryAssignment({ organizationId: o.id, eventId: next.id, inventoryId: copa.id, quantity: 4, ...range })).ok, "devuelta: libre");
    assert.equal((await listOverdueReturns(o.id)).length, 0);
  });

  await t.test("P1-3 (2): dos aprobaciones concurrentes del último stock: una aprueba y la otra queda en revisión", async () => {
    for (let round = 0; round < 6; round++) {
      const o = await org(`carrera-${round}`);
      const copa = await item(o, "Último sofá", { quantity: 1 });
      const [a, b] = await Promise.all([budgetWithEvent(o, [{ inventoryId: copa.id, quantity: 1 }]), budgetWithEvent(o, [{ inventoryId: copa.id, quantity: 1 }])]);
      const actor = portalAuditContext(o.id, "Cliente");
      const flow = async (budget: { id: string }) => {
        const gate = await checkStockBeforeApproval({ organizationId: o.id, budgetId: budget.id, context: actor });
        if (!gate.ok) {
          await sendBudgetToReviewForStock({ organizationId: o.id, budgetId: budget.id, title: "Presu", actor, lines: gate.lines });
          return "review";
        }
        await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByName: "Ana" } });
        return "approved";
      };
      const results = await Promise.all([flow(a), flow(b)]);
      assert.deepEqual([...results].sort(), ["approved", "review"], `ronda ${round}`);
      assert.equal(await db.eventInventory.count({ where: { inventoryId: copa.id } }), 1, "una sola reserva");
      const rows = await db.budget.findMany({ where: { id: { in: [a.id, b.id] } } });
      assert.equal(rows.filter((r) => r.status === "APPROVED").length, 1);
      assert.equal(rows.filter((r) => r.status === "NEGOTIATING" && r.approvedAt === null && r.revisionRequestedAt).length, 1);
    }
  });

  await t.test("P1-3: el portal rechaza la aprobación sin stock (409), la deja en revisión, no reserva y audita; con stock aprueba", async () => {
    const o = await org("portal");
    const sofa = await item(o, "Sofá", { quantity: 1 });
    const mesa = await item(o, "Mesa", { quantity: 5 });
    const first = await budgetWithEvent(o, [{ inventoryId: sofa.id, quantity: 1 }]);
    const firstToken = (await db.budget.findUniqueOrThrow({ where: { id: first.id } })).publicToken!;
    const ok = await approvePortal(firstToken);
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: first.id } })).status, "APPROVED");
    assert.equal(await db.eventInventory.count({ where: { eventId: first.eventId, inventoryId: sofa.id } }), 1);

    // Todo o nada: la mesa alcanzaría, el sofá no. Nada queda reservado.
    const second = await budgetWithEvent(o, [{ inventoryId: mesa.id, quantity: 2 }, { inventoryId: sofa.id, quantity: 1 }]);
    const secondToken = (await db.budget.findUniqueOrThrow({ where: { id: second.id } })).publicToken!;
    const res = await approvePortal(secondToken);
    assert.equal(res.status, 409);
    const payload = (await res.json()) as { error: string; code: string };
    assert.equal(payload.code, "stock_insufficient");
    assert.equal(payload.error, "Hay piezas sin disponibilidad para esas fechas; el equipo te contacta.");
    const blocked = await db.budget.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(blocked.approvedAt, null);
    assert.equal(blocked.status, "NEGOTIATING");
    assert.ok(blocked.revisionRequestedAt);
    assert.equal(await db.eventInventory.count({ where: { eventId: second.eventId } }), 0, "no se reservó nada, ni la mesa");
    const audit = await db.auditLog.findFirst({ where: { organizationId: o.id, entityId: second.id }, orderBy: { createdAt: "desc" } });
    assert.match(JSON.stringify(audit), /no hay stock para esas fechas/);
    assert.match(JSON.stringify(audit), /Sofá \(piden 1, hay 0\)/);

    // Un presupuesto sin ítems de inventario (o sin evento) no se frena: no hay nada que verificar.
    const free = await budgetWithEvent(o, []);
    const freeRes = await approvePortal((await db.budget.findUniqueOrThrow({ where: { id: free.id } })).publicToken!);
    assert.equal(freeRes.status, 200, await freeRes.clone().text());
  });

  await t.test("P1-3: otra empresa no comparte stock ni ve el faltante", async () => {
    const a = await org("aislada-a");
    const b = await org("aislada-b");
    const sofaA = await item(a, "Sofá", { quantity: 1 });
    const sofaB = await item(b, "Sofá", { quantity: 1 });
    const one = await budgetWithEvent(a, [{ inventoryId: sofaA.id, quantity: 1 }]);
    const two = await budgetWithEvent(b, [{ inventoryId: sofaB.id, quantity: 1 }]);
    assert.ok((await checkStockBeforeApproval({ organizationId: a.id, budgetId: one.id, context: portalAuditContext(a.id, "X") })).ok);
    assert.ok((await checkStockBeforeApproval({ organizationId: b.id, budgetId: two.id, context: portalAuditContext(b.id, "X") })).ok);
    // Un presupuesto ajeno se trata como inexistente: no verifica ni reserva nada.
    const foreign = await checkStockBeforeApproval({ organizationId: b.id, budgetId: one.id, context: portalAuditContext(b.id, "X") });
    assert.ok(foreign.ok);
    assert.equal(foreign.reservation?.outcomes.length ?? 0, 0);
  });

  await t.test("P1-3 (4): las retenciones de la tienda que vencen en menos de 6 h salen en el resumen", async () => {
    const o = await org("retencion");
    const copa = await item(o, "Copa", { quantity: 20 });
    const hold = async (label: string, hours: number, shop = true) => {
      const { id, eventId } = await budgetWithEvent(o, []);
      if (shop) {
        const quoteId = randomUUID();
        await db.quoteRequest.create({ data: { id: quoteId, organizationId: o.id, status: "QUOTED", startsAt: day(10), endsAt: day(13) } });
        await db.budget.update({ where: { id }, data: { quoteRequestId: quoteId, title: label } });
      }
      await db.eventInventory.create({ data: { id: randomUUID(), eventId, inventoryId: copa.id, organizationId: o.id, quantity: 2, startsAt: day(10), endsAt: day(13), holdExpiresAt: new Date(Date.now() + hours * HOUR), budgetId: id } });
      return id;
    };
    const soon = await hold("Vence en 3 h", 3);
    await hold("Vence en 8 h", 8);
    await hold("Ya venció", -1);
    await hold("Retención manual (no es de la tienda)", 2, false);
    const holds = await listExpiringHolds(o.id);
    assert.deepEqual(holds.map((h) => h.budgetId), [soon]);
    assert.equal(holds[0].hoursLeft, 3);
    const feed = await listAdminNotifications(o.id);
    const aviso = feed.notifications.find((n) => n.kind === "hold_expiring");
    assert.equal(aviso?.id, `hold_expiring:${soon}`);
    assert.equal(aviso?.level, "soon");
    assert.deepEqual(await listExpiringHolds((await org("otra-ret")).id), []);
  });
});
