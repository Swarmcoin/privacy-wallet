/**
 * Settings: what this wallet is connected to, and what it can do.
 *
 * The network switch is behind a typed word rather than a control. Moving a
 * wallet to another chain is not a preference, it is a different wallet, and a
 * switch that can be hit by accident will be hit by accident.
 */

import { command, el, show, setText, setError, paintNetwork } from "./common.js";
import { SHOW_PRICE_KEY, LAST_PRICE_KEY } from "./lib/price.js";

async function load() {
  const answer = await command("status");
  if (!answer.ok) {
    setError("advanced-error", answer.error);
    return;
  }
  const s = answer.result;
  paintNetwork(el("network"), s.network);
  setText("net-name", s.network.displayName + (s.network.coinsAreTestCoins ? " (test coins)" : ""));
  setText("net-server", s.network.server);
  setText("net-height", s.serverHeight === null ? "unreachable" : String(s.serverHeight));
  setText("net-wallet-height", s.walletHeight === null ? (s.unlocked ? "not synced" : "locked") : String(s.walletHeight));
  setText("host-version", s.core === "loaded" ? `${s.hostVersion} on Node ${s.node}` : "not running");
  setText("core-state", s.core === "loaded" ? "loaded" : s.coreError || "missing");
  setText(
    "device-auth",
    s.deviceAuth === "available" ? "Windows Hello available" : `not available (${s.deviceAuth})`,
  );
  setText("wallet-dir", s.walletDir);
  setText("ext-id", chrome.runtime.id);
}

el("advanced-word").addEventListener("input", (e) => {
  show(el("advanced-switch"), e.target.value.trim().toLowerCase() === "testnet");
});

async function switchTo(network) {
  setError("advanced-error", null);
  show(el("advanced-ok"), false);
  const answer = await command("settings.network", { network });
  if (!answer.ok) {
    setError("advanced-error", answer.error);
    return;
  }
  setText("advanced-ok", `Now pointed at ${answer.result.network.displayName}. Reopen the popup.`);
  show(el("advanced-ok"), true);
  await load();
}

el("to-mainnet").addEventListener("click", () => switchTo("swarm-mainnet"));
el("to-testnet").addEventListener("click", () => switchTo("swarm-testnet"));

/* ── SWARM Rewards ──────────────────────────────────────────────────────── */

const CONSENT_KEY = "rewardsAddressConsent";
const CONSENT_PENDING_KEY = "rewardsConsentPending";

async function loadRewards() {
  const stored = await chrome.storage.local.get({ [CONSENT_KEY]: null });
  const value = stored[CONSENT_KEY];
  setText("rewards-consent", value === "granted" ? "shared" : value === "refused" ? "refused" : "not shared");
  el("rewards-revoke").disabled = value !== "granted";
}

el("rewards-revoke").addEventListener("click", async () => {
  // Back to never-asked: SWARM Rewards may ask again, and the popup will put
  // the question to you again rather than answering on your behalf.
  await chrome.storage.local.set({ [CONSENT_KEY]: null, [CONSENT_PENDING_KEY]: false });
  setText("rewards-ok", "SWARM Rewards no longer has your address. It will have to ask you again.");
  show(el("rewards-ok"), true);
  await loadRewards();
});

/* ── SWM price ──────────────────────────────────────────────────────────── */

async function loadPriceSetting() {
  const box = el("show-price");
  box.setAttribute("aria-describedby", "show-price-help");
  try {
    const stored = await chrome.storage.local.get({ [SHOW_PRICE_KEY]: true });
    box.checked = stored[SHOW_PRICE_KEY] !== false;
    box.disabled = false;
  } catch (_) {
    box.checked = false;
  }
}

el("show-price").addEventListener("change", async (e) => {
  const on = e.target.checked;
  // Off also forgets the last price, so nothing about it is kept either.
  await chrome.storage.local.set({ [SHOW_PRICE_KEY]: on });
  if (!on) await chrome.storage.local.remove(LAST_PRICE_KEY);
});

load();
loadRewards();
loadPriceSetting();
