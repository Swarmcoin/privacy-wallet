/**
 * The whole memory of SWARM Rewards: how many days the browser was used.
 *
 * Not a log. There is no list of days, no first-seen date, no URLs, no
 * domains, no clock times — only a count and the day it was last raised, which
 * is the least that can still tell "today has been counted" from "today has
 * not". A day is the local calendar day, because the person lives in one.
 *
 * Every function here is pure, so the counting rules can be tested with
 * node:test outside a browser, and so the service worker holds no logic of its
 * own worth auditing separately.
 */

/** The shape stored under `ledger`. */
export function emptyLedger() {
  return { days: 0, lastDay: null };
}

/** The local calendar day of `date`, as `YYYY-MM-DD`. */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDayKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Whatever storage gave back, made safe to use. Junk becomes an empty ledger. */
export function normalizeLedger(value) {
  if (!value || typeof value !== "object") return emptyLedger();
  const days = Number(value.days);
  return {
    days: Number.isInteger(days) && days > 0 ? days : 0,
    lastDay: isDayKey(value.lastDay) ? value.lastDay : null,
  };
}

/**
 * The one rule: while opted in, the first sign of life on a new local day
 * raises the count by one.
 *
 * Opted out, nothing is recorded — not the day, not the fact that the browser
 * ran. Always returns a normalized ledger; use `changed()` to decide whether
 * it is worth a write.
 *
 * @param {{days:number,lastDay:?string}} ledger
 * @param {string} today  a `YYYY-MM-DD` key
 * @param {boolean} optedIn
 */
export function noteActivity(ledger, today, optedIn) {
  const current = normalizeLedger(ledger);
  if (optedIn !== true) return current;
  if (!isDayKey(today)) return current;
  if (current.lastDay === today) return current;
  return { days: current.days + 1, lastDay: today };
}

/** Whether two ledgers differ, i.e. whether storage needs writing. */
export function changed(before, after) {
  const a = normalizeLedger(before);
  const b = normalizeLedger(after);
  return a.days !== b.days || a.lastDay !== b.lastDay;
}

/** The number to show. */
export function activeDays(ledger) {
  return normalizeLedger(ledger).days;
}

/** How the count reads in a sentence, without inventing a unit. */
export function daysLabel(ledger) {
  const n = activeDays(ledger);
  return n === 1 ? "1 active day" : `${n} active days`;
}
