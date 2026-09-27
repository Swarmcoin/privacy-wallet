import test from "node:test";
import assert from "node:assert";

import {
  activeDays,
  changed,
  dayKey,
  daysLabel,
  emptyLedger,
  isDayKey,
  noteActivity,
  normalizeLedger,
} from "../lib/ledger.js";

test("a fresh ledger has counted nothing", () => {
  assert.deepEqual(emptyLedger(), { days: 0, lastDay: null });
  assert.equal(activeDays(emptyLedger()), 0);
  assert.equal(daysLabel(emptyLedger()), "0 active days");
});

test("opted out, nothing is recorded", () => {
  const before = emptyLedger();
  const after = noteActivity(before, "2026-09-26", false);
  assert.deepEqual(after, { days: 0, lastDay: null });
  assert.equal(changed(before, after), false);
  // Not even the day the browser ran is kept.
  assert.equal(after.lastDay, null);
});

test("opt-in is explicit: anything that is not true is out", () => {
  for (const value of [undefined, null, 0, "", "yes", 1]) {
    assert.deepEqual(noteActivity(emptyLedger(), "2026-09-26", value), { days: 0, lastDay: null }, String(value));
  }
});

test("the first day while opted in counts once", () => {
  const after = noteActivity(emptyLedger(), "2026-09-26", true);
  assert.deepEqual(after, { days: 1, lastDay: "2026-09-26" });
  assert.equal(daysLabel(after), "1 active day");
});

test("the same day again does not count twice", () => {
  let ledger = noteActivity(emptyLedger(), "2026-09-26", true);
  for (let i = 0; i < 10; i += 1) {
    const next = noteActivity(ledger, "2026-09-26", true);
    assert.equal(changed(ledger, next), false);
    ledger = next;
  }
  assert.equal(activeDays(ledger), 1);
});

test("the day rolls over at local midnight", () => {
  const first = noteActivity(emptyLedger(), "2026-09-26", true);
  const second = noteActivity(first, "2026-09-27", true);
  assert.deepEqual(second, { days: 2, lastDay: "2026-09-27" });
  assert.equal(changed(first, second), true);
});

test("a gap of weeks is one more day, not the days in between", () => {
  const first = noteActivity(emptyLedger(), "2026-09-01", true);
  const later = noteActivity(first, "2026-09-26", true);
  assert.deepEqual(later, { days: 2, lastDay: "2026-09-26" });
});

test("opting out and back in keeps the count and skips the days between", () => {
  const day1 = noteActivity(emptyLedger(), "2026-09-26", true);
  const out1 = noteActivity(day1, "2026-09-27", false);
  const out2 = noteActivity(out1, "2026-09-28", false);
  assert.equal(activeDays(out2), 1);
  assert.equal(out2.lastDay, "2026-09-26");
  const back = noteActivity(out2, "2026-09-29", true);
  assert.deepEqual(back, { days: 2, lastDay: "2026-09-29" });
});

test("a clock that jumps backwards counts the earlier day once, then stops", () => {
  const forward = noteActivity(emptyLedger(), "2026-09-27", true);
  const back = noteActivity(forward, "2026-09-26", true);
  assert.deepEqual(back, { days: 2, lastDay: "2026-09-26" });
  assert.equal(changed(back, noteActivity(back, "2026-09-26", true)), false);
});

test("a day key that is not a day is ignored", () => {
  for (const bad of [null, undefined, "", "today", "2026-9-6", "2026-09-26T10:00:00Z", 20260926, {}]) {
    const after = noteActivity(emptyLedger(), bad, true);
    assert.deepEqual(after, { days: 0, lastDay: null }, JSON.stringify(bad));
  }
});

test("isDayKey accepts only YYYY-MM-DD", () => {
  assert.equal(isDayKey("2026-09-26"), true);
  assert.equal(isDayKey("2026-09-26 10:00"), false);
  assert.equal(isDayKey("26-09-2026"), false);
});

test("junk from storage reads as an empty ledger", () => {
  for (const junk of [null, undefined, 7, "ledger", [], { days: -3 }, { days: 1.5 }, { days: "many" }]) {
    assert.deepEqual(normalizeLedger(junk), { days: 0, lastDay: null }, JSON.stringify(junk));
  }
  assert.deepEqual(normalizeLedger({ days: 4, lastDay: "not a day" }), { days: 4, lastDay: null });
  assert.deepEqual(normalizeLedger({ days: 4, lastDay: "2026-09-26", extra: "dropped" }), {
    days: 4,
    lastDay: "2026-09-26",
  });
});

test("forgetting everything is an empty ledger again", () => {
  const used = noteActivity(noteActivity(emptyLedger(), "2026-09-26", true), "2026-09-27", true);
  assert.equal(activeDays(used), 2);
  const forgotten = emptyLedger();
  assert.equal(activeDays(forgotten), 0);
  assert.equal(changed(used, forgotten), true);
});

test("dayKey is the local calendar day, zero padded", () => {
  assert.equal(dayKey(new Date(2026, 8, 26, 23, 59, 59)), "2026-09-26");
  assert.equal(dayKey(new Date(2026, 8, 27, 0, 0, 1)), "2026-09-27");
  assert.equal(dayKey(new Date(2026, 0, 5, 12, 0, 0)), "2026-01-05");
  assert.equal(dayKey(new Date(2026, 8, 26).getTime()), "2026-09-26");
});

test("dayKey refuses an impossible date instead of guessing", () => {
  assert.equal(dayKey(new Date("not a date")), null);
  assert.equal(dayKey("also not a date"), null);
});

test("the stored shape carries no time of day", () => {
  const ledger = noteActivity(emptyLedger(), dayKey(new Date(2026, 8, 26, 14, 37, 12)), true);
  assert.deepEqual(Object.keys(ledger).sort(), ["days", "lastDay"]);
  assert.equal(/\d{2}:\d{2}/.test(JSON.stringify(ledger)), false);
});
