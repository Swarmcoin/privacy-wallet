import React, { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import routes from "../../../constants/routes.json";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import markUrl from "../../../assets/img/swarm-mark.svg";
import { priceIsDimmed, priceIsShown } from "../../../price/swmPrice";
import { SOURCE_LABEL, formatAge, formatChange, formatClock, formatUsdPrice } from "../../../price/swmPriceFormat";
import type { SwmPriceState } from "../../../price/swmPriceTypes";
import { SWM_PRICE_FOOTNOTE } from "../../../price/swmPool";

/**
 * The SWM price card on the Overview (specs/PRICE-DISPLAY.md §3, item 2).
 *
 * Calm on purpose: a price, a plain signed change, the last two days as a
 * line, where the number comes from and how old it is. No colour on the price
 * itself, no motion beyond a short fade when a new reading lands (none at all
 * under reduced motion), and nothing that reads as advice. The pool behind
 * the number is small, so the card says so and calls it indicative.
 *
 * The whole card opens the price page (/price), where the chart, the pool's
 * figures and the links to DexScreener and GeckoTerminal are.
 */

export { SWM_PRICE_FOOTNOTE };

/** The clock the "updated 12 s ago" line reads, advanced every ten seconds. */
function useNow(intervalMs: number, resetOn: unknown): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, resetOn]);
  return now;
}

/**
 * The sparkline's two paths in a `width` × `height` box: the line, and the
 * same line closed down to the bottom edge for the fill. Flat data draws a
 * level line through the middle rather than dividing by zero.
 */
export function sparklinePaths(
  points: number[],
  width: number,
  height: number,
  pad = 3,
): { line: string; area: string } {
  if (points.length < 2) return { line: "", area: "" };
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = width / (points.length - 1);
  const y = (v: number) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad));
  const coords = points.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`);
  const line = `M${coords.join(" L")}`;
  const area = `${line} L${width.toFixed(2)},${height} L0,${height} Z`;
  return { line, area };
}

const SPARK_W = 240;
const SPARK_H = 52;

const Sparkline: React.FC<{ points: number[] }> = ({ points }) => {
  const gradientId = `swm-spark-${useId().replace(/:/g, "")}`;
  const { line, area } = sparklinePaths(points, SPARK_W, SPARK_H);
  return (
    <svg
      className={styles.priceSpark}
      data-testid="swm-sparkline"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className={styles.priceSparkStopTop} />
          <stop offset="100%" className={styles.priceSparkStopBottom} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path d={line} className={styles.priceSparkLine} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const SwmPriceCard: React.FC<{ price: SwmPriceState }> = ({ price }) => {
  const navigate = useNavigate();
  const now = useNow(10_000, price.fetchedAtMs);
  if (price.status === "off") return null;

  const shown = priceIsShown(price);
  const dim = priceIsDimmed(price);
  const priceText = shown ? formatUsdPrice(price.priceUsd) : null;
  const change = shown ? formatChange(price.changePct24h) : null;

  const dotClass =
    price.status === "fresh"
      ? styles.priceDotFresh
      : price.status === "ageing"
        ? styles.priceDotAgeing
        : styles.priceDotStale;

  let when = "";
  let freshnessForReaders = "";
  if (shown && price.fetchedAtMs !== null) {
    if (price.status === "fresh") {
      when = `updated ${formatAge(price.fetchedAtMs, now)}`;
      freshnessForReaders = "Current.";
    } else {
      when = `as of ${formatClock(price.fetchedAtMs)}`;
      freshnessForReaders = price.status === "stale" ? "Not current." : "A few minutes old.";
    }
  }

  const meta = ["Base", "Uniswap v4", price.source ? SOURCE_LABEL[price.source] : null, when || null]
    .filter(Boolean)
    .join(" · ");

  // The card opens the price page; the listing links live there now
  // (specs/PRICE-DISPLAY.md §6).
  const open = () => navigate(routes.PRICE);

  return (
    <button
      type="button"
      className={`${styles.priceCard} ${dim ? styles.priceCardDim : ""}`}
      onClick={open}
      title="Open the SWM price page"
      data-status={price.status}
    >
      <span className={styles.priceHead}>
        <span className={styles.priceKicker}>
          <img src={markUrl} alt="" width={20} height={9} aria-hidden="true" />
          SWM PRICE
          <span className={`${styles.statusDot} ${dotClass}`} aria-hidden="true" />
        </span>
        <span className={styles.priceInfo} aria-hidden="true">
          <SwarmIcon name="info" size={14} />
          <span className={styles.priceTip}>{SWM_PRICE_FOOTNOTE}</span>
        </span>
      </span>

      {priceText ? (
        <>
          <span className={styles.priceLine}>
            <span key={price.fetchedAtMs ?? 0} className={styles.priceValue}>
              {priceText}
            </span>
            <span className={styles.priceUnit}>USD</span>
          </span>
          {change && (
            <span
              className={`${styles.priceChip} ${
                change.tone === "up" ? styles.priceChipUp : change.tone === "down" ? styles.priceChipDown : ""
              }`}
            >
              {change.text}
            </span>
          )}
          {price.sparklineUsd && <Sparkline points={price.sparklineUsd} />}
        </>
      ) : (
        <span className={styles.priceMissing}>{price.pending ? "Reading the price…" : "Price unavailable"}</span>
      )}

      <span className={styles.priceMeta}>
        {priceText
          ? meta
          : price.pending
            ? "From the SWARM price service"
            : "The SWARM price service is not answering. Trying again every minute."}
        <SwarmIcon name="chart" size={12} />
      </span>
      <span className={styles.srOnly}>
        {freshnessForReaders} {SWM_PRICE_FOOTNOTE} Opens the SWM price page.
      </span>
    </button>
  );
};

export default SwmPriceCard;
