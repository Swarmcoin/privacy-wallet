/**
 * Fake chrome.* and a fake price relay for test/popup-harness.html.
 *
 * Nothing here talks to a wallet host, and only the `live` states talk to the
 * network: `fetch` for the relay URL answers from the made-up document below
 * (or fails, for the old-price states), and every host command answers from
 * the constants below. States:
 *
 *   fresh        live price, balance shown
 *   masked       live price, balance hidden (the default on every opening)
 *   down         live price with a falling 24 h change
 *   ageing       relay unreachable, last reading 12 minutes old
 *   stale        relay unreachable, last reading 40 minutes old
 *   unavailable  relay unreachable, last reading 2 hours old
 *   off          "Show SWM price" switched off
 *   testnet      the host is on SWARM Testnet
 *   send         the send screen with an amount typed
 *   confirm      the confirmation screen
 *   page         the price page (spec §6), 24h range
 *   page-30d     the price page, 30d range
 *   page-hover   the price page with the pointer over the chart
 *   page-off     the price page after switching the price off on it
 *   live         the wallet screen, against the real relay (read-only GET)
 *   page-live    the price page, against the real relay
 */

const PRICE_URL = "https://wallet.swarm.green/api/price/swm";

/** Made-up values in the shape of spec §2.1 + §6.1; not market data. */
const HOURLY = [
  0.5259, 0.5301, 0.5288, 0.5402, 0.5517, 0.573, 0.5689, 0.5822, 0.6014, 0.6361, 0.6298, 0.6411, 0.6533, 0.6487, 0.6602,
  0.6905, 0.7112, 0.7537, 0.7391, 0.7688, 0.7954, 0.8102, 0.8233, 0.8411, 0.8302, 0.8256, 0.8117, 0.7983, 0.8044, 0.8195,
  0.8231, 0.8378, 0.8302, 0.8159, 0.8077, 0.8124, 0.8263, 0.8302, 0.8415, 0.8489, 0.8377, 0.8302, 0.8254, 0.8319, 0.8388,
  0.8352, 0.8396, 0.8411,
];
const DAILY = [
  0.212, 0.218, 0.209, 0.224, 0.236, 0.241, 0.233, 0.252, 0.268, 0.261, 0.279, 0.301, 0.296, 0.318, 0.342, 0.333, 0.358,
  0.392, 0.377, 0.401, 0.436, 0.452, 0.441, 0.479, 0.512, 0.505, 0.548, 0.573, 0.615, 0.8411,
];

function relayDocument(nowS) {
  const hour = Math.floor(nowS / 3600) * 3600;
  const day = Math.floor(nowS / 86400) * 86400;
  return {
    schema: "swarm-price/1",
    symbol: "SWM",
    quote: "USD",
    price_usd: "0.84114343",
    price_eth: "0.000195976",
    change_pct: { h1: 0.84, h6: 28.75, h24: 36.72 },
    volume_24h_usd: 378.11,
    liquidity_usd: 3761.34,
    fdv_usd: 8411.43,
    source: "geckoterminal",
    sources: [
      { id: "geckoterminal", ok: true, price_usd: "0.84114343", fetched_unix: nowS },
      { id: "dexscreener", ok: true, price_usd: "0.8602", fetched_unix: nowS },
    ],
    sparkline_usd: HOURLY,
    sparkline_hours: 48,
    hourly_from_unix: hour - 47 * 3600,
    daily_usd: DAILY,
    daily_from_unix: day - 29 * 86400,
    transactions_24h: { buys: 9, sells: 0 },
    pool: { chain: "base", dex: "uniswap-v4", fee_pct: 0.9, created_unix: day - 40 * 86400 },
    generated_unix: nowS,
    refresh_seconds: 30,
    stale: false,
  };
}

const MAINNET = {
  id: "swarm-mainnet",
  displayName: "SWARM Mainnet",
  ticker: "SWM",
  server: "https://lwd-main.swarm.green:443",
  genesis: "01b76d8a",
  explorer: "https://explore.swarm.green/",
  coinsAreTestCoins: false,
};
const TESTNET = { ...MAINNET, id: "swarm-testnet", displayName: "SWARM Testnet", ticker: "tSWM", coinsAreTestCoins: true };

