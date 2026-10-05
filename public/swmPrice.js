// The SWM price, read by the main process from the SWARM price service.
//
// Specification: specs/PRICE-DISPLAY.md in the project repository (§2.1 the
// relay's JSON, §2.2 what a wallet may do with it).
//
// Why main and not the renderer: the renderer's CSP is `connect-src 'self'`
// and stays that way. The renderer asks for "the price" and gets back a small,
// already-checked object; it never names a URL. The URL, the one host it may
// reach, the deadline and the size cap all live here, so a compromised
// renderer cannot turn this into a fetch of anything else.
//
// Why a relay and not GeckoTerminal or DexScreener directly: a wallet that
// called an aggregator would tell a third party, once a minute, that this IP
// runs a SWARM wallet. The relay is a SWARM host; the request carries no
// address, no balance and no identifier.
//
// This request travels over clearnet, like `treasury:relay`. It does not ride
// the mixnet, and the documentation says so (docs/swap-privacy.md, "The SWM
// price"). What it reveals is that this IP runs a SWARM wallet with the price
// switched on, to a SWARM host; nothing about the wallet's contents.
//
// Kept out of electron.js so it can be tested without Electron.

const SWM_PRICE_URL = "https://wallet.swarm.green/api/price/swm";
const SWM_PRICE_HOSTS = new Set(["wallet.swarm.green"]);
const SWM_PRICE_TIMEOUT_MS = 8000;
const SWM_PRICE_MAX_BYTES = 64 * 1024;
const SWM_PRICE_SCHEMA = "swarm-price/1";

// The listing pages the price card may open. Fixed here, not taken from the
// relay's answer: the relay names them too, but a page the wallet opens in the
// system browser is chosen by the wallet. The pool is the SWM/ETH Uniswap v4
// pool on Base (specs/PRICE-DISPLAY.md §1).
const SWM_POOL_ID = "0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599";
const SWM_LISTING_URLS = Object.freeze({
  dexscreener: `https://dexscreener.com/base/${SWM_POOL_ID}`,
  geckoterminal: `https://www.geckoterminal.com/base/pools/${SWM_POOL_ID}`,
});

// A positive decimal, as a string: no sign, no exponent, no leading zeros
// beyond one, at most 12 whole digits and 18 decimals. "0" and "0.000" match
// the shape and are refused separately, because a price of zero is not a price.
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,18})?$/;
const SPARKLINE_MAX_POINTS = 48;
const KNOWN_SOURCES = new Set(["geckoterminal", "dexscreener"]);

function isPositiveDecimal(value) {
  return typeof value === "string" && DECIMAL_PATTERN.test(value) && /[1-9]/.test(value);
}

function finiteOrNull(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/**
 * Turns the relay's JSON into the only shape the renderer ever receives.
 *
 * Answers `{ ok: true, price }` or `{ ok: false, reason }`. Every field the
 * renderer gets is copied out by name and checked; nothing else in the body
 * crosses the bridge. Fields the display can do without (the change, the
 * sparkline, the source) degrade to null rather than failing the reading;
 * the schema and the price itself do not.
 */
function validateSwmPricePayload(body, nowUnix) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "schema" };
  if (body.schema !== SWM_PRICE_SCHEMA) return { ok: false, reason: "schema" };
  if (body.error === "unavailable") return { ok: false, reason: "unavailable" };
  // Present in the specification's document; if a relay sends them, they have
  // to be the ones this wallet displays.
  if (body.symbol !== undefined && body.symbol !== "SWM") return { ok: false, reason: "schema" };
  if (body.quote !== undefined && body.quote !== "USD") return { ok: false, reason: "schema" };
  if (!isPositiveDecimal(body.price_usd)) return { ok: false, reason: "schema" };

  const generated = body.generated_unix;
  // A reading from before this feature existed, or from more than ten minutes
  // in the future by this machine's clock, is not one to show as current.
  const now = typeof nowUnix === "number" ? nowUnix : Math.floor(Date.now() / 1000);
  if (!Number.isInteger(generated) || generated < 1_700_000_000 || generated > now + 600) {
    return { ok: false, reason: "schema" };
  }

  const change = body.change_pct && typeof body.change_pct === "object" ? body.change_pct.h24 : undefined;
  let sparkline = null;
  if (Array.isArray(body.sparkline_usd)) {
    const points = body.sparkline_usd.slice(-SPARKLINE_MAX_POINTS);
    if (points.length >= 2 && points.every((p) => typeof p === "number" && Number.isFinite(p) && p > 0)) {
      sparkline = points;
    }
  }

  return {
    ok: true,
    price: {
      priceUsd: body.price_usd,
      changePct24h: finiteOrNull(change, -100, 1_000_000),
      sparklineUsd: sparkline,
      source: KNOWN_SOURCES.has(body.source) ? body.source : null,
      generatedUnix: generated,
      stale: body.stale === true,
    },
  };
}

