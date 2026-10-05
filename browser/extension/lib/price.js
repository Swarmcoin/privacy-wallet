/**
 * The SWM price, as the SWARM price relay reports it (specs/PRICE-DISPLAY.md).
 *
 * This is the extension's one network request of its own: an unauthenticated
 * GET to a fixed SWARM URL, carrying no address, no balance and no identifier.
 * The URL is a constant here and nowhere else; it is never taken from a
 * setting, a message or the relay's own answer.
 *
 * Everything below except `fetchPrice` is pure, so it can be tested with
 * `node --test` without a browser. Money is done in BigInt on decimal strings:
 * the relay sends the price as a string precisely so it is never a float, and
 * the fiat value of a balance is computed from the balance's zatoshis. It is a
 * display value, not an accounting one.
 */

/** The relay. Fixed in code (spec §2.2); the manifest's CSP allows this host and no other. */
export const PRICE_URL = "https://wallet.swarm.green/api/price/swm";
export const PRICE_SCHEMA = "swarm-price/1";

/** The listing page opened when the card is clicked, when the relay's own link does not check out. */
export const DEXSCREENER_FALLBACK_URL =
  "https://dexscreener.com/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599";
const DEXSCREENER_ORIGIN = "https://dexscreener.com";

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

const SPARK_MAX_POINTS = 48;
const SOURCE_NAMES = { geckoterminal: "GeckoTerminal", dexscreener: "DexScreener" };

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
 * The price as the card shows it: two decimals at 1 USD or more
 * ("$1.50", "$12,345.68"), otherwise four significant digits ("$0.8411",
 * "$0.00001235"). Rounded half-up. Null for anything that is not a positive
 * decimal string.
 */
export function formatUsdPrice(text) {
  const d = parseDecimal(text);
  if (!d || d.int <= 0n) return null;
  const one = 10n ** BigInt(d.scale);
  if (d.int >= one) {
    return `$${formatHundredths(divRoundHalfUp(d.int, d.scale - 2))}`;
  }
  // Under one: keep four significant digits.
  const digits = d.int.toString().length;
  const leadingZeros = d.scale - digits; // zeros between the point and the first digit
  let decimals = leadingZeros + 4;
  let rounded = divRoundHalfUp(d.int, d.scale - decimals);
  if (rounded >= 10n ** BigInt(decimals)) {
    // 0.99996 -> 1.00: the rounding carried into the units.
    return `$${formatHundredths(divRoundHalfUp(rounded, decimals - 2))}`;
  }
  if (rounded.toString().length > 4) {
    // 0.0099996 -> 0.01000: the carry added a significant digit; drop one decimal.
    rounded = divRoundHalfUp(rounded, 1);
    decimals -= 1;
  }
  return `$0.${rounded.toString().padStart(decimals, "0")}`;
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

/* ── the relay's document ─────────────────────────────────────────────── */

/**
 * The listing link to open. Only https://dexscreener.com, no credentials, no
 * port, no query, a /base/0x… path; anything else is the fixed URL.
 */
export function safeListingUrl(candidate) {
  if (typeof candidate !== "string" || candidate.length > 256) return DEXSCREENER_FALLBACK_URL;
  let u;
  try {
    u = new URL(candidate);
  } catch (_) {
    return DEXSCREENER_FALLBACK_URL;
  }
  if (u.origin !== DEXSCREENER_ORIGIN || u.username || u.password || u.search || u.hash) {
    return DEXSCREENER_FALLBACK_URL;
  }
  if (!/^\/base\/0x[0-9a-fA-F]{40,64}$/.test(u.pathname)) return DEXSCREENER_FALLBACK_URL;
  return u.href;
}

function finiteOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cleanSparkline(list) {
  if (!Array.isArray(list)) return null;
  const tail = list.slice(-SPARK_MAX_POINTS);
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
  const change = doc.change_pct && typeof doc.change_pct === "object" ? finiteOrNull(doc.change_pct.h24) : null;
  return {
    ok: true,
    reading: {
      price_usd: doc.price_usd,
      change_pct_h24: change,
      sparkline_usd: cleanSparkline(doc.sparkline_usd),
      generated_unix: doc.generated_unix,
      stale: doc.stale === true,
      source: knownSource(doc.source),
      dexscreener_url: safeListingUrl(doc.pool && doc.pool.dexscreener_url),
      fetchedAt,
    },
  };
}

/** The shape kept in chrome.storage.local under `swmPriceLast`. */
export function toStored(reading) {
  return {
    price_usd: reading.price_usd,
    change_pct_h24: reading.change_pct_h24,
    sparkline_usd: reading.sparkline_usd,
    generated_unix: reading.generated_unix,
    stale: reading.stale,
    source: reading.source,
    fetchedAt: reading.fetchedAt,
  };
}

/** A stored reading, checked again on the way out: storage is not a trusted source either. */
export function fromStored(stored) {
  if (!stored || typeof stored !== "object") return null;
  if (!isPositiveDecimal(stored.price_usd)) return null;
  if (!Number.isSafeInteger(stored.generated_unix) || stored.generated_unix <= 0) return null;
  if (typeof stored.fetchedAt !== "number" || !Number.isFinite(stored.fetchedAt)) return null;
  return {
    price_usd: stored.price_usd,
    change_pct_h24: finiteOrNull(stored.change_pct_h24),
    sparkline_usd: cleanSparkline(stored.sparkline_usd),
    generated_unix: stored.generated_unix,
    stale: stored.stale === true,
    source: knownSource(stored.source),
    dexscreener_url: DEXSCREENER_FALLBACK_URL,
    fetchedAt: stored.fetchedAt,
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

/** The 24 h change chip: "▲ 36.7 % 24h" up, "▼ 3.2 % 24h" down, "0.0 % 24h" flat; null when unknown. */
export function formatChange(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  if (rounded === 0) return { text: "0.0 % 24h", direction: "flat" };
  const text = `${rounded.toFixed(1)} % 24h`;
  return pct > 0 ? { text: `▲ ${text}`, direction: "up" } : { text: `▼ ${text}`, direction: "down" };
}

/* ── sparkline ────────────────────────────────────────────────────────── */

/**
 * SVG path data for the sparkline in a `width` × `height` box: `line` for the
 * stroke, `area` for the gradient fill underneath. Null under two points. A
 * flat series draws a level line through the middle.
 */
export function sparklinePaths(values, width, height, pad = 2) {
  const v = cleanSparkline(values);
  if (!v) return null;
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min;
  const innerH = height - 2 * pad;
  const stepX = width / (v.length - 1);
  const r = (n) => Math.round(n * 100) / 100;
  const points = v.map((value, i) => [
    r(i * stepX),
    r(span === 0 ? height / 2 : pad + innerH - ((value - min) / span) * innerH),
  ]);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const area = `${line} L${r(width)} ${height} L0 ${height} Z`;
  return { line, area };
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
