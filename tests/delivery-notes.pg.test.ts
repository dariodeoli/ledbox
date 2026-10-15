import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
test("remitos firmados en PostgreSQL: parcial, snapshot inmutable, fotos, numeración sin huecos y tenencia", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const ops = await import("../lib/server/inventory-operations");
  const notes = await import("../lib/server/delivery-notes");

  const day = (n: number, hour = 12) => new Date(Date.UTC(2033, 0, n, hour));
  const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]).toString("base64")}`;
  const jpeg = (size = 2000) => new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 1)]));

  async function org(name = "Remitos QA") {
    const id = randomUUID();
    await db.organization.create({ data: { id, name, slug: `remitos-${id}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: "Cliente" } });
    return { id, client };
  }
  async function assignment(organizationId: string, clientId: string, quantity: number, itemName = "Silla") {
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: itemName, category: "Mobiliario", quantity } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId, clientId, name: "Boda", setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13) } });
    const result = await commitInventoryAssignment({ organizationId, eventId: event.id, inventoryId: item.id, quantity, startsAt: day(10), endsAt: day(13) });
    assert.ok(result.ok, JSON.stringify(result));
    return { item, event, assignment: result.assignment };
  }
  const dispatch = (organizationId: string, assignmentId: string, quantity?: number) =>
    ops.dispatchAssignment({ organizationId, assignmentId, ...(quantity ? { quantity } : {}), at: day(11), condition: "Bueno", actorId: "u1" });
  const sign = (organizationId: string, noteId: string) =>
    notes.signDeliveryNote({ organizationId, noteId, signer: { name: "Juan Pérez", document: "1234567" }, signatureDataUrl: png, actorId: "u1", ip: "10.0.0.1", userAgent: "UA-test" });

  await t.test("la migración aplicada dos veces no falla", () => {
    const file = new URL("../prisma/migrations/202610270001_delivery_notes/migration.sql", import.meta.url).pathname;
    for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
  });

  await t.test("salida parcial: el remito trae solo lo despachado y el número es correlativo", async () => {
    const { id, client } = await org();
    const { assignment: a, event } = await assignment(id, client.id, 10);
    const out = await dispatch(id, a.id, 4);
    assert.ok(out.ok);
    assert.equal(out.deliveryNote.number, 1);
    const [note] = await notes.listDeliveryNotes(id, event.id);
    assert.equal(note.kind, "OUT");
    assert.deepEqual(note.lines.map((l) => [l.ordered, l.moved]), [[10, 4]]);
    // Otro despacho antes de firmar se acumula en el mismo remito.
    const more = await dispatch(id, a.id, 3);
    assert.ok(more.ok);
    assert.equal(more.deliveryNote.id, out.deliveryNote.id);
    const [merged] = await notes.listDeliveryNotes(id, event.id);
    assert.equal(merged.lines[0].moved, 7);
  });

  await t.test("el snapshot no cambia después de firmado: el trigger lo impide y un despacho nuevo abre otro remito", async () => {
    const { id, client } = await org();
    const { assignment: a, event } = await assignment(id, client.id, 10);
    const out = await dispatch(id, a.id, 4);
    assert.ok(out.ok);
    const signed = await sign(id, out.deliveryNote.id);
    assert.ok(signed.ok);
    assert.equal(signed.note.signerDocument, "1234567");
    const row = await db.deliveryNote.findFirstOrThrow({ where: { id: out.deliveryNote.id } });
    assert.equal(row.signedIp, "10.0.0.1");
    assert.equal(row.signedUserAgent, "UA-test");
    assert.ok(row.signatureData && row.signatureData.length > 300);
    const before = JSON.stringify(row.linesSnapshot);

    const again = await sign(id, out.deliveryNote.id);
    assert.ok(!again.ok && again.status === 409);

    await assert.rejects(
      db.$executeRawUnsafe(`UPDATE "DeliveryNote" SET "linesSnapshot" = '[]'::jsonb WHERE "id" = '${out.deliveryNote.id}'`),
      /ya está firmado/,
    );
    await assert.rejects(db.deliveryNote.update({ where: { id: out.deliveryNote.id }, data: { signerName: "Otro" } }), /ya está firmado/);

    const next = await dispatch(id, a.id, 2);
    assert.ok(next.ok);
    assert.notEqual(next.deliveryNote.id, out.deliveryNote.id);
    assert.equal(next.deliveryNote.number, 2);
    const after = await db.deliveryNote.findFirstOrThrow({ where: { id: out.deliveryNote.id } });
    assert.equal(JSON.stringify(after.linesSnapshot), before);
    assert.equal((await notes.listDeliveryNotes(id, event.id)).length, 2);
  });

  await t.test("la devolución genera un remito IN con devueltas, dañadas y faltantes", async () => {
    const { id, client } = await org();
    const { assignment: a, event } = await assignment(id, client.id, 10);
    assert.ok((await dispatch(id, a.id)).ok);
    const back = await ops.returnAssignment({ organizationId: id, assignmentId: a.id, quantity: 6, damaged: 1, missing: 2, at: day(13), condition: "Regular", actorId: "u1" });
    assert.ok(back.ok);
    const list = await notes.listDeliveryNotes(id, event.id);
    const incoming = list.find((n) => n.kind === "IN");
    assert.ok(incoming);
    assert.deepEqual(incoming.lines.map((l) => [l.ordered, l.moved, l.damaged, l.missing]), [[10, 6, 1, 2]]);
  });

  await t.test("fotos: MIME falso rechazado, tope de 10 y 1 MiB, y ninguna tras firmar", async () => {
    const { id, client } = await org();
    const { assignment: a } = await assignment(id, client.id, 5);
    const out = await dispatch(id, a.id, 2);
    assert.ok(out.ok);
    const noteId = out.deliveryNote.id;

    const fake = await notes.addDeliveryNotePhoto({ organizationId: id, noteId, bytes: new TextEncoder().encode("<script>alert(1)</script>") });
    assert.ok(!fake.ok && fake.status === 400);
    const big = await notes.addDeliveryNotePhoto({ organizationId: id, noteId, bytes: jpeg(1024 * 1024) });
    assert.ok(!big.ok && big.status === 413);
    for (let i = 0; i < 10; i++) assert.ok((await notes.addDeliveryNotePhoto({ organizationId: id, noteId, bytes: jpeg() })).ok);
    const eleventh = await notes.addDeliveryNotePhoto({ organizationId: id, noteId, bytes: jpeg() });
    assert.ok(!eleventh.ok && eleventh.status === 409);
    assert.equal(await db.deliveryNotePhoto.count({ where: { noteId } }), 10);

    assert.ok((await sign(id, noteId)).ok);
    const late = await notes.addDeliveryNotePhoto({ organizationId: id, noteId, bytes: jpeg() });
    assert.ok(!late.ok && late.status === 409);
  });

  await t.test("tenencia: otra empresa recibe 404 al firmar, subir o quitar fotos, y no ve el remito", async () => {
    const mine = await org("Mía");
    const other = await org("Ajena");
    const { assignment: a, event } = await assignment(mine.id, mine.client.id, 5);
    const out = await dispatch(mine.id, a.id, 2);
    assert.ok(out.ok);
    const noteId = out.deliveryNote.id;
    const signed = await sign(other.id, noteId);
    assert.ok(!signed.ok && signed.status === 404);
    const photo = await notes.addDeliveryNotePhoto({ organizationId: other.id, noteId, bytes: jpeg() });
    assert.ok(!photo.ok && photo.status === 404);
    const removed = await notes.removeDeliveryNotePhoto({ organizationId: other.id, noteId, photoId: randomUUID() });
    assert.ok(!removed.ok && removed.status === 404);
    assert.equal(await notes.loadDeliveryNote(other.id, noteId), null);
    assert.deepEqual(await notes.listDeliveryNotes(other.id, event.id), []);
    // El despacho de la otra empresa sobre una asignación ajena tampoco crea remito.
    const foreign = await dispatch(other.id, a.id, 1);
    assert.ok(!foreign.ok);
    assert.equal(await db.deliveryNote.count({ where: { organizationId: other.id } }), 0);
  });

  await t.test("concurrencia: 16 despachos simultáneos dan números 1..16 sin huecos ni repetidos", async () => {
    const { id, client } = await org();
    const rows = [];
    for (let i = 0; i < 16; i++) rows.push(await assignment(id, client.id, 3, `Ítem ${i}`));
    const results = await Promise.all(rows.map((row) => dispatch(id, row.assignment.id, 2)));
    assert.ok(results.every((r) => r.ok));
    const numbers = (await db.deliveryNote.findMany({ where: { organizationId: id }, select: { number: true } })).map((n) => n.number).sort((x, y) => x - y);
    assert.deepEqual(numbers, Array.from({ length: 16 }, (_, i) => i + 1));
  });

  await t.test("una transacción revertida no deja hueco en la numeración", async () => {
    const { id } = await org();
    assert.equal(await db.$transaction((tx) => notes.nextDeliveryNoteNumber(tx, id)), 1);
    await assert.rejects(
      db.$transaction(async (tx) => {
        assert.equal(await notes.nextDeliveryNoteNumber(tx, id), 2);
        throw new Error("se revierte");
      }),
      /se revierte/,
    );
    assert.equal(await db.$transaction((tx) => notes.nextDeliveryNoteNumber(tx, id)), 2);
    // Otra empresa tiene su propia serie.
    const other = await org("Otra");
    assert.equal(await db.$transaction((tx) => notes.nextDeliveryNoteNumber(tx, other.id)), 1);
  });
});
