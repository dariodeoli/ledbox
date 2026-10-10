import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, eventsForDay, monthRange, shiftMonth } from "../src/calendar";
import type { MobileEvent } from "../src/api/contract";

test("month boundaries and leap day use explicit calendar arithmetic", () => {
  assert.equal(monthRange("2028-02").count, 29);
  assert.equal(monthRange("2026-02").count, 28);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.throws(() => monthRange("2026-13"));
});
test("Asunción day anchoring and exclusive midnight end avoid a phantom extra day", () => {
  assert.equal(dayKey(new Date("2026-10-02T01:00:00Z")), "2026-10-01");
  const event: MobileEvent = { id: "one", eventId: "one", kind: "event", name: "Evento", statusLabel: "Confirmado", clientName: null, location: null, startsAt: "2026-10-01T12:00:00Z", endsAt: "2026-10-03T03:00:00Z" };
  assert.equal(eventsForDay([event], "2026-10-01").length, 1);
  assert.equal(eventsForDay([event], "2026-10-02").length, 1);
  assert.equal(eventsForDay([event], "2026-10-03").length, 0);
});
