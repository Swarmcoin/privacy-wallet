/**
 * @jest-environment node
 */

/**
 * The main-process half of the SWM price: the one URL, the one host, the
 * deadline, the size cap, and the check of the relay's JSON
 * (specs/PRICE-DISPLAY.md §2.1, §2.2). `public/swmPrice.js` is plain
 * CommonJS that Electron runs as it is, so it is required here directly.
 */

const {
  SWM_PRICE_URL,
  SWM_PRICE_MAX_BYTES,
  SWM_LISTING_URLS,
  validateSwmPricePayload,
  fetchSwmPrice,
  isAppFrameUrl,
} = require("../../public/swmPrice");

const NOW = 1791223700;

// The specification's example document, as the relay is to serve it.
const RELAY_BODY = {
  schema: "swarm-price/1",
  symbol: "SWM",
  quote: "USD",
  price_usd: "0.84114343",
  price_eth: "0.000195976",
  change_pct: { h1: 0, h6: 28.75, h24: 36.72 },
  volume_24h_usd: 378.11,
  liquidity_usd: 3761.34,
  fdv_usd: 8411.43,
  source: "geckoterminal",
  sources: [
    { id: "geckoterminal", ok: true, price_usd: "0.84114343", fetched_unix: 1791223633 },
    { id: "dexscreener", ok: true, price_usd: "0.8602", fetched_unix: 1791223633 },
  ],
  sparkline_usd: [0.5259, 0.573, 0.6361, 0.6533, 0.7537, 0.8411],
  sparkline_hours: 48,
  pool: {
    chain: "base",
    dex: "uniswap-v4",
    id: "0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599",
    token: "0xf904C14d21bEF5b8a5345a666C77C9cc2A24043B",
  },
  generated_unix: 1791223633,
  refresh_seconds: 30,
  stale: false,
};

function response(body, { status = 200, headers = {} } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => text,
  };
}

