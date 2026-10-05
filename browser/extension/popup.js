/**
 * The popup: balance, receive, send, lock.
 *
 * Balances are masked until the person asks to see them, because a popup opens
 * over whatever page is on screen and often in front of whoever is standing
 * behind it. The reveal is per opening and is never remembered.
 *
 * The SWM price is the one thing this popup fetches itself, not through the
 * host: one GET a minute to the SWARM price relay while a wallet screen is
 * open, on SWARM Mainnet, with the setting on (lib/price.js). The value of a
 * hidden balance stays hidden; the price itself is not a secret.
 */

import {
  command,
  el,
  show,
  setText,
  setError,
  copyToClipboard,
  formatAmount,
  maskAmount,
  paintNetwork,
  openExplorer,
} from "./common.js";
import { encode, draw } from "./lib/qr.js";
import {
  DEXSCREENER_URL,
  FRESHNESS,
  LAST_PRICE_KEY,
  MASKED_FIAT,
  MIN_REFETCH_MS,
  POLL_MS,
  PRICE_NOTE,
  SHOW_PRICE_KEY,
  classify,
  clockTime,
  fetchPrice,
  formatChange,
  formatFiat,
  formatUsdPrice,
  fromStored,
  metaLine,
  sparklinePaths,
  toStored,
} from "./lib/price.js";

/**
 * Shown on the locked screen while a wallet made before the restart waits to
 * be moved. The same sentence the host returns after the move, and the
 * desktop wallet's (0.1.0-mainnet.10).
 */
const RESTART_NOTICE =
  "The SWARM network was restarted on 2 October 2026. Your addresses and recovery phrase are unchanged; balances start again from the new chain.";

const VIEWS = ["nohost", "share", "setup", "locked", "wallet", "receive", "send", "confirm", "sent"];

/** Storage keys shared with the service worker's one door to SWARM Rewards. */
const CONSENT_KEY = "rewardsAddressConsent";
const CONSENT_PENDING_KEY = "rewardsConsentPending";

let state = {
  revealed: false,
  ticker: "SWM",
  network: null,
  addresses: null,
  showingTransparent: false,
  pendingSend: null,
  /** The host's one sentence about the network restart, once the wallet was moved. */
  restartNotice: null,
  sentExplorerUrl: null,
};

/** The network-restart sentence, where the host says there is one to show. */
function paintRestart(id, text) {
  setText(id, text || "");
  show(el(id), !!text);
}

function view(name) {
  for (const v of VIEWS) show(el(`view-${v}`), v === name);
  // The price is asked for only while a wallet screen is open: never while
  // locked, and never on the screens before a wallet exists.
  if (PRICE_VIEWS.includes(name)) startPrice();
  else stopPrice();
}

function syncIndicator(kind, text) {
  const dot = el("sync-dot");
  dot.className = `dot ${kind}`;
  setText("sync-text", text);
}

/* ── loading ────────────────────────────────────────────────────────────── */

/**
 * Has SWARM Rewards asked for the address and not been answered?
 *
 * Asked before the host is contacted, so the question can be answered even
 * when the host is down, and so it is the first thing the person sees rather
 * than something buried under a balance.
 */
async function pendingRewardsQuestion() {
  try {
    const stored = await chrome.storage.local.get({ [CONSENT_KEY]: null, [CONSENT_PENDING_KEY]: false });
    return stored[CONSENT_PENDING_KEY] === true && stored[CONSENT_KEY] !== "granted";
  } catch (_) {
    return false;
  }
}

async function answerRewardsQuestion(granted) {
  await chrome.storage.local.set({
    [CONSENT_KEY]: granted ? "granted" : "refused",
    [CONSENT_PENDING_KEY]: false,
  });
  await refresh();
}

