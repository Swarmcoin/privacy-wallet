import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  PRICE_URL,
  POOL_ID,
  TOKEN_CONTRACT,
  DEXSCREENER_URL,
  GECKOTERMINAL_URL,
  MAX_BODY_CHARS,
  FRESHNESS,
  parseDecimal,
  formatUsdPrice,
  zatsFromCoins,
  fiatCents,
  formatFiat,
  MASKED_FIAT,
  formatUsdValue,
  formatEthPrice,
  formatUsdAmount,
  shortHex,
  parsePriceDocument,
  toStored,
  fromStored,
  asOfMs,
  classify,
  freshnessText,
  metaLine,
  formatChange,
  sparklinePaths,
  chartGeometry,
  nearestIndex,
  rangeSeries,
  availableRanges,
  pickRange,
  formatPointTime,
  fetchPrice,
} from "../lib/price.js";

/** The relay answer exactly as printed in specs/PRICE-DISPLAY.md §2.1. */
const SPEC_TEXT = readFileSync(new URL("./fixtures-price.json", import.meta.url), "utf8");
const SPEC = JSON.parse(SPEC_TEXT);
const T0 = 1791223633 * 1000; // the fixture's generated_unix, in ms
/** One real answer of the live relay, read 2026-10-05 19:01 UTC. */
const LIVE_TEXT = readFileSync(new URL("./fixtures-price-live.json", import.meta.url), "utf8");

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
  assert.equal(r.reading.price_eth, "0.000195976");
  assert.equal(r.reading.change_pct_h1, 0);
  assert.equal(r.reading.change_pct_h6, 28.75);
  assert.equal(r.reading.liquidity_usd, 3761.34);
  assert.equal(r.reading.volume_24h_usd, 378.11);
  assert.equal(r.reading.fdv_usd, 8411.43);
  assert.deepEqual(r.reading.sources, [
    { id: "geckoterminal", ok: true, price_usd: "0.84114343", fetched_unix: 1791223633 },
    { id: "dexscreener", ok: true, price_usd: "0.8602", fetched_unix: 1791223633 },
  ]);
  // Not in the §2.1 sample: absent, not invented.
  assert.equal(r.reading.daily_usd, null);
  assert.equal(r.reading.transactions_24h, null);
  assert.equal(r.reading.fee_pct, null);
});

test("the live relay's answer parses", () => {
  const r = parsePriceDocument(LIVE_TEXT, 1791226888000);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.reading.price_usd, "0.84114343498587");
  assert.equal(r.reading.price_eth, "0.000195976178807639");
  assert.equal(r.reading.sparkline_usd.length, 48);
  assert.equal(formatUsdPrice(r.reading.price_usd), "$0.8411");
  assert.equal(formatEthPrice(r.reading.price_eth), "0.000196 ETH");
  assert.equal(r.reading.sources.length, 2);
});

test("the §6.1 additions parse, each checked on its own", () => {
  const daily = Array.from({ length: 30 }, (_, i) => 0.3 + i / 100);
  const r = parsePriceDocument(
    doc({
      daily_usd: daily,
      daily_from_unix: 1788652800,
      hourly_from_unix: 1791223633 - 5 * 3600,
      transactions_24h: { buys: 9, sells: 0 },
      pool: { ...SPEC.pool, fee_pct: 0.9, created_unix: 1790900000 },
    }),
    T0,
  ).reading;
  assert.deepEqual(r.daily_usd, daily);
  assert.equal(r.daily_from_unix, 1788652800);
  assert.equal(r.hourly_from_unix, 1791223633 - 5 * 3600);
  assert.deepEqual(r.transactions_24h, { buys: 9, sells: 0 });
  assert.equal(r.fee_pct, 0.9);
  assert.equal(r.pool_created_unix, 1790900000);

  const bad = parsePriceDocument(
    doc({
      price_eth: 0.0002,
      change_pct: { h1: "1", h6: null, h24: 36.72 },
      daily_usd: [0.5, -1],
      daily_from_unix: "yesterday",
      transactions_24h: { buys: -1, sells: 0 },
      liquidity_usd: "3761",
      volume_24h_usd: -5,
      fdv_usd: Infinity,
      pool: { fee_pct: 900, created_unix: 1.5 },
      sources: [
        { id: "evil", ok: true, price_usd: "1" },
        { id: "dexscreener", ok: "yes", price_usd: "0.86" },
        { id: "geckoterminal", ok: false, price_usd: "-1", fetched_unix: "x" },
        { id: "geckoterminal", ok: true, price_usd: "0.84" },
      ],
    }),
    T0,
  );
  assert.equal(bad.ok, true, "a bad optional field never costs the price");
  const b = bad.reading;
  assert.equal(b.price_eth, null);
  assert.equal(b.change_pct_h1, null);
  assert.equal(b.change_pct_h6, null);
  assert.equal(b.change_pct_h24, 36.72);
  assert.equal(b.daily_usd, null);
  assert.equal(b.daily_from_unix, null);
  assert.equal(b.transactions_24h, null);
  assert.equal(b.liquidity_usd, null);
  assert.equal(b.volume_24h_usd, null);
  assert.equal(b.fdv_usd, null);
  assert.equal(b.fee_pct, null);
  assert.equal(b.pool_created_unix, null);
  assert.deepEqual(b.sources, [{ id: "geckoterminal", ok: false, price_usd: null, fetched_unix: null }]);
});

