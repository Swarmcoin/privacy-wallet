/**
 * Settings: what this wallet is connected to, and what it can do.
 *
 * The network switch is behind a typed word rather than a control. Moving a
 * wallet to another chain is not a preference, it is a different wallet, and a
 * switch that can be hit by accident will be hit by accident.
 */

import { command, el, show, setText, setError, paintNetwork } from "./common.js";

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

load();