/** Reads a body up to the cap, and refuses it rather than truncating past it. */
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    return Buffer.byteLength(text, "utf8") > maxBytes ? null : text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One GET to the price service. Never throws: every failure is a reason, and
 * the renderer keeps its last good reading whatever the reason is.
 *
 * `fetchImpl` is the global fetch in the app and a fake in the tests.
 */
async function fetchSwmPrice(fetchImpl, options = {}) {
  const url = options.url ?? SWM_PRICE_URL;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "refused" };
  }
  if (parsed.protocol !== "https:" || !SWM_PRICE_HOSTS.has(parsed.hostname) || parsed.port !== "") {
    return { ok: false, reason: "refused" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SWM_PRICE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(parsed.toString(), {
      method: "GET",
      // A redirect would be a second host this request was never meant to
      // reach. The relay does not redirect; if it starts to, this fails.
      redirect: "error",
      // Nothing about the wallet goes along: no cookies, no referrer, no
      // credentials. The request is the URL and nothing else.
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await readCapped(response, SWM_PRICE_MAX_BYTES);
    if (text === null) return { ok: false, reason: "too-large" };
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, reason: response.ok ? "schema" : "http" };
    }
    if (!response.ok) {
      // The relay's own "no good reading for an hour" answer.
      if (response.status === 503 && body && body.schema === SWM_PRICE_SCHEMA && body.error === "unavailable") {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: false, reason: "http" };
    }
    return validateSwmPricePayload(body, options.nowUnix);
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether an IPC call comes from this application's own page.
 *
 * The page is `http://localhost:3000` in development and the packaged
 * `build/index.html` otherwise; `appUrl` is whichever of those main loaded.
 * Compared without the query and fragment (the router lives in the fragment),
 * and exactly otherwise, so another file:// page or another local port does
 * not pass.
 */
function isAppFrameUrl(frameUrl, appUrl, options = {}) {
  if (typeof frameUrl !== "string" || typeof appUrl !== "string") return false;
  let frame;
  let app;
  try {
    frame = new URL(frameUrl);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (app.protocol === "file:") {
    if (frame.protocol !== "file:" || frame.host !== app.host) return false;
    // Chromium and Node spell the same file path slightly differently
    // (percent-encoding, the drive letter's case), and Windows and macOS
    // file systems do not distinguish case. Compared as decoded paths, and
    // without case where the file system ignores it.
    const norm = (pathname) => {
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        return null;
      }
      return options.caseInsensitive ? decoded.toLowerCase() : decoded;
    };
    const a = norm(frame.pathname);
    return a !== null && a === norm(app.pathname);
  }
  return frame.origin === app.origin;
}

module.exports = {
  SWM_PRICE_URL,
  SWM_PRICE_HOSTS,
  SWM_PRICE_TIMEOUT_MS,
  SWM_PRICE_MAX_BYTES,
  SWM_PRICE_SCHEMA,
  SWM_LISTING_URLS,
  validateSwmPricePayload,
  fetchSwmPrice,
  isAppFrameUrl,
};
