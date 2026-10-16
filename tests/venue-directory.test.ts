import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { eventVenueSnapshot, venueKey, type SavedEventVenue } from "../lib/event-venues";
import { parseEventFields } from "../app/api/admin/events/event-fields";
import { EventVenueError } from "../lib/server/event-venues";
function realFunction(file: string, name: string, globals: Record<string, unknown>) {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const fn = src.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  return runInNewContext(ts.transpileModule(fn.getText(src).replace(/^export /, "") + `\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { Prisma, randomUUID, Object, Number, eventVenueSnapshot, venueKey, parseEventFields, EventVenueError, ...globals });
}

test("servicio real: nuevo recinto sólo copia defaults normalizados y dedup no sobreescribe", async () => {
  let inserts = 0, duplicate = false, lock = false;
  const data = { ...eventVenueSnapshot({ location: "Salón QA", city: "Asunción", venueContactEmail: "qa@example.invalid" }), id: "venue", revision: 0, needsReview: false };
  const save = realFunction("lib/server/event-venues.ts", "saveEventVenue", { db: { $transaction: async (fn: any) => fn({
    $executeRaw: async (sql: any, organizationId: string) => { assert.match(sql[0], /advisory/); assert.equal(organizationId, "own"); lock = true; },
    $queryRaw: async (sql: any) => {
      assert.ok(lock); assert.ok(sql.values.includes("own"));
      if (sql.sql.startsWith('SELECT "id"')) return duplicate ? [{ id: "other-venue" }] : [];
      assert.match(sql.sql, /^INSERT INTO "EventVenue"/); assert.ok(sql.values.includes("Asunción")); assert.ok(sql.values.includes("qa@example.invalid"));
      assert.ok(!sql.values.includes("Cliente privado")); inserts++; return [data];
    },
  }) } });
  const result = await save("own", { location: " Salón   QA ", city: "asuncion", venueContactEmail: "QA@EXAMPLE.INVALID", responsibleName: "Cliente privado", clientId: "no" });
  assert.equal(result.venue.location, "Salón QA"); assert.equal(result.venue.revision, 0); assert.equal(result.before, null); assert.equal((result.venue as any).organizationId, undefined); assert.equal(inserts, 1);
  duplicate = true;
  await assert.rejects(() => save("own", { location: "SALÓN QA" }), (e: any) => e.status === 409 && e.code === "venue_duplicate"); assert.equal(inserts, 1);
  await assert.rejects(() => save("own", { location: "Otro", city: "AsunciónX" }), (e: any) => e.status === 400); assert.equal(inserts, 1);
});

test("servicio real: CAS, tenant y ciudad histórica sin cambios; PATCH ausente conserva contacto", async () => {
  const before: SavedEventVenue = { ...eventVenueSnapshot({ location: "Salón QA", city: "Ciudad histórica", venueContactName: "Ana", venueContactPhone: "+595981123456" }), id: "own-venue", revision: 4, needsReview: true };
  let updates = 0;
  const save = realFunction("lib/server/event-venues.ts", "saveEventVenue", { db: { $transaction: async (fn: any) => fn({
    $executeRaw: async () => {},
    $queryRaw: async (sql: any) => {
      assert.ok(sql.values.includes("own"));
      if (sql.sql.startsWith("SELECT *")) return sql.values.includes("foreign-venue") ? [] : [before];
      if (sql.sql.startsWith('SELECT "id"')) return [{ id: before.id }];
      assert.match(sql.sql, /^UPDATE "EventVenue"/); assert.match(sql.sql, /"revision" = "revision" \+ 1/); assert.match(sql.sql, /"needsReview" = false/);
      assert.ok(sql.values.includes("Ciudad histórica")); assert.ok(sql.values.includes("Ana")); updates++; return [{ ...before, revision: 5, needsReview: false, address: "Nueva dirección" }];
    },
  }) } });
  await assert.rejects(() => save("own", { id: before.id, expectedRevision: 3, address: "Otro" }), (e: any) => e.status === 409 && e.code === "venue_revision_conflict");
  await assert.rejects(() => save("own", { id: "foreign-venue", expectedRevision: 4 }), (e: any) => e.status === 404);
  assert.equal(updates, 0);
  const result = await save("own", { id: before.id, expectedRevision: 4, address: "Nueva dirección" }); assert.equal(result.venue.revision, 5); assert.equal(result.venue.needsReview, false); assert.equal(updates, 1);
});

test("libreta independiente: eventos sólo leen defaults, formulario guarda por acción explícita", () => {
  const events = readFileSync("app/api/admin/events/route.ts", "utf8"); assert.match(events, /loadEventVenues/); assert.doesNotMatch(events, /saveEventVenue|EventVenue" SET|INSERT INTO "EventVenue/);
  const ui = readFileSync("components/admin/modules/EventQuickForm.tsx", "utf8"); assert.match(ui, /onSelectOption=\{chooseVenue\}/); assert.match(ui, /expectedRevision: savedVenue.revision/); assert.match(ui, /AdminConfirmDialog title="Actualizar recinto guardado"/);
  assert.match(ui, /venueNeedsReselect && savedVenue/); assert.match(ui, /setVenueNeedsReselect\(false\)/);
  assert.match(ui, /Guardar recinto en la libreta/); assert.match(ui, /canWriteOperations\(role\)/);
  const api = readFileSync("app/api/admin/venues/route.ts", "utf8"); assert.match(api, /requireAdminContext\("events.write"\)/); assert.match(api, /saveEventVenue\(auth.context.organizationId, body\)/);
  const migration = readFileSync("prisma/migrations/202611040001_event_venue_directory/migration.sql", "utf8"); assert.doesNotMatch(migration, /UPDATE "Event"|ALTER TABLE "Event"|REFERENCES "Event"/); assert.match(migration, /WHERE e."deletedAt" IS NULL/); assert.match(migration, /"needsReview"/); assert.match(migration, /ON CONFLICT.*DO NOTHING/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "EventVenue"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/);
});
