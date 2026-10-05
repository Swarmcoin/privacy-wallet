import type {
  SwmPriceDetails,
  SwmPriceIpcResult,
  SwmPriceSource,
  SwmPriceSourceReading,
  SwmPriceState,
  SwmPriceStatus,
} from "./swmPriceTypes";
import { EMPTY_SWM_PRICE_DETAILS, SWM_PRICE_OFF } from "./swmPriceTypes";

/**
 * The SWM price service on the renderer side: a pure freshness rule and a
 * small poller (specs/PRICE-DISPLAY.md §2.2).
 *
 *   - one request a minute, only while the window is visible, the wallet is
 *     open and unlocked, the build and the wallet are SWARM mainnet, and the
 *     setting is on (the hook in `useSwmPrice.ts` decides that; this file
 *     only starts and stops);
 *   - a bad or missing answer never replaces a good reading: the last good
 *     one stays and ages;
 *   - the last good reading is kept in local storage, and on start it is
 *     shown greyed until the first fresh read.
 *
 * Deliberately not `zecPrice`: that is the upstream ZEC price, always 0 on
 * SWARM, fetched by the SDK over the mixnet. The two share nothing.
 */

export const SWM_PRICE_POLL_MS = 60_000;
export const FRESH_MS = 5 * 60_000;
export const STALE_MS = 30 * 60_000;
export const UNAVAILABLE_MS = 60 * 60_000;

/** A good reading, with the moment this machine received it. */
export type SwmPriceReading = {
  priceUsd: string;
  changePct24h: number | null;
  sparklineUsd: number[] | null;
  source: SwmPriceSource | null;
  generatedUnix: number;
  fetchedAtMs: number;
  relayStale: boolean;
  details: SwmPriceDetails;
};

/**
 * The freshness of a reading.
 *
 * Age is measured from when this machine received it, not from the relay's
 * `generated_unix`, so a clock that is a few minutes off does not grey a
 * price that just arrived. The relay's own `stale` flag covers the other
 * case: a relay that is answering but has not reached an aggregator.
 */
export function statusFor(
  reading: SwmPriceReading | null,
  nowMs: number,
  options: { fromCache?: boolean } = {},
): SwmPriceStatus {
  if (!reading) return "unavailable";
  const age = Math.max(0, nowMs - reading.fetchedAtMs);
  if (age > UNAVAILABLE_MS) return "unavailable";
  if (age > STALE_MS || reading.relayStale) return "stale";
  if (age >= FRESH_MS || options.fromCache) return "ageing";
  return "fresh";
}

export function stateFor(reading: SwmPriceReading | null, status: SwmPriceStatus, pending = false): SwmPriceState {
  if (status === "off") return SWM_PRICE_OFF;
  if (!reading) return { ...SWM_PRICE_OFF, status, pending };
  return {
    priceUsd: reading.priceUsd,
    changePct24h: reading.changePct24h,
    sparklineUsd: reading.sparklineUsd,
    source: reading.source,
    generatedUnix: reading.generatedUnix,
    fetchedAtMs: reading.fetchedAtMs,
    status,
    pending: false,
    details: reading.details,
  };
}

/** Whether a price should be drawn at all (dimmed or not). */
export const priceIsShown = (state: SwmPriceState): boolean =>
  state.priceUsd !== null && (state.status === "fresh" || state.status === "ageing" || state.status === "stale");

/** Greyed: older than five minutes, from the cache, or flagged by the relay. */
export const priceIsDimmed = (state: SwmPriceState): boolean => state.status === "ageing" || state.status === "stale";

export const SWM_PRICE_STORAGE_KEY = "swarm.swmPrice.last.v1";

