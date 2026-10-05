import type { SwmPriceSource } from "./swmPriceTypes";

/**
 * How the SWM price and fiat values are written on screen
 * (specs/PRICE-DISPLAY.md §2.2 and §3).
 *
 * The fiat value is a display, not an accounting figure, but it is still
 * worked out in decimals: the balance in zatoshis times the relay's decimal
 * price string, rounded half-up to cents. Floating point would print
 * 12480.35 × 0.8411 one cent wrong often enough to be noticed.
 */

const ZATS_PER_SWM = 100_000_000n;
const PRICE_DECIMALS = 18;
const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS);
/** zats (1e-8) × price units (1e-18) = 1e-26 USD; a cent is 1e-2. */
const UNITS_PER_CENT = 10n ** 24n;

const DECIMAL_PATTERN = /^(\d{1,12})(?:\.(\d{1,18}))?$/;

/** The relay's decimal string as an integer count of 1e-18 USD, or null. */
export function parsePriceUnits(priceUsd: string | null | undefined): bigint | null {
  if (typeof priceUsd !== "string") return null;
  const match = DECIMAL_PATTERN.exec(priceUsd);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(PRICE_DECIMALS, "0"));
  const units = whole * PRICE_SCALE + fraction;
  return units > 0n ? units : null;
}

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The USD value of an amount of SWM, as "10,497.22", or null when either side
 * is unusable. Negative amounts keep their sign.
 */
export function fiatValueUsd(amountSwm: number, priceUsd: string | null | undefined): string | null {
  const units = parsePriceUnits(priceUsd);
  if (units === null || typeof amountSwm !== "number" || !Number.isFinite(amountSwm)) return null;
  const negative = amountSwm < 0;
  // The app holds balances as SWM numbers; back to zatoshis, which is what
  // they were before the SDK divided them.
  const zats = BigInt(Math.round(Math.abs(amountSwm) * Number(ZATS_PER_SWM)));
  const cents = (zats * units + UNITS_PER_CENT / 2n) / UNITS_PER_CENT;
  const whole = (cents / 100n).toString();
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${negative && cents > 0n ? "-" : ""}${group(whole)}.${fraction}`;
}

/** The mask for a hidden fiat value: the shape stays, nothing about the size. */
export const FIAT_MASK = "••••••";

/** "≈ $10,497.22 USD", or "≈ •••••• USD" while balances are hidden. */
export function fiatLine(amountSwm: number, priceUsd: string | null | undefined, hidden: boolean): string | null {
  const value = fiatValueUsd(amountSwm, priceUsd);
  if (value === null) return null;
  if (hidden) return `≈ ${FIAT_MASK} USD`;
  return value.startsWith("-") ? `≈ -$${value.slice(1)} USD` : `≈ $${value} USD`;
}

/**
 * The price itself: two decimals at 1 USD and above, four significant digits
 * below. "$0.8411", "$1.50", "$1,234.56".
 */
export function formatUsdPrice(priceUsd: string | null | undefined): string | null {
  if (parsePriceUnits(priceUsd) === null) return null;
  const value = Number(priceUsd);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 0.000001) return "< $0.000001";
  if (value < 1) {
    const precise = value.toPrecision(4);
    // 0.99996 rounds to "1.000" at four digits; that is a price at or above
    // one, and is written as one.
    if (Number(precise) < 1) return `$${precise}`;
  }
  const [whole, fraction] = value.toFixed(2).split(".");
  return `$${group(whole)}.${fraction}`;
}

export type ChangeTone = "up" | "down" | "flat";

/** "▲ 36.7 % 24h", "▼ 3.2 % 24h", "0.0 % 24h". */
export function formatChange(pct: number | null | undefined): { text: string; tone: ChangeTone } | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  if (rounded === 0) return { text: "0.0 % 24h", tone: "flat" };
  const digits = rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return pct > 0 ? { text: `▲ ${digits} % 24h`, tone: "up" } : { text: `▼ ${digits} % 24h`, tone: "down" };
}

/** "18:07", local time, 24-hour. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "just now", "12 s ago", "4 min ago", "2 h ago". */
export function formatAge(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

export const SOURCE_LABEL: Record<SwmPriceSource, string> = {
  geckoterminal: "GeckoTerminal",
  dexscreener: "DexScreener",
};
