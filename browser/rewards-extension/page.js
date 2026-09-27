/**
 * The screen, for both the popup and the full page.
 *
 * They show the same four things — the switch, the linked address, the day
 * count and the plain truth that rewards are not live yet — so they share this
 * module and differ only in how much room they give the explanation. Elements
 * are looked up by id and may be missing: the popup leaves out what does not
 * fit.
 *
 * No network. No timers. Nothing is written to storage except in response to
 * something the person clicked.
 */

import { activeDays, daysLabel, emptyLedger, normalizeLedger } from "./lib/ledger.js";
import { readAddress, shortAddress } from "./lib/link.js";

/** The SWARM Wallet extension, pinned by the id its manifest key produces. */
const WALLET_EXTENSION_ID = "gmmgmodmgnigcgboccjelpgedejejfap";

/** The sentence the spec asks for, in one place so both pages say it exactly. */
export const NOT_LIVE = "Rewards are not live yet. When they are, this page will show your first payout.";

const KEYS = { optedIn: "optedIn", ledger: "ledger", link: "link" };
const DEFAULTS = { [KEYS.optedIn]: false, [KEYS.ledger]: emptyLedger(), [KEYS.link]: null };

const el = (id) => document.getElementById(id);

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text === null || text === undefined ? "" : String(text);
}

function show(id, visible) {
  const node = el(id);
  if (node) node.classList.toggle("hidden", !visible);
}

async function read() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return {
    optedIn: stored[KEYS.optedIn] === true,
    ledger: normalizeLedger(stored[KEYS.ledger]),
    link: stored[KEYS.link] && typeof stored[KEYS.link].address === "string" ? stored[KEYS.link] : null,
  };
}

/** Asks the service worker to notice that the browser is being used now. */
async function tick() {
  try {
    await chrome.runtime.sendMessage({ type: "swarm.rewards.tick" });
  } catch (_) {
    /* the worker will catch up on its next alarm */
  }
}

function paint(state) {
  const count = el("days");
  if (count) {
    count.textContent = String(activeDays(state.ledger));
    count.classList.toggle("off", !state.optedIn);
  }
  setText("days-label", state.optedIn ? daysLabel(state.ledger) : "nothing is being recorded");

  const optin = el("optin");
  if (optin) optin.checked = state.optedIn;
  setText(
    "optin-note",
    state.optedIn
      ? "The days you use this browser are counted on this computer. Not the sites, not the times: the days."
      : "Nothing is recorded while this is off. Not a day, not a visit, not anything.",
  );

  const linked = el("linked");
  if (linked) {
    linked.textContent = state.link ? shortAddress(state.link.address) : "no wallet linked";
    linked.title = state.link ? state.link.address : "";
    linked.classList.toggle("none", !state.link);
  }
  setText("linked-network", state.link && state.link.network ? state.link.network : "");

  const link = el("link");
  if (link) {
    link.disabled = !state.optedIn;
    link.textContent = state.link ? "Link a different wallet" : "Link your SWARM wallet";
  }

  const forget = el("forget");
  if (forget) forget.disabled = activeDays(state.ledger) === 0 && !state.link && !state.optedIn;

  const claim = el("claim");
  if (claim) {
    claim.disabled = true; // until the owner's D3 and D4 are answered, there is nothing to claim
    claim.title = NOT_LIVE;
  }
}

function say(message, kind) {
  const node = el("message");
  if (!node) return;
  node.textContent = message || "";
  node.className = message ? (kind === "ok" ? "ok" : "error") : "hidden";
}

/* ── the three things a person can do ───────────────────────────────────── */

async function toggleOptIn(event) {
  const optedIn = event.target.checked === true;
  await chrome.storage.local.set({ [KEYS.optedIn]: optedIn });
  say("");
  if (optedIn) await tick(); // today counts from now, not from the next half hour
  paint(await read());
}

async function linkWallet() {
  const button = el("link");
  if (button) button.disabled = true;
  say("");
  let answer = null;
  try {
    answer = await chrome.runtime.sendMessage(WALLET_EXTENSION_ID, { type: "swarm.rewards.address" });
  } catch (e) {
    answer = null;
  }
  if (answer === null || answer === undefined) {
    say("The SWARM Wallet extension did not answer. Is it installed and enabled?");
    paint(await read());
    return;
  }
  const read_ = readAddress(answer);
  if (!read_.ok) {
    say(read_.message);
    paint(await read());
    return;
  }
  await chrome.storage.local.set({ [KEYS.link]: { address: read_.address, network: read_.network } });
  say("Linked. SWARM Rewards knows your receive address and nothing else about your wallet.", "ok");
  paint(await read());
}

async function forgetEverything() {
  await chrome.storage.local.set({
    [KEYS.optedIn]: false,
    [KEYS.ledger]: emptyLedger(),
    [KEYS.link]: null,
  });
  say("Forgotten. The day count is back to zero, no wallet is linked, and nothing is being recorded.", "ok");
  paint(await read());
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

export async function start() {
  setText("not-live", NOT_LIVE);
  setText("claim-note", NOT_LIVE);

  if (el("optin")) el("optin").addEventListener("change", toggleOptIn);
  if (el("link")) el("link").addEventListener("click", linkWallet);
  if (el("forget")) el("forget").addEventListener("click", forgetEverything);
  if (el("open-page")) {
    el("open-page").addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("rewards.html") });
      window.close();
    });
  }

  const state = await read();
  paint(state);
  if (state.optedIn) await tick();
  if (state.optedIn) paint(await read());

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area === "local") paint(await read());
  });
}

start();
