import assert from "node:assert/strict";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/demo-completa.pg.test.ts
test("demo completa: un ejemplo de cada estado, coherente con el motor de reservas, idempotente y rápida", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { ensureDemoData, DEMO_ORGANIZATION_ID } = await import("../lib/server/demo-data");
  const { DEMO_COMPLETION_EXPECTED: expected } = await import("../lib/server/demo-data-completa");
  const engine = await import("../lib/server/inventory-availability");
  const { verifySignatureChain } = await import("../lib/server/signature/hash");

  const org = { organizationId: DEMO_ORGANIZATION_ID };
  const started = Date.now();
  await ensureDemoData({ reset: true } as never);
  const firstMs = Date.now() - started;
  const now = new Date();

  const statuses = async (rows: Promise<Array<Record<string, unknown>>>, field: string) =>
    new Set((await rows).map((row) => String(row[field])));

  await t.test("es rápida (menos de 10 s) e idempotente: reponer dos veces deja los mismos conteos", async () => {
    assert.ok(firstMs < 10_000, `la carga tardó ${firstMs} ms`);
    const count = async () => ({
      budgets: await dbWithDeleted.budget.count({ where: org }),
      items: await dbWithDeleted.inventoryItem.count({ where: org }),
      units: await db.inventoryUnit.count({ where: org }),
      incidents: await db.inventoryIncident.count({ where: org }),
      assignments: await db.eventInventory.count({ where: org }),
      signatures: await db.signatureRequest.count({ where: org }),
      sigEvents: await db.signatureEvent.count({ where: org }),
      payments: await db.clientPayment.count({ where: org }),
      expected: await db.expectedPayment.count({ where: org }),
    });
    const before = await count();
    const again = Date.now();
    await ensureDemoData({ reset: true } as never);
    assert.ok(Date.now() - again < 10_000, "la segunda carga también es rápida");
    assert.deepEqual(await count(), before);
  });

  await t.test("presupuestos: un ejemplo de cada estado, vencido, cambios pedidos, firma y depósitos", async () => {
    const budgets = await db.budget.findMany({ where: org });
    const seen = new Set(budgets.map((budget) => budget.status));
    for (const status of ["DRAFT", "SENT", "NEGOTIATING", "APPROVED", "LOST", "CANCELLED"]) assert.ok(seen.has(status as never), `falta un presupuesto ${status}`);
    assert.ok(budgets.some((b) => b.status === "SENT" && b.validUntil && b.validUntil < now), "falta un presupuesto enviado y vencido");
    assert.ok(budgets.some((b) => b.revisionRequestedAt && b.status === "NEGOTIATING"), "falta uno con cambios pedidos");
    assert.ok(budgets.some((b) => b.status === "APPROVED" && b.approvalMethod === "digital"), "falta uno aprobado por el portal");
    assert.ok(budgets.some((b) => b.status === "APPROVED" && b.approvalMethod === "manual"), "falta uno aprobado a mano");
    const deposits = new Set(budgets.map((b) => b.securityDepositStatus).filter(Boolean));
    for (const status of ["PENDING", "HELD", "RETURNED", "KEPT_PARTIAL"]) assert.ok(deposits.has(status), `falta un depósito ${status}`);
    // El planteo de pagos nunca supera el total y los montos son enteros.
    for (const budget of budgets) {
      assert.ok(Number.isInteger(budget.total) && budget.total >= 0);
      assert.ok(budget.advanceAmount <= budget.total, `${budget.id}: el anticipo supera el total`);
    }
    // Pagado completo: la suma de cobros recibidos iguala el total.
    const paid = expected.budgets.paidInFull;
    const received = await db.clientPayment.aggregate({ where: { ...org, budgetId: paid, status: "RECEIVED" }, _sum: { amount: true } });
    const total = (await db.budget.findUniqueOrThrow({ where: { id: paid } })).total;
    assert.equal(received._sum.amount, total);
    // Con comprobante en revisión y cuotas pendientes.
    const expectedStatuses = await statuses(db.expectedPayment.findMany({ where: org }) as never, "status");
    for (const status of ["AWAITING", "PROOF", "CONFIRMED"]) assert.ok(expectedStatuses.has(status), `falta un pago esperado ${status}`);
    // Papelera: archivado y eliminado.
    const archived = await dbWithDeleted.budget.findUniqueOrThrow({ where: { id: expected.budgets.archived } });
    assert.ok(archived.archivedAt && !archived.deletedAt);
    const deleted = await dbWithDeleted.budget.findUniqueOrThrow({ where: { id: expected.budgets.deleted } });
    assert.ok(deleted.deletedAt && deleted.archivedAt && deleted.deleteReason);
    assert.equal(await db.budget.count({ where: { id: expected.budgets.deleted } }), 0, "lo eliminado no se ve en las lecturas normales");
  });

  await t.test("firmas: una solicitud por estado con su cadena de auditoría íntegra", async () => {
    const requests = await db.signatureRequest.findMany({ where: org, include: { events: { orderBy: { occurredAt: "asc" } }, evidence: true } });
    const seen = new Set(requests.map((request) => request.status));
    for (const status of expected.signatureStatuses) assert.ok(seen.has(status as never), `falta una firma ${status}`);
    const codes = new Set(requests.map((request) => request.publicCode));
    assert.equal(codes.size, requests.length, "códigos públicos únicos");
    for (const request of requests) {
      assert.ok(request.events.length > 0);
      assert.deepEqual(verifySignatureChain(request.events), { valid: true, brokenAt: null }, `cadena rota en ${request.id}`);
      for (const event of request.events) assert.ok(event.occurredAt <= now, "los eventos de firma están en el pasado");
      if (request.status === "VALIDATED") {
        assert.ok(request.signedAt && request.validatedAt && request.signedDocumentHash);
        assert.ok(request.evidence.some((e) => e.type === "SIGNATURE" && e.status === "COMPLETED"));
      }
    }
    const signed = requests.find((request) => request.budgetId === expected.budgets.signed)!;
    assert.equal(signed.status, "VALIDATED");
  });

  await t.test("eventos, clientes, oportunidades y proveedores: todos los estados", async () => {
    const events = await statuses(db.event.findMany({ where: org }) as never, "status");
    for (const status of ["DRAFT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) assert.ok(events.has(status), `falta un evento ${status}`);
    const leads = await statuses(db.lead.findMany({ where: org }) as never, "status");
    for (const status of ["NEW", "CONTACTED", "WON", "LOST"]) assert.ok(leads.has(status), `falta un lead ${status}`);
    const types = await statuses(db.client.findMany({ where: org }) as never, "type");
    assert.ok(types.has("FINAL") && types.has("RESELLER"));
    const tokens = await db.catalogAccessToken.findMany({ where: org });
    assert.ok(tokens.some((token) => !token.revokedAt) && tokens.some((token) => token.revokedAt), "link mayorista activo y revocado");
    const jobs = await statuses(db.supplierJob.findMany({ where: org }) as never, "status");
    for (const status of ["PENDING", "CONTRACTED", "ADVANCE_PENDING", "ADVANCE_PAID", "IN_PRODUCTION", "DELIVERED", "BALANCE_PENDING", "PAID", "CANCELLED"]) assert.ok(jobs.has(status), `falta un trabajo ${status}`);
    const payments = await statuses(db.clientPayment.findMany({ where: org }) as never, "status");
    for (const status of ["PENDING", "RECEIVED", "CANCELLED"]) assert.ok(payments.has(status), `falta un cobro ${status}`);
    // Cada cobro recibido tiene su ingreso de tesorería (sin doble conteo).
    const receivedPayments = await db.clientPayment.findMany({ where: { ...org, status: "RECEIVED" }, select: { id: true } });
    const movements = await db.treasuryMovement.findMany({ where: { ...org, origin: "client_payment" }, select: { sourceId: true } });
    assert.deepEqual(new Set(movements.map((m) => m.sourceId)), new Set(receivedPayments.map((p) => p.id)));
    assert.equal(await db.fiscalPeriod.count({ where: { ...org, status: "CLOSED" } }) > 0, true, "mes cerrado");
    // Papelera: algo archivado y algo eliminado en cada entidad.
    const trash = [
      ["event", "demo_event_archivado_lg", "demo_event_eliminado_prueba"],
      ["client", "demo_client_archivado", "demo_client_eliminado"],
      ["lead", "demo_lead_archivado", "demo_lead_eliminado"],
      ["supplier", "demo_supplier_archivado", "demo_supplier_eliminado"],
      ["promoter", "demo_promoter_archivada", "demo_promoter_eliminada"],
      ["inventoryItem", expected.archived, expected.deleted],
    ] as const;
    for (const [model, archivedId, deletedId] of trash) {
      const delegate = (dbWithDeleted as unknown as Record<string, { findUniqueOrThrow(args: unknown): Promise<{ archivedAt: Date | null; deletedAt: Date | null; deleteReason?: string | null }> }>)[model];
      const archived = await delegate.findUniqueOrThrow({ where: { id: archivedId } });
      assert.ok(archived.archivedAt && !archived.deletedAt, `${model}: archivado`);
      const deleted = await delegate.findUniqueOrThrow({ where: { id: deletedId } });
      assert.ok(deleted.deletedAt && deleted.deleteReason, `${model}: eliminado con motivo`);
    }
  });

  await t.test("inventario: unidades e incidentes cubren todos los estados y se explican entre sí", async () => {
    const units = await statuses(db.inventoryUnit.findMany({ where: org }) as never, "status");
    for (const status of ["AVAILABLE", "MAINTENANCE", "RETIRED", "DAMAGED", "LOST"]) assert.ok(units.has(status), `falta una unidad ${status}`);
    const incidents = await db.inventoryIncident.findMany({ where: org });
    const incidentStatuses = new Set(incidents.map((incident) => incident.status));
    for (const status of ["OPEN", "IN_REPAIR", "RESOLVED", "WRITTEN_OFF"]) assert.ok(incidentStatuses.has(status as never), `falta un incidente ${status}`);
    // Toda unidad fuera de circulación tiene un incidente abierto o en reparación que la explica.
    const open = new Set(incidents.filter((i) => i.status === "OPEN" || i.status === "IN_REPAIR").map((i) => i.unitId));
    const problem = await db.inventoryUnit.findMany({ where: { ...org, status: { in: ["MAINTENANCE", "DAMAGED", "LOST"] } } });
    for (const unit of problem) assert.ok(open.has(unit.id), `la unidad ${unit.code} (${unit.status}) no tiene incidente abierto`);
    // Y a la inversa: una unidad disponible no tiene incidente abierto.
    const available = new Set((await db.inventoryUnit.findMany({ where: { ...org, status: "AVAILABLE" }, select: { id: true } })).map((u) => u.id));
    for (const incident of incidents.filter((i) => i.status === "OPEN" || i.status === "IN_REPAIR")) assert.ok(!incident.unitId || !available.has(incident.unitId), `incidente ${incident.id} sobre una unidad disponible`);
    // La cantidad del producto es la de unidades activas.
    const items = await db.inventoryItem.findMany({ where: org, include: { units: true, components: true } });
    for (const item of items.filter((i) => i.components.length === 0)) {
      assert.equal(item.quantity, item.units.filter((u) => u.status !== "RETIRED").length, `${item.name}: la cantidad no coincide con sus unidades activas`);
    }
    const combos = items.filter((item) => item.components.length > 0);
    assert.ok(combos.length >= 3 && combos.some((c) => c.id === expected.combo));
    assert.ok(items.some((item) => item.archivedAt) && items.some((item) => item.status === "AVAILABLE") && items.some((item) => item.status === "MAINTENANCE") && items.some((item) => item.status === "RESERVED"));
  });

  await t.test("motor de reservas: lo agotado, lo reservado y lo que está en mantenimiento salen del motor", async () => {
    const load = async (id: string) => {
      const item = await db.inventoryItem.findUniqueOrThrow({ where: { id }, include: { _count: { select: engine.MAINTENANCE_UNITS_SELECT } } });
      return { ...item, maintenance: engine.maintenanceUnits(item) };
    };
    // Agotado hoy: la reserva en curso compromete toda la cantidad.
    const mic = await load(expected.soldOutNow.id);
    const during = await engine.availabilityForRange({ organizationId: DEMO_ORGANIZATION_ID, item: mic, startsAt: new Date(now.getTime() + 60 * 60_000), endsAt: new Date(now.getTime() + 2 * 60 * 60_000) });
    assert.equal(during.total, expected.soldOutNow.total);
    assert.equal(during.committed, expected.soldOutNow.total);
    assert.equal(during.available, 0, "agotado hoy");
    // Agotado en el rango del próximo evento por una reserva firme.
    const gen = await load(expected.soldOutInRange.id);
    const assignment = await db.eventInventory.findFirstOrThrow({ where: { inventoryId: gen.id }, include: { event: true } });
    const range = await engine.availabilityForRange({ organizationId: DEMO_ORGANIZATION_ID, item: gen, startsAt: assignment.event.startsAt!, endsAt: assignment.event.endsAt! });
    assert.equal(range.committed, expected.soldOutInRange.total);
    assert.equal(range.available, 0, "agotado en el rango del evento");
    assert.ok(range.conflicts.some((conflict) => conflict.eventId === assignment.eventId));
    // Fuera de ese rango (60 días después) vuelve a estar libre.
    const later = new Date(assignment.event.endsAt!.getTime() + 60 * 86_400_000);
    const free = await engine.availabilityForRange({ organizationId: DEMO_ORGANIZATION_ID, item: gen, startsAt: later, endsAt: new Date(later.getTime() + 3_600_000) });
    assert.equal(free.available, expected.soldOutInRange.total);
    // En mantenimiento: todas las unidades fuera de circulación.
    const projector = await load(expected.maintenance.id);
    assert.equal(projector.maintenance, expected.maintenance.total);
    const maint = await engine.availabilityForRange({ organizationId: DEMO_ORGANIZATION_ID, item: projector, startsAt: new Date(later.getTime()), endsAt: new Date(later.getTime() + 3_600_000) });
    assert.equal(maint.available, 0, "en mantenimiento");
    // Hay productos disponibles de verdad, lejos de toda reserva.
    const kiosk = await load("demo_inv_kiosko");
    const kioskFree = await engine.availabilityForRange({ organizationId: DEMO_ORGANIZATION_ID, item: kiosk, startsAt: later, endsAt: new Date(later.getTime() + 3_600_000) });
    assert.equal(kioskFree.available, kiosk.quantity - kiosk.maintenance);
    assert.ok(kioskFree.available > 0);
  });

  await t.test("ningún producto está sobrevendido: lo comprometido nunca supera el stock", async () => {
    const items = await db.inventoryItem.findMany({ where: org, include: { _count: { select: engine.MAINTENANCE_UNITS_SELECT } } });
    for (const raw of items.filter((candidate) => candidate.quantity > 0)) {
      const item = { ...raw, maintenance: engine.maintenanceUnits(raw) };
      const rows = await engine.loadAssignments(item.id, DEMO_ORGANIZATION_ID);
      for (const row of rows) {
        const { start, end } = engine.assignmentRange(row);
        if (!start || !end) continue;
        const result = engine.buildAvailability(item, rows, start, end);
        assert.ok(result.committed <= item.quantity, `${item.name}: comprometido ${result.committed} sobre ${item.quantity}`);
      }
    }
  });
});