const DECIMAL = /^(0|[1-9]\d{0,11})(\.\d{1,18})?$/;
const SOURCES: SwmPriceSource[] = ["geckoterminal", "dexscreener"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const seriesOrNull = (v: unknown, max: number): number[] | null =>
  Array.isArray(v) && v.length >= 2 && v.every((p) => isNum(p) && p > 0) ? (v as number[]).slice(-max) : null;
const decimalOrNull = (v: unknown): string | null =>
  typeof v === "string" && DECIMAL.test(v) && /[1-9]/.test(v) ? v : null;

/**
 * The page's fields as stored with a reading, checked again on the way back
 * in: local storage is not main's validated answer, and a field from an older
 * or damaged entry becomes null rather than reaching the screen.
 */
export function parseDetails(value: unknown): SwmPriceDetails {
  if (!isRecord(value)) return EMPTY_SWM_PRICE_DETAILS;
  const tx = isRecord(value.transactions24h) ? value.transactions24h : null;
  const sources: SwmPriceSourceReading[] = Array.isArray(value.sources)
    ? value.sources
        .filter((s): s is Record<string, unknown> => isRecord(s) && SOURCES.includes(s.id as SwmPriceSource))
        .slice(0, 4)
        .map((s) => ({
          id: s.id as SwmPriceSource,
          ok: s.ok === true,
          priceUsd: decimalOrNull(s.priceUsd),
          fetchedUnix: numOrNull(s.fetchedUnix),
        }))
    : [];
  return {
    priceEth: decimalOrNull(value.priceEth),
    changePct1h: numOrNull(value.changePct1h),
    changePct6h: numOrNull(value.changePct6h),
    hourlyFromUnix: numOrNull(value.hourlyFromUnix),
    hourlyEndsLive: value.hourlyEndsLive === true,
    dailyUsd: seriesOrNull(value.dailyUsd, 31),
    dailyFromUnix: numOrNull(value.dailyFromUnix),
    dailyEndsLive: value.dailyEndsLive === true,
    transactions24h:
      tx && isNum(tx.buys) && isNum(tx.sells) && tx.buys >= 0 && tx.sells >= 0
        ? { buys: tx.buys, sells: tx.sells }
        : null,
    liquidityUsd: numOrNull(value.liquidityUsd),
    volume24hUsd: numOrNull(value.volume24hUsd),
    fdvUsd: numOrNull(value.fdvUsd),
    poolFeePct: numOrNull(value.poolFeePct),
    poolCreatedUnix: numOrNull(value.poolCreatedUnix),
    sources,
  };
}

/** A stored reading, if it still has the shape this version wrote. */
export function parseStoredReading(text: string | null): SwmPriceReading | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.priceUsd !== "string" || !DECIMAL.test(r.priceUsd) || !/[1-9]/.test(r.priceUsd)) return null;
  if (!isNum(r.fetchedAtMs) || !isNum(r.generatedUnix)) return null;
  const sparkline =
    Array.isArray(r.sparklineUsd) && r.sparklineUsd.length >= 2 && r.sparklineUsd.every((p) => isNum(p) && p > 0)
      ? (r.sparklineUsd as number[]).slice(-49)
      : null;
  return {
    priceUsd: r.priceUsd,
    changePct24h: isNum(r.changePct24h) ? r.changePct24h : null,
    sparklineUsd: sparkline,
    source: SOURCES.includes(r.source as SwmPriceSource) ? (r.source as SwmPriceSource) : null,
    generatedUnix: r.generatedUnix,
    fetchedAtMs: r.fetchedAtMs,
    relayStale: r.relayStale === true,
    details: parseDetails(r.details),
  };
}

export type StorageLike = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };

