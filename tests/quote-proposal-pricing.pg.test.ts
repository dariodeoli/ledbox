import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/quote-proposal-pricing.pg.test.ts
test("la propuesta de la empresa usa el mismo precio de línea que la conversión (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { POST: preorderPost } = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const { convertQuoteRequest } = await import("../lib/server/catalog-convert");
  const { modifyQuoteRequest, respondToProposal } = await import("../lib/server/quote-request-response");

  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const actor = { id: "u", name: "Dueña", email: "d@x.test" };
  const org = randomUUID();
  const slug = `qp-${org.slice(0, 8)}`;
  const orgsToClean = [org];

  try {
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    await db.organizationRentalSettings.create({
      data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: true, publicShowPrices: true, depositPercent: 50, whatsappPhone: "+595981123456" },
    });
    const item = (name: string, category: string, quantity: number, listPrice: number, extra: Record<string, unknown> = {}) =>
      db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category, quantity, visibleOnWeb: true, catalogAudience: "BOTH", listPrice, wholesalePrice: listPrice, dailyCost: 100, ...extra } });
    const tier = (inventoryId: string, mode: "TOTAL" | "PER_DAY", fromDays: number, price: number) =>
      db.inventoryPriceTier.create({ data: { id: randomUUID(), organizationId: org, inventoryId, audience: "RETAIL", fromDays, mode, price } });

    // Pantalla: desde 5 días 300.000 TOTAL. Reemplazo: desde 5 días 250.000 TOTAL y columnas viejas con valores que NO deben usarse.
    const pantalla = await item("Pantalla A", "Pantallas", 4, 90_000);
    await tier(pantalla.id, "TOTAL", 5, 300_000);
    const pantallaB = await item("Pantalla B", "Pantallas", 4, 80_000, { listFromDays: 2, listFromPrice: 1_000 });
    await tier(pantallaB.id, "TOTAL", 5, 250_000);
    // Mesa: por día, desde 5 días 7.000 por día.
    const mesa = await item("Mesa", "Mobiliario", 10, 10_000);
    await tier(mesa.id, "PER_DAY", 5, 7_000);
    // Atril: otro escalón TOTAL (desde 3 días 90.000) cuya cantidad cambia.
    const atril = await item("Atril", "Soportes", 10, 20_000);
    await tier(atril.id, "TOTAL", 3, 90_000);

    const ctx = { organizationId: org, organization: { id: org, name: `Empresa ${slug}`, slug, planId: null }, user: { id: randomUUID(), name: "Dueña", email: "d@x.test", role: "OWNER" }, role: "OWNER", demo: false, sandbox: false } as never;
    const response = await preorderPost(
      new Request(`http://x/api/catalog/${slug}/preorder`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.7.0.1" },
        body: JSON.stringify({ name: "Ana Pérez", phone: "+595 981 000 111", email: "ana@example.com", location: "Asunción", from: day(30), to: day(35), items: [{ inventoryId: pantalla.id, quantity: 2 }, { inventoryId: mesa.id, quantity: 3 }, { inventoryId: atril.id, quantity: 1 }] }),
      }),
      { params: Promise.resolve({ orgSlug: slug }) },
    );
    assert.equal(response.status, 201, await response.clone().text());
    const { preorder } = (await response.json()) as { preorder: { token: string } };
    const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: preorder.token }, include: { items: true } });
    const lineOf = (name: string) => quote.items.find((entry) => entry.productName === name)!;

    // Flete por zona: 30.000 + 10.000 de recargo desde 5 piezas (la propuesta trae 9).
    const zone = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: org, name: "Asunción", basePrice: 30_000, volumeThreshold: 5, extraPrice: 10_000 } });
    await db.quoteRequest.update({ where: { id: quote.id }, data: { deliveryZoneId: zone.id, deliveryZoneName: zone.name } });

    await t.test("sustituir (escalón TOTAL) y cambiar cantidades: referenceTotal == total del presupuesto convertido", async () => {
      const proposal = await modifyQuoteRequest(
        ctx,
        quote.id,
        {
          lines: [
            { itemId: lineOf("Pantalla A").id, action: "substitute", quantity: 2, substituteInventoryId: pantallaB.id },
            { itemId: lineOf("Mesa").id, action: "quantity", quantity: 4 },
            { itemId: lineOf("Atril").id, action: "quantity", quantity: 3 },
          ],
          note: null,
        },
        actor,
      );
      assert.ok(proposal.ok, proposal.ok ? "" : proposal.error);
      if (!proposal.ok) return;
      // 6 días: Pantalla B 2 × 250.000 (total del período) + Mesa 4 × 7.000 × 6 + Atril 3 × 90.000.
      const items = 2 * 250_000 + 4 * 7_000 * 6 + 3 * 90_000;
      const expected = items + 40_000; // con el flete de la zona, igual que la conversión
      assert.equal(proposal.total, expected);
      const stored = await db.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { items: true } });
      assert.equal(stored.referenceTotal, expected);
      const substituted = stored.items.find((entry) => entry.inventoryId === pantallaB.id)!;
      assert.equal(substituted.unitPrice, 250_000, "no usa las columnas viejas listFromDays/listFromPrice");
      assert.equal(substituted.subtotal, 500_000);
      assert.equal(stored.items.reduce((sum, entry) => sum + (entry.subtotal ?? 0), 0), items, "el subtotal de las líneas suma el total");

      const approved = await respondToProposal(preorder.token, "approve");
      assert.ok(approved.ok);
      const converted = await convertQuoteRequest(ctx, quote.id);
      assert.ok(converted.ok, converted.ok ? "" : converted.error);
      if (!converted.ok) return;
      assert.equal(converted.budget.total, expected, "la conversión da el mismo total que la propuesta");
      assert.equal(converted.budget.subtotal, stored.referenceTotal);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgsToClean } } });
    await db.$disconnect();
  }
});