describe("the URL and the host", () => {
  it("is the SWARM price service and nothing else", () => {
    expect(SWM_PRICE_URL).toBe("https://wallet.swarm.green/api/price/swm");
  });

  it("asks that URL with no credentials, no referrer and no redirects", async () => {
    const fetchImpl = jest.fn(async () => response(RELAY_BODY));
    await fetchSwmPrice(fetchImpl, { nowUnix: NOW });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SWM_PRICE_URL);
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(init.body).toBeUndefined();
  });

  it.each([
    "https://api.geckoterminal.com/api/v2/networks/base/pools/x",
    "https://wallet.swarm.green.evil.example/api/price/swm",
    "http://wallet.swarm.green/api/price/swm",
    "https://wallet.swarm.green:8443/api/price/swm",
    "not a url",
  ])("refuses %s without making a request", async (url) => {
    const fetchImpl = jest.fn();
    await expect(fetchSwmPrice(fetchImpl, { url })).resolves.toEqual({ ok: false, reason: "refused" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the relay's answer", () => {
  it("passes on only the checked fields", async () => {
    const result = await fetchSwmPrice(async () => response(RELAY_BODY), { nowUnix: NOW });
    expect(result).toEqual({
      ok: true,
      price: {
        priceUsd: "0.84114343",
        changePct24h: 36.72,
        sparklineUsd: [0.5259, 0.573, 0.6361, 0.6533, 0.7537, 0.8411],
        source: "geckoterminal",
        generatedUnix: 1791223633,
        stale: false,
        details: expect.any(Object),
      },
    });
  });

  it.each([
    ["another schema", { ...RELAY_BODY, schema: "swarm-price/2" }],
    ["no schema", { ...RELAY_BODY, schema: undefined }],
    ["a price as a number", { ...RELAY_BODY, price_usd: 0.84 }],
    ["a zero price", { ...RELAY_BODY, price_usd: "0.000" }],
    ["a negative price", { ...RELAY_BODY, price_usd: "-0.84" }],
    ["an exponent", { ...RELAY_BODY, price_usd: "8.4e-1" }],
    ["another token", { ...RELAY_BODY, symbol: "ZEC" }],
    ["another currency", { ...RELAY_BODY, quote: "EUR" }],
    ["no generation time", { ...RELAY_BODY, generated_unix: undefined }],
    ["a generation time an hour ahead", { ...RELAY_BODY, generated_unix: NOW + 3600 }],
    ["an array", [RELAY_BODY]],
    ["null", null],
  ])("refuses %s", (_label, body) => {
    expect(validateSwmPricePayload(body, NOW)).toEqual({ ok: false, reason: "schema" });
  });

  it("keeps the reading but drops a change or sparkline it cannot use", () => {
    const result = validateSwmPricePayload(
      { ...RELAY_BODY, change_pct: { h24: "36.7" }, sparkline_usd: [0.5, "x", 0.8], source: "somewhere" },
      NOW,
    );
    expect(result).toMatchObject({ ok: true, price: { changePct24h: null, sparklineUsd: null, source: null } });
  });

  it("keeps at most the last 49 sparkline points (48 closes and the live price)", () => {
    const points = Array.from({ length: 60 }, (_, i) => 0.5 + i / 100);
    const result = validateSwmPricePayload({ ...RELAY_BODY, sparkline_usd: points }, NOW);
    expect(result.price.sparklineUsd).toHaveLength(49);
    expect(result.price.sparklineUsd[48]).toBe(points[59]);
  });

  it("passes the relay's stale flag through", () => {
    expect(validateSwmPricePayload({ ...RELAY_BODY, stale: true }, NOW).price.stale).toBe(true);
  });

  it("reads the relay's 503 as unavailable", async () => {
    const result = await fetchSwmPrice(
      async () => response({ schema: "swarm-price/1", error: "unavailable" }, { status: 503 }),
      { nowUnix: NOW },
    );
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reads any other failure status as an HTTP failure", async () => {
    expect(await fetchSwmPrice(async () => response("<html>bad gateway</html>", { status: 502 }))).toEqual({
      ok: false,
      reason: "http",
    });
  });

  it("refuses a body that is not JSON", async () => {
    expect(await fetchSwmPrice(async () => response("<html>"))).toEqual({ ok: false, reason: "schema" });
  });
});

describe("the limits", () => {
  it("refuses a body declared larger than 64 KiB without reading it", async () => {
    const text = jest.fn();
    const result = await fetchSwmPrice(async () => ({
      ...response(RELAY_BODY, { headers: { "content-length": String(SWM_PRICE_MAX_BYTES + 1) } }),
      text,
    }));
    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(text).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body at 64 KiB", async () => {
    const chunk = new Uint8Array(16 * 1024);
    let reads = 0;
    const cancel = jest.fn(async () => undefined);
    const result = await fetchSwmPrice(async () => ({
      ...response(""),
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return reads > 100 ? { done: true } : { done: false, value: chunk };
          },
          cancel,
        }),
      },
    }));
    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(reads).toBe(5);
    expect(cancel).toHaveBeenCalled();
  });

  it("reads a streamed body under the cap", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(RELAY_BODY));
    let done = false;
    const result = await fetchSwmPrice(
      async () => ({
        ...response(""),
        body: {
          getReader: () => ({
            read: async () => {
              if (done) return { done: true };
              done = true;
              return { done: false, value: bytes };
            },
            cancel: async () => undefined,
          }),
        },
      }),
      { nowUnix: NOW },
    );
    expect(result).toMatchObject({ ok: true, price: { priceUsd: "0.84114343" } });
  });

  it("gives up after the deadline", async () => {
    const result = await fetchSwmPrice(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      { timeoutMs: 20 },
    );
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("answers a network failure without throwing", async () => {
    const result = await fetchSwmPrice(async () => {
      throw new TypeError("fetch failed");
    });
    expect(result).toEqual({ ok: false, reason: "network" });
  });
});

