import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/rental-settlement.pg.test.ts
test("cargos y liquidación de la devolución en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const ops = await import("../lib/server/inventory-operations");
  const settlement = await import("../lib/server/rental-settlement");
  const { transitionBudgetSecurityDeposit, setBudgetSecurityDeposit, SecurityDepositError } = await import("../lib/server/security-deposit");
  const { saveRentalSettings, getRentalSettings, validateRentalSettingsRefs } = await import("../lib/server/rental-settings");
  const { syncBudgetExpectedPayments } = await import("../lib/server/expected-payments");
  const { loadPortalRental } = settlement;

  const day = (n: number, hour = 12) => new Date(Date.UTC(2032, 0, n, hour));

  /** Evento con 12 copas (50.000 c/u, alquiler 600.000, reposición 15.000), presupuesto aprobado y garantía opcional. */
  async function seed(options: { deposit?: number | null; purpose?: "RESERVE" | "DAMAGES"; received?: boolean } = {}) {
    const org = randomUUID();
    await db.organization.create({ data: { id: org, name: "Liquidación QA", slug: `liq-${org}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
    await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja", type: "CASH" } });
    const category = await db.inventoryCategory.create({ data: { id: randomUUID(), organizationId: org, name: "Vajilla", key: `vajilla-${org}` } });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Copa", category: "Vajilla", categoryId: category.id, quantity: 20, replacementCost: 15_000 } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda", setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13) } });
    const deposit = options.deposit === undefined ? 500_000 : options.deposit;
    const budget = await db.budget.create({
      data: {
        id: randomUUID(),
        organizationId: org,
        clientId: client.id,
        eventId: event.id,
        title: "Alquiler de copas",
        status: "APPROVED",
        approvedAt: new Date(),
        subtotal: 600_000,
        total: 600_000,
        ...(deposit ? { securityDeposit: deposit, securityDepositStatus: "PENDING", securityDepositPurpose: options.purpose ?? "DAMAGES" } : {}),
        items: { create: [{ id: randomUUID(), name: "Copa", quantity: 12, days: 1, unitPrice: 50_000, subtotal: 600_000, inventoryId: item.id }] },
      },
    });
    const context = { organizationId: org, user: { id: "u-fin", name: "Ana Finanzas", email: "ana@example.com", role: "FINANCE" as const } };
    if (deposit && options.received !== false) await transitionBudgetSecurityDeposit(context, budget.id, { to: "HELD" });
    const committed = await commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId: item.id, quantity: 12, startsAt: day(10), endsAt: day(13) });
    assert.ok(committed.ok, JSON.stringify(committed));
    const assignment = committed.assignment;
    const out = await ops.dispatchAssignment({ organizationId: org, assignmentId: assignment.id, at: day(11), condition: "Bueno", actorId: "u1" });
    assert.ok(out.ok);
    const giveBack = (extra: Partial<Parameters<typeof ops.returnAssignment>[0]> = {}) =>
      ops.returnAssignment({ organizationId: org, assignmentId: assignment.id, at: day(13), condition: "Bueno", actorId: "u1", ...extra });
    return { org, client, category, item, event, budget, context, assignment, giveBack };
  }
  const charges = (budgetId: string) => db.rentalCharge.findMany({ where: { budgetId }, orderBy: { createdAt: "asc" } });
  const payments = (budgetId: string) => db.clientPayment.findMany({ where: { budgetId } });

  await t.test("la migración aplicada dos veces no falla", () => {
    const file = new URL("../prisma/migrations/202610250001_rental_charges_settlement/migration.sql", import.meta.url).pathname;
    for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
  });

  await t.test("devolver con 12 copas rotas propone 12 × 15.000 = 180.000 y la demora de 2 días = 120.000 (default 10 %)", async () => {
    const s = await seed();
    const result = await s.giveBack({ at: day(15), damaged: 12 });
    assert.ok(result.ok);
    const list = await charges(s.budget.id);
    const damage = list.find((c) => c.kind === "DAMAGE");
    const late = list.find((c) => c.kind === "LATE");
    assert.equal(damage?.amount, 180_000);
    assert.equal(damage?.quantity, 12);
    assert.equal(damage?.unitAmount, 15_000);
    assert.equal(damage?.status, "PROPOSED");
    assert.ok(damage?.incidentId);
    assert.equal(late?.amount, 120_000, "10 % de 600.000 = 60.000 por día × 2 días");
    assert.equal(late?.quantity, 2);
    assert.equal(list.length, 2);
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: s.budget.id } })).total, 600_000, "no toca el total");
  });

  await t.test("proponer dos veces no duplica (clave de idempotencia) y a tiempo no hay demora", async () => {
    const s = await seed();
    const result = await s.giveBack({ damaged: 3 });
    assert.ok(result.ok);
    assert.equal((await charges(s.budget.id)).length, 1, "solo la rotura; devuelto a tiempo");
    const again = await db.$transaction((tx) =>
      settlement.proposeReturnCharges(tx, {
        organizationId: s.org,
        assignment: { id: s.assignment.id, inventoryId: s.item.id, eventId: s.event.id, budgetId: null, quantity: 12, endsAt: day(13), returnedQuantity: 0, inventory: { name: "Copa", replacementCost: 15_000 }, event: { endsAt: day(12), strikeAt: day(13) } },
        incidents: result.incidents.map((i) => ({ id: i.id, kind: i.kind, quantity: i.quantity })),
        returnedAt: day(13),
        returnedNow: 12,
        missingNow: 0,
      }),
    );
    assert.equal(again, 0);
    assert.equal((await charges(s.budget.id)).length, 1);
  });

  await t.test("recargo por hora con monto fijo: 100.000 por hora, 3 h tarde con 30 min de tolerancia", async () => {
    const s = await seed({ deposit: null });
    await saveRentalSettings(s.org, { lateFeeKind: "FIXED", lateFeeUnit: "HOUR", lateFeeValue: 100_000, lateGraceMinutes: 30 });
    const result = await s.giveBack({ at: day(13, 15) });
    assert.ok(result.ok);
    const late = (await charges(s.budget.id)).find((c) => c.kind === "LATE");
    assert.equal(late?.amount, 300_000);
    assert.equal(late?.quantity, 3);
    assert.match(late?.dedupeKey ?? "", /^late:event:/);
  });

  await t.test("condonar exige motivo; aplicar y reabrir; un cargo ajeno responde 404", async () => {
    const s = await seed();
    await s.giveBack({ damaged: 2 });
    const [charge] = await charges(s.budget.id);
    await assert.rejects(settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "waive", reason: "  " }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 400);
    const waived = await settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "waive", reason: "Cliente frecuente" });
    assert.equal(waived.status, "WAIVED");
    assert.equal(waived.reason, "Cliente frecuente");
    const reopened = await settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "reopen" });
    assert.equal(reopened.status, "PROPOSED");
    const edited = await settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "update", quantity: 2, unitAmount: 10_000 });
    assert.equal(edited.amount, 20_000);
    const applied = await settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "apply" });
    assert.equal(applied.status, "APPLIED");
    await assert.rejects(settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "update", quantity: 1 }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 409);
    const other = await seed();
    await assert.rejects(settlement.decideRentalCharge(other.context, s.budget.id, charge.id, { action: "apply" }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 404);
    await assert.rejects(settlement.decideRentalCharge(other.context, other.budget.id, charge.id, { action: "apply" }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 404);
    assert.equal((await db.rentalCharge.findUniqueOrThrow({ where: { id: charge.id } })).status, "APPLIED", "el ajeno no la tocó");
  });

  async function settledFlow(deposit: number | null, damaged: number, purpose: "RESERVE" | "DAMAGES" = "DAMAGES") {
    const s = await seed({ deposit, purpose });
    await s.giveBack({ damaged });
    for (const charge of await charges(s.budget.id)) await settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "apply" });
    return s;
  }

  await t.test("garantía de daños 500.000 y cargos 180.000 → KEPT_PARTIAL, 320.000 a devolver, retenido entra como cobro y tesorería", async () => {
    const s = await settledFlow(500_000, 12);
    const result = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.equal(result.alreadySettled, false);
    assert.deepEqual([result.chargesTotal, result.retained, result.returned, result.extra], [180_000, 180_000, 320_000, 0]);
    const budget = await db.budget.findUniqueOrThrow({ where: { id: s.budget.id } });
    assert.equal(budget.securityDepositStatus, "KEPT_PARTIAL");
    assert.equal(budget.securityDepositRetained, 180_000);
    assert.equal(budget.total, 600_000);
    assert.ok(budget.rentalSettledAt);
    const [payment] = await payments(s.budget.id);
    assert.equal(payment.amount, 180_000);
    assert.equal(payment.method, "Garantía retenida");
    assert.equal(payment.status, "RECEIVED");
    const movements = await db.treasuryMovement.findMany({ where: { organizationId: s.org } });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].sourceId, payment.id);
    assert.equal(movements[0].direction, "IN");
    assert.equal(movements[0].amount, 180_000);
    assert.equal(await db.expectedPayment.count({ where: { budgetId: s.budget.id, concept: "extra" } }), 0);
  });

  await t.test("cargos que superan la garantía → KEPT + ExpectedPayment extra por la diferencia; el plan no lo cancela", async () => {
    const s = await settledFlow(100_000, 12);
    const result = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.deepEqual([result.retained, result.returned, result.extra], [100_000, 0, 80_000]);
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: s.budget.id } })).securityDepositStatus, "KEPT");
    const extra = await db.expectedPayment.findMany({ where: { budgetId: s.budget.id, concept: "extra" } });
    assert.equal(extra.length, 1);
    assert.equal(extra[0].amount, 80_000);
    assert.equal(extra[0].status, "AWAITING");
    assert.equal(extra[0].slot, "extra:settlement");
    assert.equal((await payments(s.budget.id)).reduce((sum, p) => sum + p.amount, 0), 100_000);
    await syncBudgetExpectedPayments({ organizationId: s.org, budgetId: s.budget.id });
    assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: extra[0].id } })).status, "AWAITING", "sincronizar el plan no cancela el extra");
  });

  await t.test("liquidar, cobrar el extra, editar el plan y re-sincronizar no devuelve 409 (el extra no es del plan)", async () => {
    const s = await settledFlow(100_000, 12);
    await settlement.settleBudgetRental(s.context, s.budget.id);
    const extra = await db.expectedPayment.findFirstOrThrow({ where: { budgetId: s.budget.id, concept: "extra" } });
    const { confirmExpectedPayment } = await import("../lib/server/expected-payments");
    const confirmed = await confirmExpectedPayment({ organizationId: s.org, expectedPaymentId: extra.id, actor: s.context });
    assert.ok(confirmed.ok, JSON.stringify(confirmed));
    assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: extra.id } })).status, "CONFIRMED");
    // Se edita el plan (seña de 100.000) y se vuelve a sincronizar: antes daba 409 para siempre.
    await db.budget.update({ where: { id: s.budget.id }, data: { advanceAmount: 100_000 } });
    const synced = await syncBudgetExpectedPayments({ organizationId: s.org, budgetId: s.budget.id });
    assert.equal(synced.created, 2, "seña y saldo del plan");
    const after = await db.expectedPayment.findUniqueOrThrow({ where: { id: extra.id } });
    assert.equal(after.status, "CONFIRMED");
    assert.equal(after.amount, 80_000, "el extra cobrado queda intacto");
  });

  await t.test("devolver mientras se liquida no deja cargos PROPOSED en un presupuesto ya liquidado", async () => {
    const s = await seed({ deposit: null });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    // La liquidación en vuelo: tiene el presupuesto bloqueado y ya marcó rentalSettledAt (sin commit).
    const settling = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${s.budget.id} FOR UPDATE`;
      await tx.budget.update({ where: { id: s.budget.id }, data: { rentalSettledAt: new Date(), rentalSettlement: { at: new Date().toISOString(), byName: "x", purpose: "DAMAGES", chargesTotal: 0, retained: 0, returned: 0, extra: 0, depositStatus: null } } });
      held();
      await gate;
    });
    await holding;
    const returning = s.giveBack({ at: day(15), damaged: 2 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await settling;
    const result = await returning;
    assert.ok(result.ok, "la devolución en sí se registra");
    assert.equal((await charges(s.budget.id)).length, 0, "ni rotura ni demora quedan PROPOSED sobre lo ya liquidado");
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: s.budget.id } })).total, 600_000);
  });

  await t.test("liquidar dos veces y en paralelo no duplica nada", async () => {
    const s = await settledFlow(100_000, 12);
    const runs = await Promise.all([1, 2, 3, 4].map(() => settlement.settleBudgetRental(s.context, s.budget.id)));
    assert.equal(runs.filter((r) => !r.alreadySettled).length, 1, "una sola liquida");
    assert.equal(runs.filter((r) => r.alreadySettled).length, 3);
    const again = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.equal(again.alreadySettled, true);
    assert.equal(again.extra, 80_000, "devuelve lo ya liquidado");
    assert.equal((await payments(s.budget.id)).length, 1);
    assert.equal(await db.treasuryMovement.count({ where: { organizationId: s.org } }), 1);
    assert.equal(await db.expectedPayment.count({ where: { budgetId: s.budget.id, concept: "extra" } }), 1);
    await assert.rejects(settlement.decideRentalCharge(s.context, s.budget.id, (await charges(s.budget.id))[0].id, { action: "reopen" }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 409, "liquidado: los cargos no cambian");
  });

  await t.test("sin cargos la garantía de daños se devuelve entera (RETURNED) y no entra plata", async () => {
    const s = await seed();
    await s.giveBack();
    const result = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.deepEqual([result.retained, result.returned, result.extra], [0, 500_000, 0]);
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: s.budget.id } })).securityDepositStatus, "RETURNED");
    assert.equal((await payments(s.budget.id)).length, 0);
  });

  await t.test("garantía de reserva: al recibirla baja el saldo (cobro confirmado); los cargos van como extra y no se devuelve", async () => {
    const s = await seed({ deposit: 300_000, purpose: "RESERVE" });
    const received = await payments(s.budget.id);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, "Garantía de reserva");
    assert.equal(received[0].amount, 300_000);
    assert.equal(await db.treasuryMovement.count({ where: { organizationId: s.org } }), 1);
    await assert.rejects(transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "RETURNED" }), (e: unknown) => e instanceof SecurityDepositError && e.status === 409);
    await s.giveBack({ damaged: 12 });
    for (const charge of await charges(s.budget.id)) await settlement.decideRentalCharge(s.context, s.budget.id, charge.id, { action: "apply" });
    const result = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.deepEqual([result.retained, result.returned, result.extra], [0, 0, 180_000]);
    assert.equal((await payments(s.budget.id)).length, 1, "no entra otro cobro");
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: s.budget.id } })).securityDepositStatus, "HELD");
    assert.equal((await db.expectedPayment.findFirstOrThrow({ where: { budgetId: s.budget.id, concept: "extra" } })).amount, 180_000);
  });

  await t.test("no se liquida con cargos sin decidir, con equipos sin devolver ni con la garantía sin recibir", async () => {
    const pending = await seed();
    await assert.rejects(settlement.settleBudgetRental(pending.context, pending.budget.id), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 409 && /devolver/.test(e.message));
    const open = await seed();
    await open.giveBack({ damaged: 1 });
    await assert.rejects(settlement.settleBudgetRental(open.context, open.budget.id), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 409 && /sin decidir/.test(e.message));
    const unreceived = await seed({ received: false });
    await unreceived.giveBack();
    await assert.rejects(settlement.settleBudgetRental(unreceived.context, unreceived.budget.id), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 409 && /recibió/.test(e.message));
    assert.equal(await db.budget.count({ where: { id: { in: [pending.budget.id, open.budget.id, unreceived.budget.id] }, rentalSettledAt: { not: null } } }), 0);
  });

  await t.test("liquidar un presupuesto ajeno responde 404 y no escribe", async () => {
    const a = await settledFlow(500_000, 12);
    const b = await seed();
    await assert.rejects(settlement.settleBudgetRental(b.context, a.budget.id), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 404);
    await assert.rejects(settlement.getSettlementView(b.org, a.budget.id), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 404);
    await assert.rejects(settlement.addRentalCharge(b.context, a.budget.id, { label: "X", quantity: 1, unitAmount: 5 }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 404);
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: a.budget.id } })).rentalSettledAt, null);
    assert.equal((await payments(a.budget.id)).length, 0);
  });

  await t.test("cargo personalizado por categoría: se ofrece solo según lo devuelto y se agrega aplicado", async () => {
    const s = await seed({ deposit: null });
    const other = await db.inventoryCategory.create({ data: { id: randomUUID(), organizationId: s.org, name: "Mantelería", key: `mant-${s.org}` } });
    await saveRentalSettings(s.org, {
      customCharges: [
        { id: "lavado", name: "Lavado de pieza", amount: 1_000, unit: "PIECE", categoryId: s.category.id },
        { id: "mancha", name: "Mancha de mantel", amount: 30_000, unit: "PIECE", categoryId: other.id },
        { id: "armado", name: "Armado extra", amount: 150_000, unit: "EVENT", categoryId: null },
      ],
    });
    assert.equal(await validateRentalSettingsRefs(s.org, { customCharges: [{ id: "x", name: "X", amount: 1, unit: "EVENT", categoryId: other.id }] }), null);
    assert.match((await validateRentalSettingsRefs(s.org, { customCharges: [{ id: "x", name: "X", amount: 1, unit: "EVENT", categoryId: randomUUID() }] })) ?? "", /categoría/);
    await s.giveBack();
    const view = await settlement.getSettlementView(s.org, s.budget.id);
    assert.deepEqual(view.offers.map((offer) => [offer.typeId, offer.suggestedQuantity]), [["lavado", 12], ["armado", 1]]);
    const added = await settlement.addRentalCharge(s.context, s.budget.id, { typeId: "lavado", quantity: 12 });
    assert.equal(added.amount, 12_000);
    assert.equal(added.status, "APPLIED");
    assert.equal(added.kind, "CUSTOM");
    await assert.rejects(settlement.addRentalCharge(s.context, s.budget.id, { typeId: "inexistente" }), (e: unknown) => e instanceof settlement.RentalSettlementError && e.status === 404);
    const result = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.equal(result.extra, 12_000, "sin garantía, todo va como extra");
  });

  await t.test("garantía sugerida por categoría y por % desde los ajustes; «opcional» no se aplica sola", async () => {
    const s = await seed({ deposit: null });
    await saveRentalSettings(s.org, { securityDepositMode: "ALWAYS", securityDepositCalc: "PER_PRODUCT", securityDepositRules: [{ categoryId: s.category.id, amount: 20_000 }] });
    const lines = [{ inventoryId: s.item.id, quantity: 12 }];
    assert.equal(await settlement.suggestDepositForOrder(s.org, { total: 600_000, lines }, { auto: true }), 240_000);
    await saveRentalSettings(s.org, { securityDepositRules: [{ categoryId: s.category.id, amount: 20_000 }, { inventoryId: s.item.id, amount: 25_000 }] });
    assert.equal(await settlement.suggestDepositForOrder(s.org, { total: 600_000, lines }), 300_000, "el producto gana a la categoría");
    await saveRentalSettings(s.org, { securityDepositMode: "OPTIONAL", securityDepositCalc: "PERCENT", securityDepositPercent: 50 });
    assert.equal(await settlement.suggestDepositForOrder(s.org, { total: 600_000, lines }, { auto: true }), null, "opcional: no se propone sola");
    assert.equal(await settlement.suggestDepositForOrder(s.org, { total: 600_000, lines }), 300_000);
    await saveRentalSettings(s.org, { securityDepositMode: "NONE" });
    assert.equal(await settlement.suggestDepositForOrder(s.org, { total: 600_000, lines }), null);
    const set = await setBudgetSecurityDeposit(s.context, s.budget.id, 250_000, "RESERVE");
    assert.equal(set.securityDepositPurpose, "RESERVE");
  });

  await t.test("cancelación con 3 tramos: propone la retención de la seña sin tocar plata", async () => {
    const s = await seed({ deposit: null });
    await db.event.update({ where: { id: s.event.id }, data: { startsAt: new Date(Date.now() + 10 * 86_400_000 + 3_600_000) } });
    await db.clientPayment.create({ data: { id: randomUUID(), organizationId: s.org, clientId: s.client.id, budgetId: s.budget.id, amount: 1_000_000, status: "RECEIVED", method: "Transferencia", paidAt: new Date() } });
    const near = await settlement.proposeCancellationRetention(s.org, s.budget.id);
    assert.deepEqual([near.daysBefore, near.percent, near.retained, near.refundable], [10, 50, 500_000, 500_000]);
    await db.event.update({ where: { id: s.event.id }, data: { startsAt: new Date(Date.now() + 20 * 86_400_000) } });
    assert.equal((await settlement.proposeCancellationRetention(s.org, s.budget.id)).percent, 0);
    await db.event.update({ where: { id: s.event.id }, data: { startsAt: new Date(Date.now() + 3 * 86_400_000) } });
    const late = await settlement.proposeCancellationRetention(s.org, s.budget.id);
    assert.deepEqual([late.percent, late.retained], [100, 1_000_000]);
    assert.equal((await payments(s.budget.id)).length, 1, "solo propone: no reembolsa ni mueve plata");
    await saveRentalSettings(s.org, { cancellationPolicy: [{ minDaysBefore: 30, retainPercent: 10 }, { minDaysBefore: 5, retainPercent: 40 }, { minDaysBefore: 0, retainPercent: 90 }] });
    assert.equal((await settlement.proposeCancellationRetention(s.org, s.budget.id)).percent, 90, "usa la política de la empresa");
  });

  await t.test("el portal muestra cargos decididos, la liquidación, las condiciones y la política; nunca el motivo interno", async () => {
    const s = await seed();
    await saveRentalSettings(s.org, { rentalTerms: "Se devuelve limpio y completo." });
    await s.giveBack({ damaged: 12, at: day(15) });
    const [first, second] = await charges(s.budget.id);
    await settlement.decideRentalCharge(s.context, s.budget.id, first.id, { action: "apply" });
    await settlement.decideRentalCharge(s.context, s.budget.id, second.id, { action: "waive", reason: "Motivo interno reservado" });
    const portal = await loadPortalRental(s.org, s.budget.id);
    assert.equal(portal?.terms, "Se devuelve limpio y completo.");
    assert.equal(portal?.cancellationLines.length, 3);
    assert.equal(portal?.charges.length, 2);
    assert.ok(!JSON.stringify(portal).includes("Motivo interno"));
    assert.equal(portal?.settlement, null, "antes de liquidar no hay resultado");
    await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.ok((await loadPortalRental(s.org, s.budget.id))?.settlement);
    assert.equal(await loadPortalRental(randomUUID(), s.budget.id), null, "otra empresa no ve el alquiler");
  });

  await t.test("los ajustes guardan y leen los JSON de la empresa sin mezclarlos con otra", async () => {
    const a = await seed({ deposit: null });
    const b = await seed({ deposit: null });
    await saveRentalSettings(a.org, { lateFeeKind: "FIXED", lateFeeValue: 200_000, customCharges: [{ id: "c", name: "Armado", amount: 5_000, unit: "EVENT", categoryId: null }] });
    const sa = await getRentalSettings(a.org);
    const sb = await getRentalSettings(b.org);
    assert.equal(sa.lateFeeValue, 200_000);
    assert.equal(sa.customCharges.length, 1);
    assert.equal(sb.lateFeeValue, 10);
    assert.equal(sb.customCharges.length, 0);
  });
});
