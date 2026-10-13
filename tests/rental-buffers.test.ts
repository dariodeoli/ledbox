import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  NO_RENTAL_BUFFERS,
  assignmentCountsAt,
  assignmentIsActiveNow,
  buildAvailability,
  extendedRentalRange,
  resolveRentalBuffers,
} from "../lib/server/inventory-availability";
import { parseRentalSettingsPatch, RENTAL_SETTINGS_DEFAULTS, toRentalSettingsView } from "../lib/server/rental-settings";
import { inventoryStatusLabel } from "../lib/admin-format";

const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (hour: number, day = 10) => new Date(Date.UTC(2031, 0, day, hour));

test("resolveRentalBuffers: antes = prep + transporte + entrega; después = devolución + transporte + limpieza", () => {
  const settings = { prepBufferMin: 60, transportBufferMin: 30, deliveryBufferMin: 15, returnBufferMin: 20, cleaningBufferMin: 45 };
  assert.deepEqual(resolveRentalBuffers(settings), { beforeMin: 105, afterMin: 95 });
});

test("resolveRentalBuffers: el override del producto manda por lado y sin ajustes es 0", () => {
  const settings = { prepBufferMin: 60, transportBufferMin: 30, deliveryBufferMin: 15, returnBufferMin: 20, cleaningBufferMin: 45 };
  assert.deepEqual(resolveRentalBuffers(settings, { bufferBeforeMin: 10, bufferAfterMin: null }), { beforeMin: 10, afterMin: 95 });
  assert.deepEqual(resolveRentalBuffers(settings, { bufferBeforeMin: 0, bufferAfterMin: 0 }), { beforeMin: 0, afterMin: 0 });
  assert.deepEqual(resolveRentalBuffers(null), NO_RENTAL_BUFFERS);
  assert.deepEqual(resolveRentalBuffers(undefined, { bufferAfterMin: 30 }), { beforeMin: 0, afterMin: 30 });
});

test("resolveRentalBuffers ignora valores negativos o no numéricos", () => {
  assert.deepEqual(resolveRentalBuffers({ prepBufferMin: -5, cleaningBufferMin: Number.NaN }), { beforeMin: 0, afterMin: 0 });
});

test("extendedRentalRange extiende antes y después sin mutar el rango", () => {
  const start = at(10);
  const end = at(14);
  const range = extendedRentalRange(start, end, { beforeMin: 90, afterMin: 120 });
  assert.equal(range.start?.toISOString(), "2031-01-10T08:30:00.000Z");
  assert.equal(range.end?.toISOString(), "2031-01-10T16:00:00.000Z");
  assert.equal(start.toISOString(), "2031-01-10T10:00:00.000Z");
  assert.equal(extendedRentalRange(start, end, NO_RENTAL_BUFFERS).start, start);
});

test("extendedRentalRange deja abiertas las puntas nulas y no se sale del rango válido de Date", () => {
  const open = extendedRentalRange(null, null, { beforeMin: 60, afterMin: 60 });
  assert.equal(open.start, null);
  assert.equal(open.end, null);
  const extreme = extendedRentalRange(new Date(-8.64e15), new Date(8.64e15), { beforeMin: 600, afterMin: 600 });
  assert.ok(Number.isFinite(extreme.start!.getTime()) && Number.isFinite(extreme.end!.getTime()));
});

const event = { id: "e1", name: "Evento", startsAt: null, endsAt: null, setupAt: null, strikeAt: null };
const item = { id: "i1", name: "Pantalla", quantity: 1, status: "AVAILABLE" as const, maintenance: 0 };
const row = (startsAt: Date, endsAt: Date) => ({ id: "a1", inventoryId: "i1", quantity: 1, startsAt, endsAt, event });

test("buildAvailability: el choque aparece solo cuando el colchón lo provoca", () => {
  const rows = [row(at(8), at(12))];
  // B arranca 1 h después de que A termina.
  const plain = buildAvailability(item, rows, at(13), at(18));
  assert.equal(plain.available, 1);
  const buffered = buildAvailability({ ...item, buffers: { beforeMin: 0, afterMin: 120 } }, rows, at(13), at(18));
  assert.equal(buffered.available, 0);
  assert.equal(buffered.conflicts.length, 1);
  // El detalle muestra el rango real del evento, no el extendido.
  assert.equal(buffered.conflicts[0].endsAt?.toISOString(), at(12).toISOString());
  // Con 2 h exactas de colchón y B desde las 14 sigue siendo inclusivo (como el solape actual).
  assert.equal(buildAvailability({ ...item, buffers: { beforeMin: 0, afterMin: 120 } }, rows, at(15), at(18)).available, 1);
});

test("buildAvailability: la preparación del que llega también cuenta", () => {
  const rows = [row(at(8), at(12))];
  const result = buildAvailability({ ...item, buffers: { beforeMin: 180, afterMin: 0 } }, rows, at(13), at(18));
  assert.equal(result.available, 0);
});

