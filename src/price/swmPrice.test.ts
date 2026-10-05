/**
 * The renderer half of the SWM price: freshness, the poller, the cache and
 * the gate (specs/PRICE-DISPLAY.md §2.2), against a fake clock.
 */
import {
  FRESH_MS,
  STALE_MS,
  SWM_PRICE_STORAGE_KEY,
  SwmPricePoller,
  SwmPriceReading,
  UNAVAILABLE_MS,
  parseStoredReading,
  priceIsDimmed,
  priceIsShown,
  statusFor,
  swmPriceAllowed,
} from "./swmPrice";
import { SWM_PRICE_OFF, SwmPriceIpcResult, SwmPriceState } from "./swmPriceTypes";

const T0 = 1_791_223_700_000;

const READING: SwmPriceReading = {
  priceUsd: "0.84114343",
  changePct24h: 36.72,
  sparklineUsd: [0.5259, 0.573, 0.6361],
  source: "geckoterminal",
  generatedUnix: 1791223633,
  fetchedAtMs: T0,
  relayStale: false,
};

const GOOD: SwmPriceIpcResult = {
  ok: true,
  price: {
    priceUsd: "0.84114343",
    changePct24h: 36.72,
    sparklineUsd: [0.5259, 0.573, 0.6361],
    source: "geckoterminal",
    generatedUnix: 1791223633,
    stale: false,
  },
};

describe("freshness", () => {
  it.each([
    [0, "fresh"],
    [FRESH_MS - 1, "fresh"],
    [FRESH_MS, "ageing"],
    [STALE_MS, "ageing"],
    [STALE_MS + 1, "stale"],
    [UNAVAILABLE_MS, "stale"],
    [UNAVAILABLE_MS + 1, "unavailable"],
  ])("a reading %i ms old is %s", (age, status) => {
    expect(statusFor(READING, T0 + age)).toBe(status);
  });

  it("is unavailable with no reading at all", () => {
    expect(statusFor(null, T0)).toBe("unavailable");
  });

  it("is stale at once when the relay says its own reading is stale", () => {
    expect(statusFor({ ...READING, relayStale: true }, T0)).toBe("stale");
  });

  it("shows a cached reading greyed until a fresh one arrives", () => {
    expect(statusFor(READING, T0 + 1000, { fromCache: true })).toBe("ageing");
    expect(statusFor(READING, T0 + UNAVAILABLE_MS + 1, { fromCache: true })).toBe("unavailable");
  });

  it("does not let a clock behind the reading make it younger than new", () => {
    expect(statusFor(READING, T0 - 10 * 60_000)).toBe("fresh");
  });

  it("draws fresh, ageing and stale prices, greys the latter two, and draws nothing otherwise", () => {
    const at = (status: SwmPriceState["status"]): SwmPriceState => ({ ...SWM_PRICE_OFF, priceUsd: "0.84", status });
    expect([at("fresh"), at("ageing"), at("stale")].map(priceIsShown)).toEqual([true, true, true]);
    expect([at("unavailable"), at("off")].map(priceIsShown)).toEqual([false, false]);
    expect([at("fresh"), at("ageing"), at("stale")].map(priceIsDimmed)).toEqual([false, true, true]);
  });
});

