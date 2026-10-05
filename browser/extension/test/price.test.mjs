import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  PRICE_URL,
  DEXSCREENER_FALLBACK_URL,
  MAX_BODY_CHARS,
  FRESHNESS,
  parseDecimal,
  formatUsdPrice,
  zatsFromCoins,
  fiatCents,
  formatFiat,
  MASKED_FIAT,
  safeListingUrl,
  parsePriceDocument,
  toStored,
  fromStored,
  asOfMs,
  classify,
  freshnessText,
  metaLine,
  formatChange,
  sparklinePaths,
  fetchPrice,
} from "../lib/price.js";

/** The relay answer exactly as printed in specs/PRICE-DISPLAY.md §2.1. */
const SPEC_TEXT = readFileSync(new URL("./fixtures-price.json", import.meta.url), "utf8");
const SPEC = JSON.parse(SPEC_TEXT);
const T0 = 1791223633 * 1000; // the fixture's generated_unix, in ms
const FULL_DEX = DEXSCREENER_FALLBACK_URL;

function doc(patch) {
  return JSON.stringify({ ...SPEC, ...patch });
}

/* ── the relay document ─────────────────────────────────────────────── */

test("the spec's relay answer parses", () => {
  const r = parsePriceDocument(SPEC_TEXT, T0 + 500);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.reading.price_usd, "0.84114343");
  assert.equal(r.reading.change_pct_h24, 36.72);
  assert.deepEqual(r.reading.sparkline_usd, [0.5259, 0.573, 0.6361, 0.6533, 0.7537, 0.8411]);
  assert.equal(r.reading.generated_unix, 1791223633);
  assert.equal(r.reading.stale, false);
  assert.equal(r.reading.source, "geckoterminal");
  assert.equal(r.reading.fetchedAt, T0 + 500);
  // The spec abbreviates the pool id with "…"; that is not a usable link, so the fixed one is used.
  assert.equal(r.reading.dexscreener_url, FULL_DEX);
});

test("a full DexScreener link from the relay is kept", () => {
  const r = parsePriceDocument(doc({ pool: { ...SPEC.pool, dexscreener_url: FULL_DEX } }), T0);
  assert.equal(r.reading.dexscreener_url, FULL_DEX);
});

test("malformed or mismatched answers are refused", () => {
  const cases = [
    ["wrong schema", doc({ schema: "swarm-price/2" })],
    ["no schema", JSON.stringify({ ...SPEC, schema: undefined })],
    ["relay 503 body", JSON.stringify({ schema: "swarm-price/1", error: "unavailable" })],
    ["float price", doc({ price_usd: 0.84114343 })],
    ["zero price", doc({ price_usd: "0" })],
    ["zero price with decimals", doc({ price_usd: "0.0000" })],
    ["negative price", doc({ price_usd: "-0.84" })],
    ["exponent price", doc({ price_usd: "8.4e-1" })],
    ["padded price", doc({ price_usd: " 0.84" })],
    ["other token", doc({ symbol: "BTC" })],
    ["other quote", doc({ quote: "EUR" })],
    ["no time", JSON.stringify({ ...SPEC, generated_unix: undefined })],
    ["string time", doc({ generated_unix: "1791223633" })],
    ["bad stale flag", doc({ stale: "yes" })],
    ["array", "[1,2,3]"],
    ["null", "null"],
    ["not JSON", "<html>502 Bad Gateway</html>"],
    ["too large", doc({ padding: "x".repeat(MAX_BODY_CHARS) })],
  ];
  for (const [name, text] of cases) {
    const r = parsePriceDocument(text, T0);
    assert.equal(r.ok, false, name);
    assert.equal(typeof r.error, "string", name);
  }
});

test("an unusable sparkline is dropped, not the price", () => {
  assert.equal(parsePriceDocument(doc({ sparkline_usd: [0.5, null, 0.6] }), T0).reading.sparkline_usd, null);
  assert.equal(parsePriceDocument(doc({ sparkline_usd: [0.5] }), T0).reading.sparkline_usd, null);
  assert.equal(parsePriceDocument(doc({ sparkline_usd: "0.5,0.6" }), T0).reading.sparkline_usd, null);
  assert.equal(parsePriceDocument(doc({ sparkline_usd: undefined }), T0).reading.sparkline_usd, null);
  const long = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.deepEqual(parsePriceDocument(doc({ sparkline_usd: long }), T0).reading.sparkline_usd, long.slice(-48));
});

test("missing change and unknown source are tolerated", () => {
  const r = parsePriceDocument(doc({ change_pct: undefined, source: "<b>evil</b>" }), T0);
  assert.equal(r.ok, true);
  assert.equal(r.reading.change_pct_h24, null);
  assert.equal(r.reading.source, null);
});

