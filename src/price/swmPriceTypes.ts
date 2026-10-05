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
}) as SwmPriceState;

/** Which listing page the price card may ask main to open. */
export type SwmPriceListing = "dexscreener" | "geckoterminal";