test("a trimmed series keeps its start time honest", () => {
  const long = Array.from({ length: 60 }, (_, i) => i + 1);
  const r = parsePriceDocument(doc({ sparkline_usd: long, hourly_from_unix: 1000 * 3600 }), T0).reading;
  assert.equal(r.sparkline_usd.length, 49);
  assert.equal(r.hourly_from_unix, (1000 + 11) * 3600);
});

test("the listing links and the pool are fixed, whatever the relay says", () => {
  const r = parsePriceDocument(doc({ pool: { dexscreener_url: "https://evil.example/" } }), T0).reading;
  assert.equal("dexscreener_url" in r, false);
  assert.equal(DEXSCREENER_URL, `https://dexscreener.com/base/${POOL_ID}`);
  assert.equal(GECKOTERMINAL_URL, `https://www.geckoterminal.com/base/pools/${POOL_ID}`);
  assert.equal(new URL(DEXSCREENER_URL).origin, "https://dexscreener.com");
  assert.equal(new URL(GECKOTERMINAL_URL).origin, "https://www.geckoterminal.com");
  assert.equal(shortHex(POOL_ID), "0xf1e0…4599");
  assert.equal(shortHex(TOKEN_CONTRACT), "0xf904…043B");
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
  assert.deepEqual(parsePriceDocument(doc({ sparkline_usd: long }), T0).reading.sparkline_usd, long.slice(-49));
});