export function install(state) {
  const now = Date.now();
  const store = {};
  const relayDown = ["ageing", "stale", "unavailable"].includes(state);
  const live = state === "live" || state === "page-live";
  const oldBy = { ageing: 12 * 60_000, stale: 40 * 60_000, unavailable: 2 * 3600_000 }[state];
  if (relayDown) {
    store.swmPriceLast = {
      price_usd: "0.81920000",
      change_pct_h24: 31.4,
      sparkline_usd: HOURLY.slice(0, 22),
      generated_unix: Math.floor((now - oldBy) / 1000),
      stale: false,
      source: "geckoterminal",
      fetchedAt: now - oldBy,
    };
  }
  if (state === "off") store.showSwmPrice = false;

  const network = state === "testnet" ? TESTNET : MAINNET;
  const answers = {
    status: {
      hostVersion: "0.2.0",
      node: "22.12.0",
      core: "loaded",
      coreError: null,
      network,
      walletDir: "C:\\Users\\you\\AppData\\Local\\Swarm\\SWARM Browser Wallet",
      chainRestartPending: false,
      chainRestartNotice: null,
      unlocked: true,
      lockInSeconds: 300,
      deviceAuth: "available",
      walletExists: true,
      walletHeight: 4321,
      serverHeight: 4321,
    },
    balance: { shielded: 12480.5, transparent: 0, pending: 0, ticker: network.ticker },
    addresses: { unified: "swm1qexample", transparent: "s1example" },
    "sync.status": { inProgress: false, percentage: 100, walletHeight: 4321 },
  };

  const listeners = [];
  window.__opened = [];
  window.__requests = [];
  window.chrome = {
    runtime: {
      id: "gmmgmodmgnigcgboccjelpgedejejfap",
      getURL: (p) => `../${p}`,
      sendMessage: async (m) => {
        if (m && m.type === "swarm.command" && m.command in answers) return { ok: true, result: answers[m.command] };
        return { ok: false, error: { code: "harness", message: `no fake for ${m && m.command}` } };
      },
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        async get(defaults) {
          const out = { ...defaults };
          for (const k of Object.keys(defaults)) if (k in store) out[k] = store[k];
          return out;
        },
        async set(values) {
          Object.assign(store, values);
          for (const l of listeners) {
            l(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }])), "local");
          }
        },
        async remove(key) {
          delete store[key];
        },
      },
      onChanged: { addListener: (l) => listeners.push(l) },
    },
    tabs: {
      create: ({ url }) => window.__opened.push(url),
      query: async () => [{ windowId: 1 }],
    },
    sidePanel: { open: async () => {} },
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (url === PRICE_URL) {
      window.__requests.push({ url, init: { ...init, signal: undefined } });
      if (live) return realFetch(url, init); // the real relay, one GET
      if (relayDown) throw new TypeError("Failed to fetch");
      const body = relayDocument(Math.floor(Date.now() / 1000));
      if (state === "down") body.change_pct = { h1: -0.4, h6: -1.9, h24: -3.21 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, init); // the harness's own files only
  };
  // popup.js closes the window after opening a tab; keep the harness on screen.
  window.close = () => {};

  return function after(page) {
    // For a --dump-dom check: how many relay requests the page made, and the fiat line's classes.
    setTimeout(() => {
      document.documentElement.dataset.relayRequests = String(window.__requests.length);
      const fiat = document.getElementById("balance-fiat");
      if (fiat) document.documentElement.dataset.balanceFiat = `${fiat.className}|${fiat.textContent}`;
      const view = [...document.querySelectorAll("[id^=view-]")].find((v) => !v.classList.contains("hidden"));
      if (view) document.documentElement.dataset.view = view.id;
    }, 2500);
    if (page !== "popup") return;
    const click = (id) => document.getElementById(id).click();
    setTimeout(() => {
      if (["fresh", "down", "ageing", "stale", "send", "confirm", "live"].includes(state)) click("reveal");
      if (state.startsWith("page")) {
        click("reveal");
        // Give the reveal's balance answer a moment, then open the page from the card.
        setTimeout(() => click("price-card"), 200);
      }
      if (state === "send" || state === "confirm") {
        click("go-send");
        const to = document.getElementById("send-to");
        to.value = "swm1qexampleexampleexampleexampleexample";
        const amount = document.getElementById("send-amount");
        amount.value = "223.04";
        amount.dispatchEvent(new Event("input"));
        if (state === "confirm") click("send-review");
      }
    }, 300);
    setTimeout(() => {
      if (state === "page-30d") document.querySelector('.pp-range[data-range="30d"]').click();
      if (state === "page-off") click("pp-show-price");
      if (state === "page-hover") {
        const svg = document.getElementById("pp-chart");
        const box = svg.getBoundingClientRect();
        const at = { clientX: box.left + box.width * 0.45, clientY: box.top + box.height / 2, bubbles: true };
        svg.dispatchEvent(new MouseEvent("mousemove", at));
      }
    }, 1200);
  };
}