describe("the listing pages", () => {
  it("are the pool's DexScreener and GeckoTerminal pages, written out in full", () => {
    expect(SWM_LISTING_URLS).toEqual({
      dexscreener: "https://dexscreener.com/base/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599",
      geckoterminal:
        "https://www.geckoterminal.com/base/pools/0xf1e066d77279b388b40fdca7f5cf4a6559f77bdf9e2e8937ce9c2fe2960f4599",
    });
    expect(Object.isFrozen(SWM_LISTING_URLS)).toBe(true);
  });
});

describe("who may ask", () => {
  const PACKAGED = "file:///C:/Program%20Files/SWARM%20Wallet/resources/app.asar/build/index.html";

  it("accepts the packaged page, with the router's fragment", () => {
    expect(isAppFrameUrl(`${PACKAGED}#/dashboard`, PACKAGED)).toBe(true);
  });

  it("accepts the same path spelled with another drive-letter case where the file system ignores case", () => {
    const chromium = "file:///c:/Program%20Files/SWARM%20Wallet/resources/app.asar/build/index.html";
    expect(isAppFrameUrl(chromium, PACKAGED, { caseInsensitive: true })).toBe(true);
    expect(isAppFrameUrl(chromium, PACKAGED, { caseInsensitive: false })).toBe(false);
  });

  it("refuses another local file", () => {
    expect(isAppFrameUrl("file:///C:/Users/me/Downloads/page.html", PACKAGED, { caseInsensitive: true })).toBe(false);
  });

  it("refuses a web page", () => {
    expect(isAppFrameUrl("https://wallet.swarm.green/", PACKAGED)).toBe(false);
  });

  it("accepts the dev server and only it in development", () => {
    expect(isAppFrameUrl("http://localhost:3000/#/send", "http://localhost:3000")).toBe(true);
    expect(isAppFrameUrl("http://localhost:3001/", "http://localhost:3000")).toBe(false);
    expect(isAppFrameUrl("http://127.0.0.1:3000/", "http://localhost:3000")).toBe(false);
  });

  it("refuses a missing frame", () => {
    expect(isAppFrameUrl(undefined, PACKAGED)).toBe(false);
    expect(isAppFrameUrl("", PACKAGED)).toBe(false);
  });
});

