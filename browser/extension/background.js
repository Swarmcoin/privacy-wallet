/**
 * The one place the extension talks to the wallet host.
 *
 * Every screen — popup, side panel, onboarding, settings — sends a message to
 * this service worker and gets an answer. None of them holds the native port,
 * for two reasons: a popup is destroyed the moment it loses focus, which would
 * close the port and kill the host mid-payment; and one port means one wallet
 * session, so the side panel and the popup cannot end up unlocked separately.
 *
 * This file makes NO network requests, and the manifest's CSP sets
 * `connect-src 'none'` so it could not if it tried. Everything that reaches
 * SWARM mainnet goes through the host.
 */
import { isOwnPage } from "./lib/sender.js";
import { REWARDS_EXTENSION_ID, addressAnswer, mayAnswerRewards } from "./lib/rewards.js";

const HOST_NAME = "green.swarm.wallet_host";

/** "granted" once the person has said yes in the popup; "refused" if they said no. */
const CONSENT_KEY = "rewardsAddressConsent";
/** True while SWARM Rewards is waiting for that answer, so the popup knows to ask. */
const CONSENT_PENDING_KEY = "rewardsConsentPending";

/** The live port, or null. Recreated on demand. */
let port = null;
/** id -> resolve, for the requests waiting on an answer. */
const pending = new Map();
let nextId = 1;

/** The last thing that went wrong with the connection, for the popup to show. */
let lastConnectionError = null;

function connect() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    lastConnectionError = String((e && e.message) || e);
    port = null;
    return null;
  }
  port.onMessage.addListener((answer) => {
    const resolve = pending.get(answer && answer.id);
    if (resolve) {
      pending.delete(answer.id);
      resolve(answer);
    }
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    lastConnectionError = error ? error.message : null;
    port = null;
    // Everything still waiting is answered, not abandoned: a screen that keeps
    // spinning after the host died is the worst failure mode here.
    for (const [id, resolve] of pending) {
      resolve({
        id,
        ok: false,
        error: {
          code: "host_unavailable",
          message: lastConnectionError || "The SWARM wallet host stopped. Run the installer, then try again.",
        },
      });
    }
    pending.clear();
    broadcast({ type: "swarm.locked", reason: "host_disconnected" });
  });
  lastConnectionError = null;
  return port;
}

/** Asks the host one thing. Never rejects: failures come back as `ok: false`. */
function ask(command, params) {
  const live = connect();
  if (!live) {
    return Promise.resolve({
      ok: false,
      error: {
        code: "host_missing",
        message:
          lastConnectionError ||
          "The SWARM wallet host is not registered with this browser. Run 'Install SWARM Browser Wallet (dev).cmd'.",
      },
    });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        resolve({ ok: false, error: { code: "timeout", message: `${command} did not answer in time.` } });
      }
    }, 180000);
    try {
      live.postMessage({ id, command, params: params || {} });
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      port = null;
      resolve({ ok: false, error: { code: "host_unavailable", message: String((e && e.message) || e) } });
    }
  });
}

/** Tells every open screen something changed. Failures are expected and ignored. */
function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (_) {
    /* no screen is open */
  }
}

/**
 * The command allow-list on this side of the port.
 *
 * The host has its own, and this is not a substitute for it. It is here so
 * that a bug in a screen cannot invent a command name, and so the list of what
 * the browser can ask for is readable in one place.
 */
const ALLOWED = new Set([
  "status",
  "wallet.exists",
  "wallet.create",
  "wallet.restore",
  "wallet.unlock",
  "wallet.lock",
  "balance",
  "addresses",
  "history",
  "send",
  "sync.start",
  "sync.status",
  "settings.network",
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "swarm.command") return false;
  // Only this extension's own pages. Onboarding and settings open in tabs,
  // so the test is the sender's origin, not whether it has a tab; a content
  // script (web origin) or another extension (other id) is dropped.
  if (!isOwnPage(sender, chrome.runtime.id)) {
    sendResponse({ ok: false, error: { code: "refused", message: "Only the SWARM Wallet screens may ask." } });
    return false;
  }
  if (!ALLOWED.has(message.command)) {
    sendResponse({ ok: false, error: { code: "unknown_command", message: `'${message.command}' is not a command.` } });
    return false;
  }
  ask(message.command, message.params).then((answer) => {
    if (message.command === "wallet.lock" && answer.ok) broadcast({ type: "swarm.locked", reason: "user" });
    if (message.command === "wallet.unlock" && answer.ok) broadcast({ type: "swarm.unlocked" });
    sendResponse(answer);
  });
  return true; // the answer comes later
});

/* ── the one door to SWARM Rewards ──────────────────────────────────────── */

/**
 * SWARM Rewards may learn one thing: the address it would pay.
 *
 * Four locks, in this order. The manifest's `externally_connectable` lets only
 * the Rewards id reach this listener at all. `mayAnswerRewards` checks the id
 * and the question again here, because a manifest is a setting and this is
 * code. The person must have said yes once in the popup. And the wallet must
 * be unlocked, so an address is never produced behind a locked door.
 *
 * What crosses: `swm1…` and the network's name. What never crosses: the
 * recovery phrase, any viewing or spending key, the balance, the history, the
 * transparent address, the wallet folder. The answer is built in
 * `addressAnswer` from two strings rather than forwarded, so it cannot grow.
 */
async function answerRewardsAddress() {
  const stored = await chrome.storage.local.get({ [CONSENT_KEY]: null });
  if (stored[CONSENT_KEY] !== "granted") {
    // Remember that someone is waiting, so the popup asks the question the
    // next time it is opened. This is the only thing an unapproved request
    // can change, and it changes nothing about the wallet.
    await chrome.storage.local.set({ [CONSENT_PENDING_KEY]: true });
    broadcast({ type: "swarm.rewards.consent-pending" });
    return {
      ok: false,
      error: {
        code: "consent_required",
        message: "Open the SWARM Wallet popup. It will ask whether to share your receive address with SWARM Rewards.",
      },
    };
  }

  const status = await ask("status");
  if (!status.ok) return { ok: false, error: status.error };
  if (!status.result.unlocked) {
    return {
      ok: false,
      error: { code: "locked", message: "Unlock the SWARM Wallet first, then link again in SWARM Rewards." },
    };
  }

  const addresses = await ask("addresses");
  if (!addresses.ok) return { ok: false, error: addresses.error };
  const unified = addresses.result && addresses.result.unified;
  if (!unified) {
    return { ok: false, error: { code: "no_address", message: "This wallet has no receive address yet." } };
  }
  return addressAnswer(unified, status.result.network && status.result.network.id);
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!mayAnswerRewards(sender, message, REWARDS_EXTENSION_ID)) {
    sendResponse({
      ok: false,
      error: { code: "refused", message: "This wallet answers only SWARM Rewards, and only about its receive address." },
    });
    return false;
  }
  answerRewardsAddress().then(sendResponse);
  return true; // the answer comes later
});

// Clicking the toolbar icon opens the popup (manifest `action`); the side panel
// is opened from the popup's History button.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});