test("missing change and unknown source are tolerated", () => {
  const r = parsePriceDocument(doc({ change_pct: undefined, source: "<b>evil</b>" }), T0);
  assert.equal(r.ok, true);
  assert.equal(r.reading.change_pct_h24, null);
  assert.equal(r.reading.source, null);
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

test("ETH price, stat amounts and series values", () => {
  assert.equal(formatEthPrice("0.000195976"), "0.000196 ETH");
  assert.equal(formatEthPrice("0.0009996"), "0.00100 ETH");
  assert.equal(formatEthPrice("2.5"), "2.5000 ETH");
  assert.equal(formatEthPrice("0"), null);
  assert.equal(formatUsdAmount(3761.34), "$3,761");
  assert.equal(formatUsdAmount(378.11), "$378.11");
  assert.equal(formatUsdAmount(8411.43), "$8,411");
  assert.equal(formatUsdAmount(0), "$0.00");
  assert.equal(formatUsdAmount(null), "—");
  assert.equal(formatUsdAmount(-1), "—");
  assert.equal(formatUsdValue(0.573008), "$0.5730");
  assert.equal(formatUsdValue(12.345), "$12.35");
  assert.equal(formatUsdValue(0), null);
  assert.equal(formatUsdValue(NaN), null);
});

test("24 h change chip", () => {
  assert.deepEqual(formatChange(36.72), { text: "▲ 36.7 % 24h", direction: "up" });
  assert.deepEqual(formatChange(-3.21), { text: "▼ 3.2 % 24h", direction: "down" });
  assert.deepEqual(formatChange(0), { text: "0.0 % 24h", direction: "flat" });
  assert.deepEqual(formatChange(-0.04), { text: "0.0 % 24h", direction: "flat" });
  assert.deepEqual(formatChange(24.56, "6h"), { text: "▲ 24.6 % 6h", direction: "up" });
  assert.deepEqual(formatChange(0, "1h"), { text: "0.0 % 1h", direction: "flat" });
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
  assert.equal(metaLine(r, T0 + 12_000, "UTC"), "GeckoTerminal · updated 12 s ago");
  assert.equal(metaLine(reading({ source: null }), T0 + 6 * 60_000, "UTC"), "as of 18:07");
});

test("the §6.1 fields survive storage, and are checked again on the way out", () => {
  const r = parsePriceDocument(
    doc({ daily_usd: [0.5, 0.6, 0.7], daily_from_unix: 1788652800, transactions_24h: { buys: 9, sells: 0 }, pool: { fee_pct: 0.9 } }),
    T0,
  ).reading;
  const back = fromStored(JSON.parse(JSON.stringify(toStored(r))));
  for (const k of ["price_eth", "change_pct_h1", "change_pct_h6", "liquidity_usd", "volume_24h_usd", "fdv_usd", "fee_pct", "daily_from_unix"]) {
    assert.deepEqual(back[k], r[k], k);
  }
  assert.deepEqual(back.daily_usd, [0.5, 0.6, 0.7]);
  assert.deepEqual(back.transactions_24h, { buys: 9, sells: 0 });
  assert.deepEqual(back.sources, r.sources);
  const tampered = fromStored({ ...toStored(r), daily_usd: ["x"], fee_pct: -3, sources: [{ id: "evil", ok: true }] });
  assert.equal(tampered.daily_usd, null);
  assert.equal(tampered.daily_from_unix, null, "no start time without a series");
  assert.equal(tampered.fee_pct, null);
  assert.equal(tampered.sources, null);
  // A reading remembered by 0.2.1 (before §6.1) still loads.
  const old = { price_usd: "0.84", change_pct_h24: 1, sparkline_usd: [1, 2], generated_unix: 1, stale: false, source: "geckoterminal", fetchedAt: 5 };
  assert.equal(fromStored(old).price_eth, null);
  assert.deepEqual(fromStored(old).sparkline_usd, [1, 2]);
});

test("storage round trip, and a tampered entry is refused", () => {
  const r = reading({ fetchedAt: T0 + 1 });
  const back = fromStored(JSON.parse(JSON.stringify(toStored(r))));
  assert.equal(back.price_usd, r.price_usd);
  assert.equal(back.change_pct_h24, r.change_pct_h24);
  assert.deepEqual(back.sparkline_usd, r.sparkline_usd);
  assert.equal(back.fetchedAt, T0 + 1);
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

test("chart geometry: points, extremes, guides", () => {
  const g = chartGeometry([1, 3, 2, 0.5], { width: 300, height: 100, padTop: 10, padBottom: 20 });
  assert.deepEqual(g.points, [
    [0, 66],
    [100, 10],
    [200, 38],
    [300, 80],
  ]);
  assert.equal(g.line, "M0 66 L100 10 L200 38 L300 80");
  assert.equal(g.area, "M0 66 L100 10 L200 38 L300 80 L300 100 L0 100 Z");
  assert.equal(g.minIndex, 3);
  assert.equal(g.maxIndex, 1);
  assert.equal(g.min, 0.5);
  assert.equal(g.max, 3);
  assert.deepEqual(g.guides, [27.5, 45, 62.5]);
  const flat = chartGeometry([2, 2, 2], { width: 100, height: 100, padTop: 10, padBottom: 10 });
  assert.deepEqual(flat.points.map((p) => p[1]), [50, 50, 50]);
  assert.equal(chartGeometry([1], { width: 100, height: 100 }), null);
  assert.equal(chartGeometry([1, NaN], { width: 100, height: 100 }), null);
});

test("hover: the nearest point to an x coordinate", () => {
  assert.equal(nearestIndex(0, 24, 230), 0);
  assert.equal(nearestIndex(230, 24, 230), 23);
  assert.equal(nearestIndex(115, 24, 230), 12); // 11.5 rounds up
  assert.equal(nearestIndex(-40, 24, 230), 0);
  assert.equal(nearestIndex(999, 24, 230), 23);
  assert.equal(nearestIndex(10, 0, 230), null);
  assert.equal(nearestIndex(NaN, 24, 230), null);
});

test("ranges: 24h = last 24 hourly, 48h = all hourly, 30d = daily", () => {
  const hourly = Array.from({ length: 48 }, (_, i) => 1 + i);
  const daily = Array.from({ length: 30 }, (_, i) => 100 + i);
  const from = 1791050000;
  const r = { sparkline_usd: hourly, hourly_from_unix: from, daily_usd: daily, daily_from_unix: 1788652800 };
  const day = rangeSeries(r, "24h");
  assert.deepEqual(day.values, hourly.slice(-24));
  assert.equal(day.times[0], (from + 24 * 3600) * 1000);
  assert.equal(day.times[23], (from + 47 * 3600) * 1000);
  assert.equal(day.daily, false);
  assert.equal(rangeSeries(r, "48h").values.length, 48);
  assert.equal(rangeSeries(r, "48h").times[0], from * 1000);
  const month = rangeSeries(r, "30d");
  assert.deepEqual(month.values, daily);
  assert.equal(month.times[1] - month.times[0], 86400000);
  assert.equal(month.daily, true);
  assert.equal(rangeSeries(r, "7d"), null);

  // No start time: values without times (the hover shows the value only).
  assert.equal(rangeSeries({ sparkline_usd: hourly }, "24h").times, null);
  // No daily series: 30d is disabled, and a wish for it falls back.
  const noDaily = { sparkline_usd: hourly };
  assert.deepEqual(availableRanges(noDaily), { "24h": true, "48h": true, "30d": false });
  assert.equal(pickRange(noDaily, "30d"), "24h");
  assert.equal(pickRange({ daily_usd: daily }, "24h"), "30d");
  assert.equal(pickRange({}, "24h"), null);
  assert.equal(pickRange(null, "24h"), null);
});

test("a series one longer than its closes ends at the live price", () => {
  const from = 1791050000;
  const hourly = Array.from({ length: 49 }, (_, i) => 1 + i); // 48 closes + live
  const daily = Array.from({ length: 31 }, (_, i) => 100 + i); // 30 closes + live
  const r = { sparkline_usd: hourly, hourly_from_unix: from, daily_usd: daily, daily_from_unix: 1788652800 };

  const day = rangeSeries(r, "24h");
  assert.equal(day.live, true);
  assert.deepEqual(day.values, hourly.slice(-25), "24 closes and the live price");
  assert.equal(day.times[0], (from + 24 * 3600) * 1000, "same time labels as without the live value");
  assert.equal(day.times[23], (from + 47 * 3600) * 1000);
  assert.equal(day.times[24], null);

  const two = rangeSeries(r, "48h");
  assert.equal(two.values.length, 49);
  assert.equal(two.times[0], from * 1000);
  assert.equal(two.times[47], (from + 47 * 3600) * 1000);
  assert.equal(two.times[48], null);

  const month = rangeSeries(r, "30d");
  assert.equal(month.live, true);
  assert.equal(month.values.length, 31);
  assert.equal(month.times[29], (1788652800 + 29 * 86400) * 1000);
  assert.equal(month.times[30], null);

  // Exactly the close count: no live value, every point has its time.
  const plain = rangeSeries({ sparkline_usd: hourly.slice(0, 48), hourly_from_unix: from }, "24h");
  assert.equal(plain.live, false);
  assert.equal(plain.values.length, 24);
  assert.equal(plain.times[23], (from + 47 * 3600) * 1000);

  // Parsing keeps 49 hourly and 31 daily, and trims one more from the front.
  const parsed = parsePriceDocument(
    doc({ sparkline_usd: [0.5, ...hourly], hourly_from_unix: from - 3600, daily_usd: [99, ...daily], daily_from_unix: 1788652800 - 86400 }),
    T0,
  ).reading;
  assert.equal(parsed.sparkline_usd.length, 49);
  assert.equal(parsed.hourly_from_unix, from);
  assert.equal(parsed.daily_usd.length, 31);
  assert.equal(parsed.daily_from_unix, 1788652800);
});

test("hover time labels", () => {
  const ms = Date.UTC(2026, 9, 5, 14, 0);
  assert.equal(formatPointTime(ms, false, "UTC"), "5 Oct, 14:00");
  assert.equal(formatPointTime(ms, true, "UTC"), "5 Oct");
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
