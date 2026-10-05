/**
 * The SWM price as the renderer sees it.
 *
 * The main process reads the SWARM price service (specs/PRICE-DISPLAY.md
 * §2.1), checks the JSON and hands over only the fields below
 * (`public/swmPrice.js`, `validateSwmPricePayload`). The renderer never
 * fetches and never names a URL.
 */

/** Where the relay says its price came from. */
export type SwmPriceSource = "geckoterminal" | "dexscreener";

/** One aggregator's own reading, as the relay reports it. */
export type SwmPriceSourceReading = {
  id: SwmPriceSource;
  ok: boolean;
  priceUsd: string | null;
  fetchedUnix: number | null;
};

/**
 * What the price page shows beyond the card (specs/PRICE-DISPLAY.md §6.1).
 * Every field is optional at the relay and null here when it is missing or
 * did not pass main's type check.
 */
export type SwmPriceDetails = {
  /** A positive decimal string. */
  priceEth: string | null;
  changePct1h: number | null;
  changePct6h: number | null;
  /** The hour of the first `sparklineUsd` value. */
  hourlyFromUnix: number | null;
  /** Daily closes, oldest first, 2 to 30 points. */
  dailyUsd: number[] | null;
  /** The day of the first `dailyUsd` value. */
  dailyFromUnix: number | null;
  transactions24h: { buys: number; sells: number } | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
  poolFeePct: number | null;
  poolCreatedUnix: number | null;
  sources: SwmPriceSourceReading[];
};

export const EMPTY_SWM_PRICE_DETAILS: SwmPriceDetails = Object.freeze({
  priceEth: null,
  changePct1h: null,
  changePct6h: null,
  hourlyFromUnix: null,
  dailyUsd: null,
  dailyFromUnix: null,
  transactions24h: null,
  liquidityUsd: null,
  volume24hUsd: null,
  fdvUsd: null,
  poolFeePct: null,
  poolCreatedUnix: null,
  sources: [],
}) as SwmPriceDetails;

/** What `price:swm` answers with when the reading is good. */
export type SwmPriceIpcReading = {
  /** A positive decimal string, exactly as the relay sent it. */
  priceUsd: string;
  changePct24h: number | null;
  /** Hourly closes, oldest first, 2 to 48 points; null when the relay has none. */
  sparklineUsd: number[] | null;
  source: SwmPriceSource | null;
  generatedUnix: number;
  /** The relay could not reach either aggregator for more than five minutes. */
  stale: boolean;
  details: SwmPriceDetails;
};

export type SwmPriceFailure = "refused" | "timeout" | "network" | "http" | "too-large" | "schema" | "unavailable";

export type SwmPriceIpcResult = { ok: true; price: SwmPriceIpcReading } | { ok: false; reason: SwmPriceFailure };

/**
 * FRESH under 5 minutes, AGEING 5–30 minutes ("as of hh:mm"), STALE past 30
 * minutes or when the relay says so, UNAVAILABLE past 60 minutes or before
 * any reading, OFF when the setting is off or this is not a mainnet wallet.
 */
export type SwmPriceStatus = "fresh" | "ageing" | "stale" | "unavailable" | "off";

/** The `swmPrice` slice of the application state. */
export type SwmPriceState = {
  priceUsd: string | null;
  changePct24h: number | null;
  sparklineUsd: number[] | null;
  source: SwmPriceSource | null;
  generatedUnix: number | null;
  /** When this machine received the reading (ms since the epoch). */
  fetchedAtMs: number | null;
  status: SwmPriceStatus;
  /** No reading yet and the first request is on its way: "reading the price". */
  pending: boolean;
  /** The page's extra fields; null when there is no reading. */
  details: SwmPriceDetails | null;
};

export const SWM_PRICE_OFF: SwmPriceState = Object.freeze({
  priceUsd: null,
  changePct24h: null,
  sparklineUsd: null,
  source: null,
  generatedUnix: null,
  fetchedAtMs: null,
  status: "off",
  pending: false,
  details: null,
}) as SwmPriceState;

/** Which listing page the price card may ask main to open. */
export type SwmPriceListing = "dexscreener" | "geckoterminal";