describe("the poller", () => {
  type Harness = {
    poller: SwmPricePoller;
    states: SwmPriceState[];
    fetchPrice: jest.Mock<Promise<SwmPriceIpcResult>, []>;
    tick: () => Promise<void>;
    clock: { now: number };
    store: Map<string, string>;
    timers: Set<() => void>;
  };

  function harness(answers: SwmPriceIpcResult[] = [GOOD], seed?: string): Harness {
    const clock = { now: T0 };
    const states: SwmPriceState[] = [];
    const timers = new Set<() => void>();
    const store = new Map<string, string>();
    if (seed) store.set(SWM_PRICE_STORAGE_KEY, seed);
    const queue = [...answers];
    const fetchPrice = jest.fn(async () => queue.shift() ?? { ok: false as const, reason: "network" as const });
    const poller = new SwmPricePoller({
      fetchPrice,
      onChange: (s) => states.push(s),
      now: () => clock.now,
      storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
      setInterval: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearInterval: (handle) => void timers.delete(handle as () => void),
    });
    const tick = async () => {
      clock.now += 60_000;
      timers.forEach((fn) => fn());
      await flush();
    };
    return { poller, states, fetchPrice, tick, clock, store, timers };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const last = (h: Harness) => h.states[h.states.length - 1];

  it("asks once at start and once a minute after", async () => {
    const h = harness([GOOD, GOOD, GOOD]);
    h.poller.start();
    await flush();
    expect(h.fetchPrice).toHaveBeenCalledTimes(1);
    expect(last(h)).toMatchObject({ priceUsd: "0.84114343", status: "fresh", fetchedAtMs: T0 });
    await h.tick();
    await h.tick();
    expect(h.fetchPrice).toHaveBeenCalledTimes(3);
  });

  it("makes no request once stopped, and none twice for a double start", async () => {
    const h = harness();
    h.poller.start();
    h.poller.start();
    await flush();
    expect(h.fetchPrice).toHaveBeenCalledTimes(1);
    h.poller.stop();
    expect(h.timers.size).toBe(0);
    await h.tick();
    expect(h.fetchPrice).toHaveBeenCalledTimes(1);
  });

  it("ignores an answer that lands after a stop", async () => {
    let resolve: (r: SwmPriceIpcResult) => void = () => undefined;
    const h = harness();
    h.fetchPrice.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    h.poller.start();
    h.poller.stop();
    resolve(GOOD);
    await flush();
    expect(h.states.every((s) => s.priceUsd === null)).toBe(true);
  });

  it("does not let a request left over from a stop hold up the next start", async () => {
    const h = harness();
    h.fetchPrice.mockImplementationOnce(() => new Promise(() => undefined));
    h.poller.start();
    h.poller.stop();
    h.poller.start();
    await flush();
    expect(h.fetchPrice).toHaveBeenCalledTimes(2);
    expect(last(h).status).toBe("fresh");
  });

  it("keeps the last good price through failures, and lets it age", async () => {
    const h = harness([GOOD]);
    h.poller.start();
    await flush();
    for (let i = 0; i < 6; i += 1) await h.tick();
    expect(last(h)).toMatchObject({ priceUsd: "0.84114343", status: "ageing" });
    for (let i = 0; i < 25; i += 1) await h.tick();
    expect(last(h)).toMatchObject({ priceUsd: "0.84114343", status: "stale" });
    for (let i = 0; i < 30; i += 1) await h.tick();
    expect(last(h).status).toBe("unavailable");
  });

  it.each<[string, SwmPriceIpcResult]>([
    ["a refused schema", { ok: false, reason: "schema" }],
    ["the relay's 503", { ok: false, reason: "unavailable" }],
    ["a timeout", { ok: false, reason: "timeout" }],
  ])("does not replace a good price with %s", async (_label, failure) => {
    const h = harness([GOOD, failure]);
    h.poller.start();
    await flush();
    await h.tick();
    expect(last(h)).toMatchObject({ priceUsd: "0.84114343", fetchedAtMs: T0 });
  });

  it("survives a fetch that throws", async () => {
    const h = harness();
    h.fetchPrice.mockImplementationOnce(async () => {
      throw new Error("ipc gone");
    });
    h.poller.start();
    await flush();
    expect(last(h).status).toBe("unavailable");
  });

  it("stores each good reading, and shows a stored one greyed on the next start", async () => {
    const first = harness([GOOD]);
    first.poller.start();
    await flush();
    const stored = first.store.get(SWM_PRICE_STORAGE_KEY);
    expect(stored).toBeTruthy();

    const second = harness([{ ok: false, reason: "network" }], stored);
    second.clock.now = T0 + 2 * 60_000;
    second.poller.restore();
    expect(second.poller.current()).toMatchObject({ priceUsd: "0.84114343", status: "ageing" });
    second.poller.start();
    await flush();
    expect(last(second).status).toBe("ageing");
  });

  it("drops the greying once a fresh reading arrives", async () => {
    const seed = JSON.stringify({ ...READING, fetchedAtMs: T0 - 60_000 });
    const h = harness([GOOD], seed);
    h.poller.restore();
    h.poller.start();
    await flush();
    expect(last(h).status).toBe("fresh");
  });

  it("carries the relay's stale flag", async () => {
    if (!GOOD.ok) throw new Error("fixture");
    const h = harness([{ ok: true, price: { ...GOOD.price, stale: true } }]);
    h.poller.start();
    await flush();
    expect(last(h).status).toBe("stale");
  });
});

describe("stored readings", () => {
  it("reads back what the poller writes", () => {
    expect(parseStoredReading(JSON.stringify(READING))).toEqual(READING);
  });

  it.each([
    ["nothing", null],
    ["not JSON", "{"],
    ["a zero price", JSON.stringify({ ...READING, priceUsd: "0" })],
    ["a number price", JSON.stringify({ ...READING, priceUsd: 0.84 })],
    ["no time", JSON.stringify({ ...READING, fetchedAtMs: undefined })],
  ])("refuses %s", (_label, text) => {
    expect(parseStoredReading(text)).toBeNull();
  });
});

describe("the gate", () => {
  const all = { setting: true, testCoinBuild: false, walletIsMainnet: true, walletOpen: true, locked: false };

  it("allows requests when every condition holds", () => {
    expect(swmPriceAllowed(all)).toBe(true);
  });

  it.each([
    ["the setting is off", { setting: false }],
    ["the setting has not loaded", { setting: null }],
    ["the build is a test-coin build", { testCoinBuild: true }],
    ["the wallet is a testnet wallet", { walletIsMainnet: false }],
    ["no wallet is open", { walletOpen: false }],
    ["the wallet is locked", { locked: true }],
  ])("allows none when %s", (_label, change) => {
    expect(swmPriceAllowed({ ...all, ...change })).toBe(false);
  });
});
