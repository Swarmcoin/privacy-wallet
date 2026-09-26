/**
 * The popup: balance, receive, send, lock.
 *
 * Balances are masked until the person asks to see them, because a popup opens
 * over whatever page is on screen and often in front of whoever is standing
 * behind it. The reveal is per opening and is never remembered.
 */

import { command, el, show, setText, setError, copyToClipboard, formatAmount, maskAmount, paintNetwork } from "./common.js";
import { encode, draw } from "./lib/qr.js";

const VIEWS = ["nohost", "setup", "locked", "wallet", "receive", "send", "confirm", "sent"];

let state = {
  revealed: false,
  ticker: "SWM",
  network: null,
  addresses: null,
  showingTransparent: false,
  pendingSend: null,
};

function view(name) {
  for (const v of VIEWS) show(el(`view-${v}`), v === name);
}

function syncIndicator(kind, text) {
  const dot = el("sync-dot");
  dot.className = `dot ${kind}`;
  setText("sync-text", text);
}

/* ── loading ────────────────────────────────────────────────────────────── */

async function refresh() {
  const answer = await command("status");
  if (!answer.ok) {
    setError("nohost-detail", answer.error);
    view("nohost");
    syncIndicator("error", "No wallet host");
    return;
  }
  const status = answer.result;
  state.network = status.network;
  state.ticker = status.network.ticker;
  paintNetwork(el("network"), status.network);

  if (status.core !== "loaded") {
    setError("nohost-detail", { message: status.coreError || "The wallet core is missing." });
    view("nohost");
    syncIndicator("error", "Wallet core missing");
    return;
  }

  if (!status.walletExists) {
    view("setup");
    syncIndicator("", status.serverHeight ? `Network at block ${status.serverHeight}` : "Network unreachable");
    return;
  }

  if (!status.unlocked) {
    view("locked");
    setText(
      "locked-note",
      status.deviceAuth === "available"
        ? "Windows Hello protects this wallet."
        : "Windows Hello is not set up on this computer, so unlocking will not ask you for anything. Lock the wallet when you walk away.",
    );
    syncIndicator("", status.serverHeight ? `Network at block ${status.serverHeight}` : "Network unreachable");
    return;
  }

  view("wallet");
  await paintWallet(status);
}

async function paintWallet(status) {
  const [balance, addresses] = await Promise.all([command("balance"), command("addresses")]);
  if (balance.ok) paintBalance(balance.result);
  if (addresses.ok) state.addresses = addresses.result;

  const sync = await command("sync.status");
  if (sync.ok) {
    const s = sync.result;
    if (s.inProgress) {
      syncIndicator("syncing", `Syncing… ${s.percentage === null ? "" : `${Math.floor(s.percentage)}%`}`.trim());
    } else if (s.walletHeight) {
      const behind = status.serverHeight && status.serverHeight > s.walletHeight;
      syncIndicator(behind ? "syncing" : "synced", `Block ${s.walletHeight}${behind ? ` of ${status.serverHeight}` : ""}`);
    } else {
      syncIndicator("", "Not synced yet");
    }
  } else {
    syncIndicator("error", "Sync unavailable");
  }
}

function paintBalance(b) {
  state.ticker = b.ticker || "SWM";
  const node = el("balance");
  node.classList.toggle("masked", !state.revealed);
  node.textContent = state.revealed ? formatAmount(b.shielded, b.ticker) : maskAmount(b.shielded, b.ticker);
  el("reveal").textContent = state.revealed ? "Hide" : "Show";
  const parts = [];
  if (b.transparent > 0) {
    parts.push(state.revealed ? `${formatAmount(b.transparent, "")} transparent` : `${maskAmount(b.transparent, "")} transparent`);
  }
  if (b.pending > 0) {
    parts.push(state.revealed ? `${formatAmount(b.pending, "")} pending` : `${maskAmount(b.pending, "")} pending`);
  }
  setText("balance-sub", parts.join(" · "));
}

/* ── receive ────────────────────────────────────────────────────────────── */