test("only https://dexscreener.com/base/0x… links are opened", () => {
  const bad = [
    "https://evil.example/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599",
    "https://dexscreener.com.evil.example/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf",
    "http://dexscreener.com/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf",
    "https://user@dexscreener.com/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf",
    "https://dexscreener.com:8443/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf",
    "https://dexscreener.com/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf?ref=x",
    "https://dexscreener.com/ethereum/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf",
    "javascript:alert(1)",
    "",
    null,
    42,
  ];
  for (const u of bad) assert.equal(safeListingUrl(u), FULL_DEX, String(u));
  assert.equal(safeListingUrl(FULL_DEX), FULL_DEX);
});

/* ── numbers ────────────────────────────────────────────────────────── */

test("decimal strings parse exactly", () => {
  assert.deepEqual(parseDecimal("0.84114343"), { int: 84114343n, scale: 8 });
  assert.deepEqual(parseDecimal("12"), { int: 12n, scale: 0 });
  assert.equal(parseDecimal("1."), null);
  assert.equal(parseDecimal(".5"), null);
  assert.equal(parseDecimal("1,5"), null);
});

test("prices: four significant digits under 1 USD, two decimals from 1 USD", () => {
  const cases = [
    ["0.84114343", "$0.8411"],
    ["0.8602", "$0.8602"],
    ["0.86025", "$0.8603"], // half-up
    ["0.9999", "$0.9999"],
    ["0.99995", "$1.00"], // the carry reaches the units
    ["0.0099996", "$0.01000"], // the carry adds a digit
    ["0.000012345", "$0.00001235"],
    ["0.5", "$0.5000"],
    ["1", "$1.00"],
    ["1.5", "$1.50"],
    ["1.005", "$1.01"],
    ["12345.678", "$12,345.68"],
    ["1234567.891", "$1,234,567.89"],
  ];
  for (const [input, want] of cases) assert.equal(formatUsdPrice(input), want, input);
  for (const bad of ["0", "-1", "1e3", "", null, 0.84]) assert.equal(formatUsdPrice(bad), null, String(bad));
});

test("balances go back to zats through their fixed-8 text", () => {
  assert.equal(zatsFromCoins(1), 100000000n);
  assert.equal(zatsFromCoins(0.1 + 0.2), 30000000n);
  assert.equal(zatsFromCoins(123.45678901), 12345678901n);
  assert.equal(zatsFromCoins(0), 0n);
  for (const bad of [-1, NaN, Infinity, 1e21, "1", null]) assert.equal(zatsFromCoins(bad), null, String(bad));
});

test("fiat value: balance × price in BigInt, rounded half-up to the cent", () => {
  assert.equal(fiatCents(12480.5, "0.84114343"), 1049789n); // 10,497.890578…
  assert.equal(formatFiat(12480.5, "0.84114343"), "≈ $10,497.89 USD");
  assert.equal(formatFiat(1, "0.84114343"), "≈ $0.84 USD");
  assert.equal(formatFiat(1, "0.005"), "≈ $0.01 USD"); // exactly half a cent rounds up
  assert.equal(formatFiat(1, "0.00499999"), "≈ $0.00 USD");
  assert.equal(formatFiat(0, "0.84"), "≈ $0.00 USD");
  assert.equal(formatFiat(21000000, "1234.5678"), "≈ $25,925,923,800.00 USD");
  assert.equal(formatFiat(-1, "0.84"), null);
  assert.equal(formatFiat(1, "0"), null);
  assert.equal(formatFiat(1, 0.84), null);
  assert.equal(MASKED_FIAT, "≈ •••••• USD");
});

test("24 h change chip", () => {
  assert.deepEqual(formatChange(36.72), { text: "▲ 36.7 % 24h", direction: "up" });
  assert.deepEqual(formatChange(-3.21), { text: "▼ 3.2 % 24h", direction: "down" });
  assert.deepEqual(formatChange(0), { text: "0.0 % 24h", direction: "flat" });
  assert.deepEqual(formatChange(-0.04), { text: "0.0 % 24h", direction: "flat" });
  assert.equal(formatChange(null), null);
  assert.equal(formatChange(NaN), null);
});

/* ── freshness, with an injected clock ──────────────────────────────── */

function reading(patch) {
  return { ...parsePriceDocument(SPEC_TEXT, T0).reading, ...patch };
}

test("freshness: fresh, ageing, stale, unavailable", () => {
  const r = reading();
  assert.equal(classify(r, T0 + 12_000), FRESHNESS.FRESH);
  assert.equal(classify(r, T0 + 4 * 60_000), FRESHNESS.FRESH);
  assert.equal(classify(r, T0 + 5 * 60_000), FRESHNESS.AGEING);
  assert.equal(classify(r, T0 + 30 * 60_000), FRESHNESS.AGEING);
  assert.equal(classify(r, T0 + 31 * 60_000), FRESHNESS.STALE);
  assert.equal(classify(r, T0 + 60 * 60_000), FRESHNESS.STALE);
  assert.equal(classify(r, T0 + 61 * 60_000), FRESHNESS.UNAVAILABLE);
  assert.equal(classify(null, T0), FRESHNESS.UNAVAILABLE);
});

