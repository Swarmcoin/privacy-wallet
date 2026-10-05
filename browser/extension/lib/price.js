/**
 * The SWM price, as the SWARM price relay reports it (specs/PRICE-DISPLAY.md).
 *
 * This is the extension's one network request of its own: an unauthenticated
 * GET to a fixed SWARM URL, carrying no address, no balance and no identifier.
 * The URL is a constant here and nowhere else; it is never taken from a
 * setting, a message or the relay's own answer. The same goes for the two
 * listing pages the price page links to: fixed here, never from the relay.
 *
 * Everything below except `fetchPrice` is pure, so it can be tested with
 * `node --test` without a browser. Money is done in BigInt on decimal strings:
 * the relay sends the price as a string precisely so it is never a float, and
 * the fiat value of a balance is computed from the balance's zatoshis. It is a
 * display value, not an accounting one. The chart series are floats; they
 * only draw lines.
 */

/** The relay. Fixed in code (spec §2.2); the manifest's CSP allows this host and no other. */
export const PRICE_URL = "https://wallet.swarm.green/api/price/swm";
export const PRICE_SCHEMA = "swarm-price/1";

/** The pool and the token (spec §1). Shown and copied from here, never from the relay. */
export const POOL_ID = "0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599";
export const TOKEN_CONTRACT = "0xf904C14d21bEF5b8a5345a666C77C9cc2A24043B";

/** The listing pages the price page opens (spec §1, §6.2). Fixed hosts, fixed paths. */
export const DEXSCREENER_URL = `https://dexscreener.com/base/${POOL_ID}`;
export const GECKOTERMINAL_URL = `https://www.geckoterminal.com/base/pools/${POOL_ID}`;

export const PRICE_NOTE =
  "Indicative price from the SWM/ETH pool on Base. The pool is small; small trades move it. Not a quote.";

/** chrome.storage.local keys. */
export const SHOW_PRICE_KEY = "showSwmPrice";
export const LAST_PRICE_KEY = "swmPriceLast";

export const FETCH_TIMEOUT_MS = 8000;
export const MAX_BODY_CHARS = 65536;
export const POLL_MS = 60 * 1000;
/** Do not ask again on a quick reopen: the relay caches for 20 s anyway. */
export const MIN_REFETCH_MS = 20 * 1000;

export const FRESH_MS = 5 * 60 * 1000;
export const AGEING_MS = 30 * 60 * 1000;
export const UNAVAILABLE_MS = 60 * 60 * 1000;

export const FRESHNESS = Object.freeze({
  FRESH: "fresh",
  AGEING: "ageing",
  STALE: "stale",
  UNAVAILABLE: "unavailable",
});

/**
 * Closes per series (spec §6.1). The relay appends the live price as one more
 * value, so a series may be one longer: 49 hourly, 31 daily.
 */
const HOURLY_CLOSES = 48;
const DAILY_CLOSES = 30;
const HOURLY_MAX_POINTS = HOURLY_CLOSES + 1;
const DAILY_MAX_POINTS = DAILY_CLOSES + 1;
const HOUR_S = 3600;
const DAY_S = 86400;
export const SOURCE_NAMES = Object.freeze({ geckoterminal: "GeckoTerminal", dexscreener: "DexScreener" });

/* ── decimals ─────────────────────────────────────────────────────────── */

const DECIMAL = /^(\d{1,20})(?:\.(\d{1,20}))?$/;

/**
 * "0.84114343" -> { int: 84114343n, scale: 8 }. Non-negative plain decimals
 * only: no sign, no exponent, no spaces, at most 20 digits either side.
 */
export function parseDecimal(text) {
  if (typeof text !== "string") return null;
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const frac = m[2] || "";
  return { int: BigInt(m[1] + frac), scale: frac.length };
}

/** A decimal string that is a number greater than zero. */
export function isPositiveDecimal(text) {
  const d = parseDecimal(text);
  return !!d && d.int > 0n;
}

