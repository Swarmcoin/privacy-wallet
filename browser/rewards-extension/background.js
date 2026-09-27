/**
 * SWARM Rewards, v0: the part that counts days.
 *
 * This service worker has no idea what you browse, and it is built so that it
 * could not find out. It asks for two permissions, `storage` and `alarms`.
 * There is no `tabs`, no `webNavigation`, no `history`, no host permission and
 * no content script, so there is no API here that returns a URL. What it knows
 * is that the browser was running at some point today, which is exactly what
 * an "active day" is.
 *
 * The manifest's CSP sets `connect-src 'none'`: this extension makes no
 * network request, and the browser would refuse one if a future edit tried.
 * Rewards economics (which fund pays, and the rule against one person running
 * a thousand browsers) are open owner decisions — D3 and D4 in
 * docs/SWARM-BROWSER-PLAN.md — so v0 ships the plumbing and says so.
 *
 * Nothing at all is recorded until the person opts in, and "Forget everything"
 * puts the storage back to the state it had before they did.
 */

import { changed, dayKey, emptyLedger, noteActivity, normalizeLedger } from "./lib/ledger.js";

/** Storage keys. `link` holds the address SWARM Rewards would be paid at. */
export const KEYS = { optedIn: "optedIn", ledger: "ledger", link: "link" };

/**
 * How often the worker wakes to notice that the day has turned.
 *
 * Half an hour is short enough that a browser opened at 23:50 and closed at
 * 00:10 counts both days, and long enough to cost nothing. Alarms only fire
 * while the browser is running, which is the point: the count follows use.
 */
const ALARM = "swarm.rewards.day";
const PERIOD_MINUTES = 30;

export const DEFAULTS = { [KEYS.optedIn]: false, [KEYS.ledger]: emptyLedger(), [KEYS.link]: null };

/** Reads the state, with junk and missing keys turned into the defaults. */
async function read() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return {
    optedIn: stored[KEYS.optedIn] === true,
    ledger: normalizeLedger(stored[KEYS.ledger]),
    link: stored[KEYS.link] || null,
  };
}

/** The whole recording mechanism: one day, counted once, while opted in. */
async function tick(now = new Date()) {
  const { optedIn, ledger } = await read();
  const next = noteActivity(ledger, dayKey(now), optedIn);
  if (!changed(ledger, next)) return next;
  await chrome.storage.local.set({ [KEYS.ledger]: next });
  return next;
}

function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(async () => {
  // Off by default, and it stays off until someone turns it on. Existing
  // values are left alone so an update does not reset a ledger.
  const stored = await chrome.storage.local.get({ [KEYS.optedIn]: null });
  if (stored[KEYS.optedIn] === null || stored[KEYS.optedIn] === undefined) {
    await chrome.storage.local.set(DEFAULTS);
  }
  ensureAlarm();
  await tick();
});

chrome.runtime.onStartup.addListener(async () => {
  ensureAlarm();
  await tick();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm && alarm.name === ALARM) await tick();
});

/**
 * The extension's own pages ask for a tick when they open, and after the
 * switch is turned on, so the first day counts from the moment of opting in
 * rather than from the next alarm.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "swarm.rewards.tick") return false;
  if (!sender || sender.id !== chrome.runtime.id) return false;
  ensureAlarm();
  tick().then((ledger) => sendResponse({ ok: true, ledger }));
  return true;
});