describe("the handlers in electron.js", () => {
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(path.join(__dirname, "../../public/electron.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "../../public/preload.js"), "utf8");

  it.each(["price:swm", "price:open-listing"])("%s checks the sender before anything else", (channel) => {
    const at = source.indexOf(`ipcMain.handle("${channel}"`);
    expect(at).toBeGreaterThan(-1);
    const firstLine = source.slice(at).split("\n")[1];
    expect(firstLine).toMatch(/if \(!fromThisAppsPage\(event\)\) return \{ ok: false, reason: "refused" \};/);
  });

  it.each(["price:swm", "price:open-listing"])("%s is a channel the preload lets through", (channel) => {
    expect(preload).toContain(`"${channel}",`);
  });

  it("opens only the fixed listing URLs, never one from the renderer", () => {
    const at = source.indexOf('ipcMain.handle("price:open-listing"');
    const body = source.slice(at, source.indexOf("});", at));
    expect(body).toContain("SWM_LISTING_URLS");
    expect(body).not.toMatch(/openExternal\(which\)/);
  });
});

describe("the price page's fields (§6.1)", () => {
  const PAGE_BODY = {
    ...RELAY_BODY,
    hourly_from_unix: 1791054000,
    daily_usd: Array.from({ length: 30 }, (_, i) => 0.3 + i / 50),
    daily_from_unix: 1788652800, // 30 closes ending today (UTC), no live point
    transactions_24h: { buys: 9, sells: 0 },
    pool: { ...RELAY_BODY.pool, fee_pct: 0.9, created_unix: 1791100000 },
  };

  it("passes every one through after checking its type", () => {
    const result = validateSwmPricePayload(PAGE_BODY, NOW);
    expect(result.ok).toBe(true);
    expect(result.price.details).toEqual({
      priceEth: "0.000195976",
      changePct1h: 0,
      changePct6h: 28.75,
      hourlyFromUnix: 1791054000,
      hourlyEndsLive: false,
      dailyUsd: PAGE_BODY.daily_usd,
      dailyFromUnix: 1788652800,
      dailyEndsLive: false,
      transactions24h: { buys: 9, sells: 0 },
      liquidityUsd: 3761.34,
      volume24hUsd: 378.11,
      fdvUsd: 8411.43,
      poolFeePct: 0.9,
      poolCreatedUnix: 1791100000,
      sources: [
        { id: "geckoterminal", ok: true, priceUsd: "0.84114343", fetchedUnix: 1791223633 },
        { id: "dexscreener", ok: true, priceUsd: "0.8602", fetchedUnix: 1791223633 },
      ],
    });
  });

  it("never passes on the relay's pool id, token or listing URLs", () => {
    const text = JSON.stringify(validateSwmPricePayload(PAGE_BODY, NOW));
    expect(text).not.toContain("0xf1e066d7");
    expect(text).not.toContain("0xf904C14d");
    expect(text).not.toContain("https://");
  });

  it("turns each field of the wrong type into null, and keeps the reading", () => {
    const result = validateSwmPricePayload(
      {
        ...PAGE_BODY,
        price_eth: 0.000196,
        change_pct: { h1: "0", h6: null, h24: 36.72 },
        daily_usd: [0.5, -1, 0.7],
        daily_from_unix: "yesterday",
        hourly_from_unix: 12.5,
        transactions_24h: { buys: -1, sells: 0 },
        liquidity_usd: "3761",
        volume_24h_usd: Number.NaN,
        fdv_usd: -5,
        pool: { fee_pct: 900, created_unix: "x" },
        sources: [{ id: "evil", ok: true, price_usd: "1" }, { id: "dexscreener", ok: "yes", price_usd: 0.86 }, "x"],
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.price.priceUsd).toBe("0.84114343");
    expect(result.price.details).toEqual({
      priceEth: null,
      changePct1h: null,
      changePct6h: null,
      hourlyFromUnix: null,
      hourlyEndsLive: false,
      dailyUsd: null,
      dailyFromUnix: null,
      dailyEndsLive: false,
      transactions24h: null,
      liquidityUsd: null,
      volume24hUsd: null,
      fdvUsd: null,
      poolFeePct: null,
      poolCreatedUnix: null,
      sources: [{ id: "dexscreener", ok: false, priceUsd: null, fetchedUnix: null }],
    });
  });

  it("moves a series' first time with it when the series is cut to its last points", () => {
    const result = validateSwmPricePayload(
      {
        ...PAGE_BODY,
        sparkline_usd: Array.from({ length: 50 }, () => 0.8),
        daily_usd: Array.from({ length: 33 }, () => 0.8),
      },
      NOW,
    );
    expect(result.price.sparklineUsd).toHaveLength(49);
    expect(result.price.details.hourlyFromUnix).toBe(1791054000 + 1 * 3600);
    expect(result.price.details.dailyUsd).toHaveLength(31);
    expect(result.price.details.dailyFromUnix).toBe(1788652800 + 2 * 86400);
  });

  it("reads the live relay's answer of 2026-10-05 19:01 UTC, which has no daily series yet", () => {
    const live = require("./__fixtures__/relay-live-2026-10-05.json");
    const result = validateSwmPricePayload(live, 1791226900);
    expect(result.ok).toBe(true);
    expect(result.price).toMatchObject({ priceUsd: "0.84114343498587", changePct24h: 28.75 });
    expect(result.price.sparklineUsd).toHaveLength(48);
    expect(result.price.details).toMatchObject({
      priceEth: "0.000195976178807639",
      changePct1h: 0,
      changePct6h: 24.56,
      dailyUsd: null,
      liquidityUsd: 3770.24,
      transactions24h: null,
      poolFeePct: null,
    });
    expect(result.price.details.sources.map((s) => s.ok)).toEqual([true, true]);
  });
});

describe("the live price as the last value of each series (§6.1, amended)", () => {
  // generated_unix 1791223633 is 2026-10-05 17:27:13 UTC.
  const HOUR0 = 1791223200 - 47 * 3600; // 48 closes, the last one the current hour
  const DAY0 = 1791158400 - 29 * 86400; // 30 closes, the last one today (UTC)
  const LIVE_BODY = {
    ...RELAY_BODY,
    sparkline_usd: [...Array.from({ length: 48 }, () => 0.8), 0.84114343],
    hourly_from_unix: HOUR0,
    daily_usd: [...Array.from({ length: 30 }, () => 0.6), 0.84114343],
    daily_from_unix: DAY0,
  };

  it("keeps 48 + 1 hourly and 30 + 1 daily values, and marks the last as live", () => {
    const { price } = validateSwmPricePayload(LIVE_BODY, NOW);
    expect(price.sparklineUsd).toHaveLength(49);
    expect(price.details.dailyUsd).toHaveLength(31);
    expect(price.details).toMatchObject({
      hourlyFromUnix: HOUR0,
      hourlyEndsLive: true,
      dailyFromUnix: DAY0,
      dailyEndsLive: true,
    });
  });

  it("does not take the last close for the live price when the relay has not appended one", () => {
    const { price } = validateSwmPricePayload(
      {
        ...LIVE_BODY,
        sparkline_usd: LIVE_BODY.sparkline_usd.slice(0, 48),
        daily_usd: LIVE_BODY.daily_usd.slice(0, 30),
      },
      NOW,
    );
    expect(price.details).toMatchObject({ hourlyEndsLive: false, dailyEndsLive: false });
  });

  it("finds the live point in a young pool's short series by its time", () => {
    const { price } = validateSwmPricePayload(
      {
        ...LIVE_BODY,
        sparkline_usd: [0.5, 0.6, 0.7, 0.84],
        hourly_from_unix: 1791223200 - 2 * 3600,
        daily_usd: [0.5, 0.84],
        daily_from_unix: 1791158400,
      },
      NOW,
    );
    expect(price.details).toMatchObject({ hourlyEndsLive: true, dailyEndsLive: true });
  });

  it("without start times, takes a series one longer than its close count to end live", () => {
    const { price } = validateSwmPricePayload(
      { ...LIVE_BODY, hourly_from_unix: undefined, daily_from_unix: undefined },
      NOW,
    );
    expect(price.details).toMatchObject({
      hourlyFromUnix: null,
      hourlyEndsLive: true,
      dailyFromUnix: null,
      dailyEndsLive: true,
    });
    const closesOnly = validateSwmPricePayload(
      {
        ...LIVE_BODY,
        hourly_from_unix: undefined,
        daily_from_unix: undefined,
        sparkline_usd: LIVE_BODY.sparkline_usd.slice(1),
        daily_usd: LIVE_BODY.daily_usd.slice(1),
      },
      NOW,
    );
    expect(closesOnly.price.details).toMatchObject({ hourlyEndsLive: false, dailyEndsLive: false });
  });

  it("trims a longer series from the front, moving the start time on and keeping the live point", () => {
    const { price } = validateSwmPricePayload(
      {
        ...LIVE_BODY,
        sparkline_usd: [0.1, 0.2, ...LIVE_BODY.sparkline_usd],
        hourly_from_unix: HOUR0 - 2 * 3600,
        daily_usd: [0.1, ...LIVE_BODY.daily_usd],
        daily_from_unix: DAY0 - 86400,
      },
      NOW,
    );
    expect(price.sparklineUsd).toEqual(LIVE_BODY.sparkline_usd);
    expect(price.details).toMatchObject({
      hourlyFromUnix: HOUR0,
      hourlyEndsLive: true,
      dailyFromUnix: DAY0,
      dailyEndsLive: true,
    });
    expect(price.details.dailyUsd).toEqual(LIVE_BODY.daily_usd);
  });
});