export type SwmPricePollerDeps = {
  fetchPrice: () => Promise<SwmPriceIpcResult>;
  onChange: (state: SwmPriceState) => void;
  now?: () => number;
  storage?: StorageLike | null;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

type ResolvedDeps = {
  fetchPrice: () => Promise<SwmPriceIpcResult>;
  onChange: (state: SwmPriceState) => void;
  now: () => number;
  storage: StorageLike | null;
  intervalMs: number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export class SwmPricePoller {
  private reading: SwmPriceReading | null = null;
  private fromCache = false;
  private restored = false;
  private timer: unknown = null;
  /** The generation a request is in flight for, if any. */
  private inFlightFor: number | null = null;
  /** Bumped on every stop, so an answer that lands after a stop is dropped. */
  private generation = 0;
  private readonly deps: ResolvedDeps;

  constructor(deps: SwmPricePollerDeps) {
    this.deps = {
      now: deps.now ?? (() => Date.now()),
      storage: deps.storage ?? null,
      intervalMs: deps.intervalMs ?? SWM_PRICE_POLL_MS,
      setInterval: deps.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>)),
      fetchPrice: deps.fetchPrice,
      onChange: deps.onChange,
    };
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** The current state, recomputed against the clock. */
  current(): SwmPriceState {
    const status = statusFor(this.reading, this.deps.now(), { fromCache: this.fromCache });
    return stateFor(this.reading, status, this.inFlightFor !== null && this.inFlightFor === this.generation);
  }

  /** Loads the last good reading from storage, once. It shows greyed until a fresh one arrives. */
  restore(): void {
    if (this.restored) return;
    this.restored = true;
    if (this.reading) return;
    let text: string | null = null;
    try {
      text = this.deps.storage?.getItem(SWM_PRICE_STORAGE_KEY) ?? null;
    } catch {
      text = null;
    }
    const stored = parseStoredReading(text);
    if (stored) {
      this.reading = stored;
      this.fromCache = true;
    }
  }

  /** Starts polling: one request now, then one per interval. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.setInterval(() => void this.poll(), this.deps.intervalMs);
    // The request goes first so the state published next already says one
    // is on its way.
    void this.poll();
    this.emit();
  }

  /** Stops polling. An answer already on its way is ignored when it lands. */
  stop(): void {
    this.generation += 1;
    if (this.timer !== null) {
      this.deps.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Re-publishes the state, so its freshness follows the clock between polls. */
  emit(): void {
    this.deps.onChange(this.current());
  }

  async poll(): Promise<void> {
    // One request at a time per run. A request left over from before a stop
    // does not hold up the first one of the next run: it is ignored when it
    // lands, so the new one can go now.
    const generation = this.generation;
    if (this.inFlightFor === generation) return;
    this.inFlightFor = generation;
    let result: SwmPriceIpcResult;
    try {
      result = await this.deps.fetchPrice();
    } catch {
      result = { ok: false, reason: "network" };
    } finally {
      if (this.inFlightFor === generation) this.inFlightFor = null;
    }
    if (generation !== this.generation) return;
    if (result && result.ok === true && result.price) {
      const p = result.price;
      this.reading = {
        priceUsd: p.priceUsd,
        changePct24h: p.changePct24h,
        sparklineUsd: p.sparklineUsd,
        source: p.source,
        generatedUnix: p.generatedUnix,
        fetchedAtMs: this.deps.now(),
        relayStale: p.stale,
        details: p.details ?? EMPTY_SWM_PRICE_DETAILS,
      };
      this.fromCache = false;
      try {
        this.deps.storage?.setItem(SWM_PRICE_STORAGE_KEY, JSON.stringify(this.reading));
      } catch {
        // A full or unavailable storage costs only the greyed price on the next start.
      }
    }
    this.emit();
  }
}

/**
 * Whether the wallet may ask for the price at all.
 *
 * Every condition is a "no request" condition: the setting has not loaded yet
 * or is off; the build is a test-coin build; the open wallet is not a SWARM
 * mainnet wallet (a mainnet build can hold a testnet wallet, whose coins have
 * no price); no wallet is open; the wallet is locked.
 */
export function swmPriceAllowed(conditions: {
  setting: boolean | null;
  testCoinBuild: boolean;
  walletIsMainnet: boolean;
  walletOpen: boolean;
  locked: boolean;
}): boolean {
  return (
    conditions.setting === true &&
    !conditions.testCoinBuild &&
    conditions.walletIsMainnet &&
    conditions.walletOpen &&
    !conditions.locked
  );
}