test("a relay-stale answer is stale at once, dated by the relay", () => {
  const r = reading({ stale: true, generated_unix: 1791223633 - 600, fetchedAt: T0 });
  assert.equal(asOfMs(r), T0 - 600_000);
  assert.equal(classify(r, T0 + 1000), FRESHNESS.STALE);
  assert.equal(classify(r, T0 + 51 * 60_000), FRESHNESS.UNAVAILABLE);
});

test("a fast relay clock cannot make an old reading look new", () => {
  const r = reading({ stale: true, generated_unix: 1791223633 + 3600, fetchedAt: T0 });
  assert.equal(asOfMs(r), T0);
});

test("freshness wording", () => {
  const r = reading();
  assert.equal(freshnessText(r, T0 + 12_400, "UTC"), "updated 12 s ago");
  assert.equal(freshnessText(r, T0 + 3 * 60_000 + 5000, "UTC"), "updated 3 min ago");
  // 1791223633 = 2026-10-05 18:07:13 UTC
  assert.equal(freshnessText(r, T0 + 6 * 60_000, "UTC"), "as of 18:07");
  assert.equal(freshnessText(r, T0 + 2 * 3600_000, "UTC"), "price unavailable");
  assert.equal(metaLine(r, T0 + 12_000, "UTC"), "Base · Uniswap v4 · GeckoTerminal · updated 12 s ago");
  assert.equal(metaLine(reading({ source: null }), T0 + 6 * 60_000, "UTC"), "Base · Uniswap v4 · as of 18:07");
});

test("storage round trip, and a tampered entry is refused", () => {
  const r = reading({ fetchedAt: T0 + 1 });
  const back = fromStored(JSON.parse(JSON.stringify(toStored(r))));
  assert.equal(back.price_usd, r.price_usd);
  assert.equal(back.change_pct_h24, r.change_pct_h24);
  assert.deepEqual(back.sparkline_usd, r.sparkline_usd);
  assert.equal(back.fetchedAt, T0 + 1);
  assert.equal(back.dexscreener_url, FULL_DEX);
  assert.equal(fromStored(null), null);
  assert.equal(fromStored({ ...toStored(r), price_usd: "-1" }), null);
  assert.equal(fromStored({ ...toStored(r), fetchedAt: "now" }), null);
  assert.equal(fromStored({ ...toStored(r), source: "javascript:" }).source, null);
});

/* ── sparkline ──────────────────────────────────────────────────────── */

test("sparkline paths: lowest at the bottom, highest at the top", () => {
  const p = sparklinePaths([1, 3, 2], 100, 40, 2);
  assert.equal(p.line, "M0 38 L50 2 L100 20");
  assert.equal(p.area, "M0 38 L50 2 L100 20 L100 40 L0 40 Z");
  assert.equal(sparklinePaths([2, 2], 100, 40).line, "M0 20 L100 20");
  assert.equal(sparklinePaths([1], 100, 40), null);
  assert.equal(sparklinePaths(null, 100, 40), null);
  assert.equal(sparklinePaths(SPEC.sparkline_usd, 298, 44).line.split("L").length, 6);
});

/* ── the request, with a fake fetch ─────────────────────────────────── */

function fakeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() in headers ? headers[k.toLowerCase()] : null) },
    text: async () => body,
  };
}

test("fetchPrice asks the fixed URL, without cookies, referrer or redirects", async () => {
  let seen = null;
  const r = await fetchPrice({
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return fakeResponse(200, SPEC_TEXT);
    },
    now: () => T0 + 42,
  });
  assert.equal(r.ok, true);
  assert.equal(r.reading.fetchedAt, T0 + 42);
  assert.equal(seen.url, PRICE_URL);
  assert.equal(PRICE_URL, "https://wallet.swarm.green/api/price/swm");
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.credentials, "omit");
  assert.equal(seen.init.redirect, "error");
  assert.equal(seen.init.referrerPolicy, "no-referrer");
  assert.ok(seen.init.signal);
});

test("fetchPrice: 503, declared oversize, network error and timeout all fail softly", async () => {
  const unavailable = await fetchPrice({
    fetchImpl: async () => fakeResponse(503, JSON.stringify({ schema: "swarm-price/1", error: "unavailable" })),
  });
  assert.deepEqual(unavailable, { ok: false, error: "relay answered 503" });

  const big = await fetchPrice({
    fetchImpl: async () => fakeResponse(200, SPEC_TEXT, { "content-length": String(MAX_BODY_CHARS + 1) }),
  });
  assert.deepEqual(big, { ok: false, error: "body too large" });

  const offline = await fetchPrice({
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.deepEqual(offline, { ok: false, error: "relay unreachable" });

  const slow = await fetchPrice({
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      }),
  });
  assert.deepEqual(slow, { ok: false, error: "relay did not answer in time" });
});
