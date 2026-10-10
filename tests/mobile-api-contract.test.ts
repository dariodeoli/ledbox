import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarRange, mobileCalendarItems, mobileDeleteSchema, mobileEventDTO, mobileLoginSchema, parseMobileBearer } from "../lib/server/mobile/contracts";

test("mobile inputs reject tenant/role injection and incomplete account confirmation", () => {
  assert.equal(mobileLoginSchema.safeParse({ email: "a@example.invalid", password: "secret", role: "OWNER" }).success, false);
  assert.equal(mobileDeleteSchema.safeParse({ password: "secret" }).success, false);
  assert.equal(parseMobileBearer("Bearer lbx_service_key"), null);
  assert.equal(parseMobileBearer("Bearer a.b.c"), "a.b.c");
});

test("event DTO drops private fields even when source contains them", () => {
  const source = { id: "a", name: "Evento", status: "DRAFT", location: null, city: null, startsAt: null, endsAt: null, setupAt: null, strikeAt: null, notes: "PRIVATE", costPrice: 123456, responsibleEmail: "private@example.invalid", organizationId: "other" };
  assert.deepEqual(Object.keys(mobileEventDTO(source)).sort(), ["id", "name", "status", "location", "city", "startsAt", "endsAt", "setupAt", "strikeAt"].sort());
  assert.equal(JSON.stringify(mobileEventDTO(source)).includes("PRIVATE"), false);
});

test("calendar includes spanning events, excludes exact end boundary and retains real bounds", () => {
  const range = calendarRange(new URLSearchParams("from=2026-10-10&to=2026-10-10"))!;
  const event = { id: "a", name: "Evento", status: "CONFIRMED", location: null, city: null, startsAt: new Date(range.start.getTime() - 86400000), endsAt: new Date(range.end.getTime() + 86400000), setupAt: new Date(range.start.getTime() - 1), strikeAt: range.end };
  const items = mobileCalendarItems(event, range);
  assert.equal(items.length, 1);
  assert.equal(items[0].date, "2026-10-10");
  assert.equal(items[0].at, event.startsAt.toISOString());
  assert.equal(items[0].endAt, event.endsAt.toISOString());
  assert.deepEqual(mobileCalendarItems({ ...event, endsAt: range.start }, range), []);
  assert.equal(calendarRange(new URLSearchParams("from=2026-02-30&to=2026-03-01")), null);
});

test("inverted event duration remains a point instead of invented interval", () => {
  const range = calendarRange(new URLSearchParams("from=2026-10-10&to=2026-10-10"))!;
  const event = { id: "a", name: "Evento", status: "DRAFT", location: null, city: null, startsAt: range.start, endsAt: new Date(range.start.getTime() - 1), setupAt: null, strikeAt: null };
  assert.equal(mobileCalendarItems(event, range)[0].endAt, null);
});