async function refresh() {
  if (await pendingRewardsQuestion()) {
    view("share");
    syncIndicator("", "SWARM Rewards is waiting for an answer");
    return;
  }
  const answer = await command("status");
  if (!answer.ok) {
    setError("nohost-detail", answer.error);
    view("nohost");
    syncIndicator("error", "No wallet host");
    return;
  }
  const status = answer.result;
  state.network = status.network;
  price.mainnet = isMainnet(status.network);
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

  if (status.chainRestartNotice) state.restartNotice = status.chainRestartNotice;

  if (!status.unlocked) {
    view("locked");
    // A wallet made before the restart is moved at this unlock. The host
    // words the sentence; the popup only shows it.
    paintRestart("locked-restart", status.chainRestartPending ? RESTART_NOTICE : null);
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
  paintRestart("wallet-restart", state.restartNotice);
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
  price.balance = typeof b.shielded === "number" ? b.shielded : null;
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
  paintBalanceFiat();
}

/* ── SWM price ──────────────────────────────────────────────────────────── */

/** Screens on which the price is shown and kept fresh. */
const PRICE_VIEWS = ["wallet", "receive", "send", "confirm", "sent"];
/** How often "updated 12 s ago" is repainted. The request itself is once a minute. */
const PRICE_REPAINT_MS = 5000;
/** The sparkline's viewBox: the card's inner width at the popup's 360 px. */
const SVG_W = 298;
const SVG_H = 44;

const price = {
  /** The setting. False until it has been read, so nothing is fetched before it is known. */
  enabled: false,
  /** Only SWARM Mainnet has a price; test coins have none. */
  mainnet: false,
  /** The last good reading: the remembered one at first, then live ones. */
  reading: null,
  /** True once a reading arrived during this opening; until then the remembered one is greyed. */
  live: false,
  /** True once one request finished this opening, so "…" can become "Price unavailable". */
  attempted: false,
  inFlight: false,
  lastAttempt: 0,
  pollTimer: null,
  repaintTimer: null,
  /** The shielded balance as the host sent it (SWM, a float), for the fiat line. */
  balance: null,
};

function isMainnet(network) {
  return !!network && network.id === "swarm-mainnet" && network.coinsAreTestCoins === false;
}

function priceActive() {
  return price.enabled && price.mainnet;
}

/** Reads the setting and the last reading. If the setting cannot be read, nothing is fetched. */
async function loadPriceSetting() {
  try {
    const stored = await chrome.storage.local.get({ [SHOW_PRICE_KEY]: true, [LAST_PRICE_KEY]: null });
    price.enabled = stored[SHOW_PRICE_KEY] !== false;
    price.reading = price.enabled ? fromStored(stored[LAST_PRICE_KEY]) : null;
  } catch (_) {
    price.enabled = false;
  }
}

function startPrice() {
  if (!priceActive()) {
    stopPrice();
    paintPrice();
    return;
  }
  const now = Date.now();
  // A reading this recent was confirmed by an opening a moment ago; do not ask again yet.
  const recent = !!price.reading && now - price.reading.fetchedAt < MIN_REFETCH_MS;
  if (recent) price.live = true;
  paintPrice();
  if (!price.pollTimer) price.pollTimer = setInterval(pollPrice, POLL_MS);
  if (!price.repaintTimer) price.repaintTimer = setInterval(paintPrice, PRICE_REPAINT_MS);
  if (!recent && now - price.lastAttempt >= MIN_REFETCH_MS) pollPrice();
}

function stopPrice() {
  clearInterval(price.pollTimer);
  clearInterval(price.repaintTimer);
  price.pollTimer = null;
  price.repaintTimer = null;
}

async function pollPrice() {
  if (!priceActive() || price.inFlight) return;
  price.inFlight = true;
  price.lastAttempt = Date.now();
  const answer = await fetchPrice();
  price.inFlight = false;
  price.attempted = true;
  // A refused or failed answer keeps the last good reading (spec §2.2).
  if (answer.ok && priceActive()) {
    price.reading = answer.reading;
    price.live = true;
    try {
      await chrome.storage.local.set({ [LAST_PRICE_KEY]: toStored(answer.reading) });
    } catch (_) {
      /* still shown; only not remembered */
    }
  }
  paintPrice();
}

function paintPrice() {
  const card = el("price-card");
  if (!priceActive()) {
    show(card, false);
    paintBalanceFiat();
    paintSendFiat();
    return;
  }
  const now = Date.now();
  const r = price.reading;
  const freshness = classify(r, now);
  const usable = !!r && freshness !== FRESHNESS.UNAVAILABLE;
  // A remembered reading is greyed until this opening has confirmed it.
  const greyed = !usable || freshness === FRESHNESS.STALE || !price.live;

  show(card, true);
  card.classList.toggle("greyed", greyed);
  let dotKind = "";
  if (usable && freshness === FRESHNESS.FRESH && price.live) dotKind = "fresh";
  else if (usable && freshness === FRESHNESS.AGEING) dotKind = "ageing";
  el("price-dot").className = dotKind ? `dot ${dotKind}` : "dot";

  const value = el("price-value");
  const chip = el("price-chip");
  if (usable) {
    value.textContent = formatUsdPrice(r.price_usd);
    value.classList.remove("none");
    show(el("price-unit"), true);
    const change = formatChange(r.change_pct_h24);
    show(chip, !!change);
    if (change) {
      chip.textContent = change.text;
      chip.className = `price-chip ${change.direction}`;
    }
    paintSparkline(r.sparkline_usd);
    setText("price-meta", keepTogether(metaLine(r, now)));
  } else {
    const waiting = !price.attempted && !r;
    value.textContent = waiting ? "…" : "Price unavailable";
    value.classList.toggle("none", !waiting);
    show(el("price-unit"), waiting);
    show(chip, false);
    paintSparkline(null);
    setText("price-meta", keepTogether(r ? `Base · Uniswap v4 · last reading ${clockTime(r.fetchedAt)}` : "Base · Uniswap v4"));
  }
  paintBalanceFiat();
  paintSendFiat();
}

/** The meta line wraps only between its parts, never inside "updated 12 s ago". */
function keepTogether(line) {
  return line
    .split(" · ")
    .map((part) => part.replace(/ /g, "\u00a0"))
    .join(" · ");
}

function paintSparkline(values) {
  const paths = values ? sparklinePaths(values, SVG_W, SVG_H) : null;
  show(el("price-spark"), !!paths);
  el("price-spark-line").setAttribute("d", paths ? paths.line : "");
  el("price-spark-area").setAttribute("d", paths ? paths.area : "");
}

/** The price to multiply by, or null when there is none worth showing. */
function usablePrice() {
  if (!priceActive() || !price.reading) return null;
  const freshness = classify(price.reading, Date.now());
  if (freshness === FRESHNESS.UNAVAILABLE) return null;
  return { text: price.reading.price_usd, dim: freshness !== FRESHNESS.FRESH || !price.live };
}

/** "≈ $… USD" under the balance, hidden with it. */
function paintBalanceFiat() {
  const node = el("balance-fiat");
  const p = usablePrice();
  const text = p && price.balance !== null ? formatFiat(price.balance, p.text) : null;
  show(node, !!text);
  if (!text) return;
  node.textContent = state.revealed ? text : MASKED_FIAT;
  node.classList.toggle("dim", p.dim);
}

/** The fiat value of a typed amount, or null. */
function fiatForAmount(raw) {
  const p = usablePrice();
  const typed = String(raw === undefined || raw === null ? "" : raw).trim();
  const amount = Number(typed);
  if (!p || !typed || !Number.isFinite(amount) || amount <= 0) return null;
  const text = formatFiat(amount, p.text);
  return text ? { text, dim: p.dim } : null;
}

function paintFiatHint(id, fiat) {
  const node = el(id);
  show(node, !!fiat);
  if (!fiat) return;
  node.textContent = fiat.text;
  node.classList.toggle("dim", fiat.dim);
}

/** The line under the amount being typed, and the one on the confirmation screen. */
function paintSendFiat() {
  paintFiatHint("send-fiat", fiatForAmount(el("send-amount").value));
  paintFiatHint("confirm-fiat", state.pendingSend ? fiatForAmount(state.pendingSend.amount) : null);
}

function openListing() {
  // A fixed URL (lib/price.js), never one from the relay.
  const url = DEXSCREENER_URL;
  chrome.tabs.create({ url });
  window.close();
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
  paintSendFiat();
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
  state.sentExplorerUrl = answer.result.explorerUrl || null;
  show(el("sent-explorer"), !!state.sentExplorerUrl);
  el("send-to").value = "";
  el("send-amount").value = "";
  el("send-memo").value = "";
  state.pendingSend = null;
  view("sent");
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

el("nohost-retry").addEventListener("click", refresh);

el("price-card").addEventListener("click", openListing);
el("price-card").addEventListener("keydown", (e) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openListing();
  }
});
setText("price-note", PRICE_NOTE);
el("price-info").title = PRICE_NOTE;
el("price-info").addEventListener("click", (e) => {
  e.stopPropagation();
  const note = el("price-note");
  const open = note.classList.contains("hidden");
  show(note, open);
  el("price-info").setAttribute("aria-expanded", String(open));
});
el("send-amount").addEventListener("input", paintSendFiat);

el("share-yes").addEventListener("click", () => answerRewardsQuestion(true));
el("share-no").addEventListener("click", () => answerRewardsQuestion(false));

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
  const moved = answer.result && answer.result.chainRestart;
  if (moved && moved.notice) state.restartNotice = moved.notice;
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
el("sent-explorer").addEventListener("click", () => openExplorer(state.sentExplorerUrl));
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
  if (!message) return;
  if (message.type === "swarm.locked") refresh();
  if (message.type === "swarm.rewards.consent-pending") refresh();
});

// The setting can be changed in the settings tab while this popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SHOW_PRICE_KEY]) return;
  price.enabled = changes[SHOW_PRICE_KEY].newValue !== false;
  if (!price.enabled) price.reading = null;
  if (PRICE_VIEWS.some((v) => !el(`view-${v}`).classList.contains("hidden"))) startPrice();
  else paintPrice();
});

window.addEventListener("pagehide", stopPrice);

// The setting is read before anything else, so no request can go out before it is known.
loadPriceSetting().then(refresh);