function paintReceive() {
  const a = state.addresses;
  if (!a) return;
  const address = state.showingTransparent ? a.transparent : a.unified;
  setText("receive-address", address || "No address yet");
  setText(
    "receive-kind",
    state.showingTransparent
      ? "A transparent address. Payments to it are visible on the chain."
      : "A unified address. Payments to it are shielded.",
  );
  el("receive-transparent").textContent = state.showingTransparent ? "Shielded" : "Transparent";
  const canvas = el("receive-qr");
  if (address) {
    try {
      draw(canvas, encode(address), { scale: 3, dark: "#0a0908", light: "#ffffff" });
      show(canvas, true);
    } catch (_) {
      show(canvas, false);
    }
  } else {
    show(canvas, false);
  }
}

/* ── send ───────────────────────────────────────────────────────────────── */

function review() {
  setError("send-error", null);
  const to = el("send-to").value.trim();
  const amount = Number(el("send-amount").value.trim());
  const memo = el("send-memo").value;
  if (!to) return setError("send-error", { message: "Enter the address to pay." });
  if (!Number.isFinite(amount) || amount <= 0) return setError("send-error", { message: "Enter an amount greater than zero." });
  state.pendingSend = { to, amount, memo };
  setText("confirm-amount", formatAmount(amount, state.ticker));
  setText("confirm-to", to);
  setText("confirm-memo", memo || "");
  show(el("confirm-memo-row"), !!memo);
  setError("confirm-error", null);
  view("confirm");
  return undefined;
}

async function doSend() {
  const button = el("confirm-send");
  button.disabled = true;
  button.textContent = "Waiting for Windows Hello…";
  const answer = await command("send", state.pendingSend);
  button.disabled = false;
  button.textContent = "Send";
  if (!answer.ok) {
    setError("confirm-error", answer.error);
    return;
  }
  setText("sent-txid", answer.result.txid);
  el("send-to").value = "";
  el("send-amount").value = "";
  el("send-memo").value = "";
  state.pendingSend = null;
  view("sent");
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

el("nohost-retry").addEventListener("click", refresh);

el("setup-create").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html#create") });
  window.close();
});
el("setup-restore").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html#restore") });
  window.close();
});

el("locked-unlock").addEventListener("click", async () => {
  const button = el("locked-unlock");
  button.disabled = true;
  button.textContent = "Waiting for Windows Hello…";
  setError("locked-error", null);
  const answer = await command("wallet.unlock");
  button.disabled = false;
  button.textContent = "Unlock with Windows Hello";
  if (!answer.ok) {
    setError("locked-error", answer.error);
    return;
  }
  await command("sync.start");
  await refresh();
});

el("reveal").addEventListener("click", async () => {
  state.revealed = !state.revealed;
  const balance = await command("balance");
  if (balance.ok) paintBalance(balance.result);
});

el("lock").addEventListener("click", async () => {
  state.revealed = false;
  await command("wallet.lock");
  await refresh();
});

el("go-receive").addEventListener("click", () => {
  state.showingTransparent = false;
  paintReceive();
  view("receive");
});
el("receive-back").addEventListener("click", () => view("wallet"));
el("receive-copy").addEventListener("click", (e) => {
  const a = state.addresses;
  copyToClipboard(state.showingTransparent ? a.transparent : a.unified, e.target);
});
el("receive-transparent").addEventListener("click", () => {
  state.showingTransparent = !state.showingTransparent;
  paintReceive();
});

el("go-send").addEventListener("click", () => {
  setError("send-error", null);
  view("send");
});
el("send-back").addEventListener("click", () => view("wallet"));
el("send-review").addEventListener("click", review);
el("confirm-cancel").addEventListener("click", () => view("send"));
el("confirm-send").addEventListener("click", doSend);
el("sent-copy").addEventListener("click", (e) => copyToClipboard(el("sent-txid").textContent, e.target));
el("sent-done").addEventListener("click", async () => {
  view("wallet");
  await refresh();
});

el("go-history").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  } catch (_) {
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
  }
});

el("go-settings").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  window.close();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "swarm.locked") refresh();
});

refresh();