test("assignmentCountsAt: liberada y retención vencida no cuentan; firme y vigente sí", () => {
  const now = at(12);
  assert.equal(assignmentCountsAt({}, now), true);
  assert.equal(assignmentCountsAt({ holdExpiresAt: null, releasedAt: null }, now), true);
  assert.equal(assignmentCountsAt({ holdExpiresAt: at(13) }, now), true);
  assert.equal(assignmentCountsAt({ holdExpiresAt: at(11) }, now), false);
  assert.equal(assignmentCountsAt({ holdExpiresAt: now }, now), false, "vence justo ahora");
  assert.equal(assignmentCountsAt({ releasedAt: at(1) }, now), false);
});

test("assignmentIsActiveNow respeta liberadas y retenciones vencidas", () => {
  const now = at(12);
  const active = { startsAt: at(8), endsAt: at(18), event, checkedIn: false, checkedInAt: null };
  assert.equal(assignmentIsActiveNow(active, now), true);
  assert.equal(assignmentIsActiveNow({ ...active, holdExpiresAt: at(11) }, now), false);
  assert.equal(assignmentIsActiveNow({ ...active, releasedAt: at(9) }, now), false);
});

test("DAMAGED y LOST se descuentan como mantenimiento y tienen texto es-PY", () => {
  const source = repoFile("lib/server/inventory-availability.ts");
  assert.match(source, /UNAVAILABLE_UNIT_STATUSES = \["MAINTENANCE", "DAMAGED", "LOST"\]/);
  assert.match(source, /status: \{ in: \[\.\.\.UNAVAILABLE_UNIT_STATUSES\] \}/);
  assert.equal(inventoryStatusLabel("DAMAGED"), "Dañada");
  assert.equal(inventoryStatusLabel("LOST"), "Perdida");
  assert.match(repoFile("components/admin/modules/InventarioModule.tsx"), /\{ value: "DAMAGED", label: "Dañada" \},\s*\{ value: "LOST", label: "Perdida" \}/);
  const schema = repoFile("prisma/schema.prisma");
  assert.match(schema, /enum InventoryUnitStatus \{[^}]*DAMAGED[^}]*LOST[^}]*\}/);
});

test("parseRentalSettingsPatch valida la seña, los tiempos y el WhatsApp", () => {
  assert.deepEqual(parseRentalSettingsPatch({ depositPercent: 50, holdTtlMinutes: 2880 }), { ok: true, data: { depositPercent: 50, holdTtlMinutes: 2880 } });
  assert.deepEqual(parseRentalSettingsPatch({ depositPercent: null }), { ok: true, data: { depositPercent: null } });
  assert.deepEqual(parseRentalSettingsPatch({}), { ok: true, data: {} });
  for (const bad of [{ depositPercent: 101 }, { depositPercent: -1 }, { depositPercent: 12.5 }, { holdTtlMinutes: 0 }, { holdTtlMinutes: null }, { cleaningBufferMin: -1 }, { prepBufferMin: "x" }, { publicShowPrices: "sí" }, { whatsappPhone: "123" }]) {
    assert.equal(parseRentalSettingsPatch(bad).ok, false, JSON.stringify(bad));
  }
  const phone = parseRentalSettingsPatch({ whatsappPhone: "+595 981 123 456" });
  assert.ok(phone.ok && phone.data.whatsappPhone === "+595981123456");
});

test("sin fila, los ajustes son los de por defecto (sin política de seña, retención de 48 h)", () => {
  assert.deepEqual(toRentalSettingsView(null), RENTAL_SETTINGS_DEFAULTS);
  assert.equal(RENTAL_SETTINGS_DEFAULTS.depositPercent, null);
  assert.equal(RENTAL_SETTINGS_DEFAULTS.holdTtlMinutes, 2880);
});

test("la API de ajustes de alquiler es OWNER/ADMIN y siempre acota a la empresa de la sesión", () => {
  const route = repoFile("app/api/admin/settings/rental/route.ts");
  assert.match(route, /ownerOrAdmin\(auth\.context\.role\)/);
  assert.match(route, /requireAdminContext\("org\.manage"\)/);
  assert.match(route, /requested !== auth\.context\.organizationId\) return jsonError\("La empresa no existe\.", 404\)/);
  assert.doesNotMatch(route, /organizationId:\s*(body|record)/);
});

test("las migraciones 2b son aditivas, idempotentes y el enum va en su propio archivo", () => {
  const enumSql = repoFile("prisma/migrations/202610130002_inventory_unit_damaged_lost/migration.sql");
  const tableSql = repoFile("prisma/migrations/202610130003_rental_settings_holds/migration.sql");
  assert.match(enumSql, /ADD VALUE IF NOT EXISTS 'DAMAGED'/);
  assert.match(enumSql, /ADD VALUE IF NOT EXISTS 'LOST'/);
  assert.doesNotMatch(tableSql, /'DAMAGED'|'LOST'/, "un valor de enum nuevo no se usa en el mismo archivo");
  assert.match(tableSql, /CREATE TABLE IF NOT EXISTS "OrganizationRentalSettings"/);
  assert.match(tableSql, /ADD COLUMN IF NOT EXISTS "holdExpiresAt"/);
  assert.match(tableSql, /"organizationId" IS NULL/);
  assert.doesNotMatch(tableSql, /ADD COLUMN IF NOT EXISTS "organizationId" TEXT NOT NULL/);
});