/** a / 10^shift, rounded half-up (a >= 0); a negative shift multiplies. */
function divRoundHalfUp(a, shift) {
  if (shift <= 0) return a * 10n ** BigInt(-shift);
  const div = 10n ** BigInt(shift);
  return (a + div / 2n) / div;
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** An integer count of hundredths as "10,497.22". */
function formatHundredths(cents) {
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${groupThousands(whole.toString())}.${frac}`;
}

/**
 * A positive decimal under one, to `sig` significant digits, half-up:
 * "0.000195976" at 3 -> "0.000196". Returns null when rounding reaches 1.
 */
function underOne(d, sig) {
  const digits = d.int.toString().length;
  const leadingZeros = d.scale - digits; // zeros between the point and the first digit
  let decimals = leadingZeros + sig;
  let rounded = divRoundHalfUp(d.int, d.scale - decimals);
  if (rounded >= 10n ** BigInt(decimals)) return null; // 0.99996 -> 1
  if (rounded.toString().length > sig) {
    // 0.0099996 -> 0.01000: the carry added a significant digit; drop one decimal.
    rounded = divRoundHalfUp(rounded, 1);
    decimals -= 1;
  }
  return `0.${rounded.toString().padStart(decimals, "0")}`;
}

/**
 * The price as the card shows it: two decimals at 1 USD or more
 * ("$1.50", "$12,345.68"), otherwise four significant digits ("$0.8411",
 * "$0.00001235"). Rounded half-up. Null for anything that is not a positive
 * decimal string.
 */
export function formatUsdPrice(text) {
  const d = parseDecimal(text);
  if (!d || d.int <= 0n) return null;
  if (d.int < 10n ** BigInt(d.scale)) {
    const small = underOne(d, 4);
    if (small) return `$${small}`;
  }
  return `$${formatHundredths(divRoundHalfUp(d.int, d.scale - 2))}`;
}

/** A float from a chart series, formatted like a price ("$0.8106"). */
export function formatUsdValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1e15) return null;
  return formatUsdPrice(value.toFixed(12));
}

/** The price in ETH: three significant digits under 1 ("0.000196 ETH"), four decimals above. */
export function formatEthPrice(text) {
  const d = parseDecimal(text);
  if (!d || d.int <= 0n) return null;
  if (d.int < 10n ** BigInt(d.scale)) {
    const small = underOne(d, 3);
    if (small) return `${small} ETH`;
  }
  const tenThousandths = divRoundHalfUp(d.int, d.scale - 4);
  const whole = tenThousandths / 10000n;
  const frac = (tenThousandths % 10000n).toString().padStart(4, "0");
  return `${groupThousands(whole.toString())}.${frac} ETH`;
}

/** Whole dollars from 1,000 ("$3,761"), cents below ("$378.11"); "—" when unknown. */
export function formatUsdAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1e15) return "—";
  if (value >= 1000) return `$${groupThousands(Math.round(value).toString())}`;
  const cents = BigInt(Math.round(value * 100));
  return `$${formatHundredths(cents)}`;
}

/**
 * A balance held as a JS number of SWM (the host sends zats / 1e8) back to
 * zats. The number's fixed-8 text is the amount the host meant, give or take
 * the float it travelled as, which is far below a cent.
 */
export function zatsFromCoins(coins) {
  if (typeof coins !== "number" || !Number.isFinite(coins) || coins < 0) return null;
  const m = /^(\d+)\.(\d{8})$/.exec(coins.toFixed(8));
  if (!m) return null; // 1e21 and up: toFixed answers with an exponent
  return BigInt(m[1] + m[2]);
}

/** Cents of USD for `coins` SWM at `priceText` USD, rounded half-up. Null when either is unusable. */
export function fiatCents(coins, priceText) {
  const zats = zatsFromCoins(coins);
  const price = parseDecimal(priceText);
  if (zats === null || !price || price.int <= 0n) return null;
  // USD = zats * price.int / 10^(8 + scale); cents = USD * 100.
  return divRoundHalfUp(zats * price.int, 8 + price.scale - 2);
}

/** "≈ $10,497.22 USD", or null. */
export function formatFiat(coins, priceText) {
  const cents = fiatCents(coins, priceText);
  if (cents === null) return null;
  return `≈ $${formatHundredths(cents)} USD`;
}

/** The fiat line while balances are hidden. The price itself is never masked; the value is. */
export const MASKED_FIAT = "≈ •••••• USD";

/** "0xf1e0…4599". */
export function shortHex(hex, head = 6, tail = 4) {
  const s = String(hex || "");
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/* ── the relay's document ─────────────────────────────────────────────── */

function finiteOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nonNegativeOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function unixOrNull(v) {
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

function countOrNull(v) {
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** A series of positive finite numbers, its last `max` values, or null under two. */
function cleanSeries(list, max) {
  if (!Array.isArray(list)) return null;
  const tail = list.slice(-max);
  if (tail.length < 2) return null;
  for (const v of tail) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  }
  return tail;
}

function knownSource(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SOURCE_NAMES, id) ? id : null;
}

/**
 * The first point's time, corrected for the values cut off the front:
 * when a series was trimmed to its last `kept` values, its start moves on.
 */
function startAfterTrim(fromUnix, originalLength, kept, stepS) {
  if (fromUnix === null || kept === null) return null;
  return fromUnix + (originalLength - kept.length) * stepS;
}

function cleanTransactions(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  const buys = countOrNull(t.buys);
  const sells = countOrNull(t.sells);
  return buys === null || sells === null ? null : { buys, sells };
}

/** One row per known aggregator, at most once each; unknown ids are dropped. */
function cleanSources(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list.slice(0, 8)) {
    if (!s || typeof s !== "object") continue;
    const id = knownSource(s.id);
    if (!id || out.some((o) => o.id === id) || typeof s.ok !== "boolean") continue;
    out.push({
      id,
      ok: s.ok,
      price_usd: isPositiveDecimal(s.price_usd) ? s.price_usd : null,
      fetched_unix: unixOrNull(s.fetched_unix),
    });
  }
  return out.length ? out : null;
}

/**
 * The optional fields of spec §6.1, each checked on its own: one bad field is
 * dropped (null), it does not cost the price. `flat` is either a relay
 * document or a stored reading; the two name these fields differently only
 * where the relay nests them.
 */
function extrasFrom(src, fromRelay) {
  const change = fromRelay && src.change_pct && typeof src.change_pct === "object" ? src.change_pct : {};
  const pool = fromRelay && src.pool && typeof src.pool === "object" ? src.pool : {};
  const hourlyRaw = fromRelay ? src.sparkline_usd : src.sparkline_usd;
  const dailyRaw = src.daily_usd;
  const hourly = cleanSeries(hourlyRaw, HOURLY_MAX_POINTS);
  const daily = cleanSeries(dailyRaw, DAILY_MAX_POINTS);
  const fee = fromRelay ? pool.fee_pct : src.fee_pct;
  return {
    price_eth: isPositiveDecimal(src.price_eth) ? src.price_eth : null,
    change_pct_h1: finiteOrNull(fromRelay ? change.h1 : src.change_pct_h1),
    change_pct_h6: finiteOrNull(fromRelay ? change.h6 : src.change_pct_h6),
    change_pct_h24: finiteOrNull(fromRelay ? change.h24 : src.change_pct_h24),
    sparkline_usd: hourly,
    hourly_from_unix: fromRelay
      ? startAfterTrim(unixOrNull(src.hourly_from_unix), Array.isArray(hourlyRaw) ? hourlyRaw.length : 0, hourly, HOUR_S)
      : hourly && unixOrNull(src.hourly_from_unix),
    daily_usd: daily,
    daily_from_unix: fromRelay
      ? startAfterTrim(unixOrNull(src.daily_from_unix), Array.isArray(dailyRaw) ? dailyRaw.length : 0, daily, DAY_S)
      : daily && unixOrNull(src.daily_from_unix),
    transactions_24h: cleanTransactions(src.transactions_24h),
    liquidity_usd: nonNegativeOrNull(src.liquidity_usd),
    volume_24h_usd: nonNegativeOrNull(src.volume_24h_usd),
    fdv_usd: nonNegativeOrNull(src.fdv_usd),
    fee_pct: typeof fee === "number" && Number.isFinite(fee) && fee >= 0 && fee <= 100 ? fee : null,
    pool_created_unix: unixOrNull(fromRelay ? pool.created_unix : src.pool_created_unix),
    sources: cleanSources(src.sources),
    source: knownSource(src.source),
  };
}

/**
 * Checks one relay answer. Returns `{ ok: true, reading }` or
 * `{ ok: false, error }`; never throws. `fetchedAt` is the local clock in ms
 * when the answer arrived.
 */
export function parsePriceDocument(text, fetchedAt) {
  if (typeof text !== "string") return { ok: false, error: "no body" };
  if (text.length > MAX_BODY_CHARS) return { ok: false, error: "body too large" };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (_) {
    return { ok: false, error: "not JSON" };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, error: "not an object" };
  if (doc.schema !== PRICE_SCHEMA) return { ok: false, error: "unknown schema" };
  if (doc.error !== undefined) return { ok: false, error: "relay says unavailable" };
  if (doc.symbol !== undefined && doc.symbol !== "SWM") return { ok: false, error: "not SWM" };
  if (doc.quote !== undefined && doc.quote !== "USD") return { ok: false, error: "not USD" };
  if (!isPositiveDecimal(doc.price_usd)) return { ok: false, error: "price is not a positive decimal" };
  if (!Number.isSafeInteger(doc.generated_unix) || doc.generated_unix <= 0) {
    return { ok: false, error: "no generation time" };
  }
  if (doc.stale !== undefined && typeof doc.stale !== "boolean") return { ok: false, error: "bad stale flag" };
  return {
    ok: true,
    reading: {
      price_usd: doc.price_usd,
      generated_unix: doc.generated_unix,
      stale: doc.stale === true,
      fetchedAt,
      ...extrasFrom(doc, true),
    },
  };
}

const STORED_FIELDS = [
  "price_usd",
  "generated_unix",
  "stale",
  "fetchedAt",
  "price_eth",
  "change_pct_h1",
  "change_pct_h6",
  "change_pct_h24",
  "sparkline_usd",
  "hourly_from_unix",
  "daily_usd",
  "daily_from_unix",
  "transactions_24h",
  "liquidity_usd",
  "volume_24h_usd",
  "fdv_usd",
  "fee_pct",
  "pool_created_unix",
  "sources",
  "source",
];

/** The shape kept in chrome.storage.local under `swmPriceLast`: the reading's own fields, flat. */
export function toStored(reading) {
  const out = {};
  for (const k of STORED_FIELDS) out[k] = reading[k] === undefined ? null : reading[k];
  return out;
}

/** A stored reading, checked again on the way out: storage is not a trusted source either. */
export function fromStored(stored) {
  if (!stored || typeof stored !== "object") return null;
  if (!isPositiveDecimal(stored.price_usd)) return null;
  if (!Number.isSafeInteger(stored.generated_unix) || stored.generated_unix <= 0) return null;
  if (typeof stored.fetchedAt !== "number" || !Number.isFinite(stored.fetchedAt)) return null;
  return {
    price_usd: stored.price_usd,
    generated_unix: stored.generated_unix,
    stale: stored.stale === true,
    fetchedAt: stored.fetchedAt,
    ...extrasFrom(stored, false),
  };
}

/* ── freshness ────────────────────────────────────────────────────────── */

/**
 * When the price was true. While the relay vouches for it (`stale: false`) it
 * is the moment we fetched it, so a skewed computer clock cannot make a fresh
 * price look old. When the relay says stale, it is the relay's own generation
 * time, never later than our fetch.
 */
export function asOfMs(reading) {
  if (!reading) return null;
  if (!reading.stale) return reading.fetchedAt;
  return Math.min(reading.fetchedAt, reading.generated_unix * 1000);
}

/** FRESH < 5 min, AGEING 5–30 min, STALE > 30 min or relay-stale, UNAVAILABLE > 60 min or nothing. */
export function classify(reading, nowMs) {
  if (!reading) return FRESHNESS.UNAVAILABLE;
  const age = Math.max(0, nowMs - asOfMs(reading));
  if (age > UNAVAILABLE_MS) return FRESHNESS.UNAVAILABLE;
  if (reading.stale || age > AGEING_MS) return FRESHNESS.STALE;
  if (age >= FRESH_MS) return FRESHNESS.AGEING;
  return FRESHNESS.FRESH;
}

/** "14:05", 24-hour, in the computer's time zone unless one is given. */
export function clockTime(ms, timeZone) {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
}

/** "updated 12 s ago" / "updated 3 min ago" while fresh, "as of 14:05" after, "price unavailable" at the end. */
export function freshnessText(reading, nowMs, timeZone) {
  const state = classify(reading, nowMs);
  if (state === FRESHNESS.UNAVAILABLE) return "price unavailable";
  const at = asOfMs(reading);
  if (state === FRESHNESS.FRESH) {
    const s = Math.max(0, Math.floor((nowMs - at) / 1000));
    return s < 60 ? `updated ${s} s ago` : `updated ${Math.floor(s / 60)} min ago`;
  }
  return `as of ${clockTime(at, timeZone)}`;
}

/** "Base · Uniswap v4 · GeckoTerminal · updated 12 s ago". */
export function metaLine(reading, nowMs, timeZone) {
  const parts = ["Base", "Uniswap v4"];
  if (reading && reading.source) parts.push(SOURCE_NAMES[reading.source]);
  parts.push(freshnessText(reading, nowMs, timeZone));
  return parts.join(" · ");
}

/** A change chip: "▲ 36.7 % 24h" up, "▼ 3.2 % 6h" down, "0.0 % 1h" flat; null when unknown. */
export function formatChange(pct, label = "24h") {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  if (rounded === 0) return { text: `0.0 % ${label}`, direction: "flat" };
  const text = `${rounded.toFixed(1)} % ${label}`;
  return pct > 0 ? { text: `▲ ${text}`, direction: "up" } : { text: `▼ ${text}`, direction: "down" };
}

/* ── chart ranges ─────────────────────────────────────────────────────── */

export const RANGES = Object.freeze(["24h", "48h", "30d"]);

/**
 * The values (and their times, when the relay said when the series starts)
 * for one range of the price page's chart, or null when the range has no data:
 * 24h = the last 24 hourly closes, 48h = all hourly, 30d = the daily closes.
 *
 * A series exactly one longer than its close count (49 hourly, 31 daily) ends
 * at the live price: that last value is kept in every range (`live: true`),
 * has no close time (null in `times`; the page says "now"), and the earlier
 * points keep the times they would have had without it.
 */
export function rangeSeries(reading, range) {
  if (!reading) return null;
  let all;
  let closes;
  let take;
  let fromUnix;
  let stepS;
  if (range === "24h" || range === "48h") {
    all = reading.sparkline_usd;
    closes = HOURLY_CLOSES;
    take = range === "24h" ? 24 : HOURLY_CLOSES;
    fromUnix = reading.hourly_from_unix || null;
    stepS = HOUR_S;
  } else if (range === "30d") {
    all = reading.daily_usd;
    closes = DAILY_CLOSES;
    take = DAILY_CLOSES;
    fromUnix = reading.daily_from_unix || null;
    stepS = DAY_S;
  } else {
    return null;
  }
  if (!all) return null;
  const live = all.length === closes + 1;
  const values = all.slice(-(take + (live ? 1 : 0)));
  if (values.length < 2) return null;
  const offset = all.length - values.length; // index of values[0] in the whole series
  const times = fromUnix
    ? values.map((_, i) => (live && i === values.length - 1 ? null : (fromUnix + (offset + i) * stepS) * 1000))
    : null;
  return { range, values, times, daily: range === "30d", live };
}

/** Which ranges have data: { "24h": true, "48h": true, "30d": false }. */
export function availableRanges(reading) {
  const out = {};
  for (const r of RANGES) out[r] = !!rangeSeries(reading, r);
  return out;
}

/** The range to show: the wanted one if it has data, else the first that does, else null. */
export function pickRange(reading, wanted) {
  const ok = availableRanges(reading);
  if (wanted && ok[wanted]) return wanted;
  return RANGES.find((r) => ok[r]) || null;
}

/** "5 Oct, 14:00" for an hourly point, "5 Oct" for a daily one. */
export function formatPointTime(ms, daily, timeZone) {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone });
  return daily ? day : `${day}, ${clockTime(ms, timeZone)}`;
}

/* ── chart geometry ───────────────────────────────────────────────────── */

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Everything the chart draws, in a `width` × `height` box with `padTop` /
 * `padBottom` kept clear: the point coordinates, the stroke path, the area
 * path for the gradient, where the lowest and highest value are, and three
 * faint guides at a quarter, half and three quarters of the plot. Null under
 * two points. A flat series draws a level line through the middle.
 */
export function chartGeometry(values, { width, height, padTop = 2, padBottom = 2 }) {
  if (!Array.isArray(values) || values.length < 2) return null;
  for (const v of values) if (typeof v !== "number" || !Number.isFinite(v)) return null;
  let minIndex = 0;
  let maxIndex = 0;
  values.forEach((v, i) => {
    if (v < values[minIndex]) minIndex = i;
    if (v > values[maxIndex]) maxIndex = i;
  });
  const min = values[minIndex];
  const max = values[maxIndex];
  const span = max - min;
  const top = padTop;
  const bottom = height - padBottom;
  const innerH = bottom - top;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => [r2(i * stepX), r2(span === 0 ? top + innerH / 2 : bottom - ((v - min) / span) * innerH)]);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const area = `${line} L${r2(width)} ${height} L0 ${height} Z`;
  const guides = [0.25, 0.5, 0.75].map((f) => r2(top + innerH * f));
  return { points, line, area, min, max, minIndex, maxIndex, guides };
}

/** SVG path data for the card's small sparkline: { line, area }, or null. */
export function sparklinePaths(values, width, height, pad = 2) {
  const v = cleanSeries(values, HOURLY_MAX_POINTS);
  if (!v) return null;
  const g = chartGeometry(v, { width, height, padTop: pad, padBottom: pad });
  return { line: g.line, area: g.area };
}

/** The point under an x coordinate (in the same units as `width`), for the hover readout. */
export function nearestIndex(x, count, width) {
  if (!(count > 0) || !(width > 0) || !Number.isFinite(x)) return null;
  if (count === 1) return 0;
  const i = Math.round((x / width) * (count - 1));
  return Math.min(count - 1, Math.max(0, i));
}

/* ── the request ──────────────────────────────────────────────────────── */

/**
 * One GET to the relay. Never throws; `{ ok: true, reading }` or
 * `{ ok: false, error }`. No cookies, no referrer, no redirects, an 8 s
 * deadline and a 64 KiB cap on what is accepted.
 */
export async function fetchPrice({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PRICE_URL, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res || !res.ok) {
      // A 503 carries {"error":"unavailable"}; the status says enough.
      return { ok: false, error: `relay answered ${res ? res.status : "nothing"}` };
    }
    const declared = Number(res.headers && res.headers.get ? res.headers.get("content-length") : NaN);
    if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return { ok: false, error: "body too large" };
    const text = await res.text();
    return parsePriceDocument(text, now());
  } catch (e) {
    const aborted = controller.signal.aborted || (e && e.name === "AbortError");
    return { ok: false, error: aborted ? "relay did not answer in time" : "relay unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
