import React, { useId, useState } from "react";
import styles from "../Swarm.module.css";
import { formatPointTime, formatUsdPrice } from "../../../price/swmPriceFormat";
import type { SwmPriceState } from "../../../price/swmPriceTypes";

/**
 * The price page's chart (specs/PRICE-DISPLAY.md §6.2, item 3): the card's
 * line, taller, with a 24h · 48h · 30d switch, the lowest and highest value
 * labelled at the left edge, the latest at the line's end, three faint guides
 * and a readout of the value and time under the pointer (or the arrow keys).
 * No gridlines, no axes, no animation.
 */

export type SwmChartRange = "24h" | "48h" | "30d";
export const SWM_CHART_RANGES: SwmChartRange[] = ["24h", "48h", "30d"];

/**
 * `endsLive`: the last point is the live price the relay appends (§6.1), not a
 * close; its time is the relay's generation time and its readout says "now".
 */
export type SwmChartSeries = { points: number[]; times: number[]; daily: boolean; endsLive: boolean };

const HOUR = 3600;
const DAY = 86400;

/**
 * The points and their times for a range, or null when the relay sent too
 * little for it. Times come from the relay's `hourly_from_unix` /
 * `daily_from_unix`; without them the last point is pinned to the hour (or
 * UTC day) the relay generated its answer in.
 */
export function seriesFor(range: SwmChartRange, price: SwmPriceState): SwmChartSeries | null {
  const generated = price.generatedUnix ?? Math.floor(Date.now() / 1000);
  const build = (values: number[], fromUnix: number | null, step: number, endsLive: boolean, daily: boolean) => {
    const closes = endsLive ? values.length - 1 : values.length;
    // Without a start time, the last close is pinned to the period the relay
    // generated its answer in.
    const from = fromUnix ?? Math.floor(generated / step) * step - (closes - 1) * step;
    const times = values.map((_, i) => (endsLive && i === values.length - 1 ? generated : from + i * step));
    return { points: values, times, daily, endsLive };
  };
  if (range === "30d") {
    const daily = price.details?.dailyUsd ?? null;
    if (!daily || daily.length < 2) return null;
    return build(daily, price.details?.dailyFromUnix ?? null, DAY, !!price.details?.dailyEndsLive, true);
  }
  const hourly = price.sparklineUsd;
  if (!hourly || hourly.length < 2) return null;
  const all = build(hourly, price.details?.hourlyFromUnix ?? null, HOUR, !!price.details?.hourlyEndsLive, false);
  if (range === "48h") return all;
  // 24h: the last 24 closes, and the live price after them when there is one.
  const keep = all.endsLive ? 25 : 24;
  if (hourly.length <= keep) return all;
  return { ...all, points: all.points.slice(-keep), times: all.times.slice(-keep) };
}

/** A point's time as the chart writes it: "now" for the live price. */
export function pointLabel(series: SwmChartSeries, index: number): string {
  return series.endsLive && index === series.points.length - 1
    ? "now"
    : formatPointTime(series.times[index], series.daily);
}

/** The range to open on: 48h when there is hourly data, else 30d, else 24h (all disabled). */
export function defaultRange(price: SwmPriceState): SwmChartRange {
  if (seriesFor("48h", price)) return "48h";
  if (seriesFor("30d", price)) return "30d";
  return "48h";
}

const W = 600;
const H = 200;
const PAD = 14;

const yOf = (v: number, min: number, max: number) =>
  max === min ? H / 2 : PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);

export const SwmPriceChart: React.FC<{ price: SwmPriceState; dim?: boolean }> = ({ price, dim }) => {
  const [chosen, setRange] = useState<SwmChartRange>(() => defaultRange(price));
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = `swm-chart-${useId().replace(/:/g, "")}`;

  const available = (r: SwmChartRange) => seriesFor(r, price) !== null;
  // The choice survives new readings; a range that has lost its data falls
  // back to one that has some.
  const range = available(chosen) ? chosen : defaultRange(price);
  const series = seriesFor(range, price);

  let body: React.ReactNode;
  if (!series) {
    body = <div className={styles.chartEmpty}>No price history for this range yet.</div>;
  } else {
    const { points } = series;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const step = W / (points.length - 1);
    const coords = points.map((v, i) => [i * step, yOf(v, min, max)] as const);
    const line = `M${coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")}`;
    const area = `${line} L${W},${H} L0,${H} Z`;
    const pct = (x: number) => `${(x / W) * 100}%`;
    const pctY = (y: number) => `${(y / H) * 100}%`;
    const last = points.length - 1;
    const at = hover === null ? null : Math.min(Math.max(hover, 0), last);

    const pick = (clientX: number, rect: DOMRect) => {
      if (rect.width <= 0) return;
      setHover(Math.round(((clientX - rect.left) / rect.width) * last));
    };

    body = (
      <div className={styles.chartFrame}>
        <div
          className={styles.chartPlot}
          tabIndex={0}
          role="img"
          aria-label={`SWM price over ${range}: from ${formatUsdPrice(String(points[0]))} to ${formatUsdPrice(
            String(points[last]),
          )}, lowest ${formatUsdPrice(String(min))}, highest ${formatUsdPrice(String(max))}`}
          onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? last) - 1));
            else if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? last - 1) + 1));
            else if (e.key === "Escape") setHover(null);
          }}
          data-testid="swm-chart"
        >
          <svg
            className={`${styles.chartSvg} ${dim ? styles.chartDim : ""}`}
            viewBox={`0 0 ${W} ${H}`}
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
            {[PAD, H / 2, H - PAD].map((y) => (
              <line
                key={y}
                x1="0"
                x2={W}
                y1={y}
                y2={y}
                className={styles.chartGuide}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={area} fill={`url(#${gradientId})`} stroke="none" />
            <path d={line} className={styles.chartLine} fill="none" vectorEffect="non-scaling-stroke" />
          </svg>

          <span className={`${styles.chartLabel} ${styles.chartLabelMax}`}>{formatUsdPrice(String(max))}</span>
          <span className={`${styles.chartLabel} ${styles.chartLabelMin}`}>{formatUsdPrice(String(min))}</span>
          <span className={styles.chartLatest} style={{ top: pctY(coords[last][1]) }}>
            {formatUsdPrice(String(points[last]))}
          </span>
          <span className={styles.chartEndDot} style={{ left: "100%", top: pctY(coords[last][1]) }} />

          {at !== null && (
            <>
              <span className={styles.chartCursor} style={{ left: pct(coords[at][0]) }} />
              <span className={styles.chartCursorDot} style={{ left: pct(coords[at][0]), top: pctY(coords[at][1]) }} />
              <span
                className={`${styles.chartReadout} ${at > last / 2 ? styles.chartReadoutLeft : ""}`}
                style={{ left: pct(coords[at][0]) }}
                data-testid="swm-chart-readout"
              >
                <strong>{formatUsdPrice(String(points[at]))}</strong>
                <span>{pointLabel(series, at)}</span>
              </span>
            </>
          )}
        </div>
        <div className={styles.chartTimes} aria-hidden="true">
          <span>{pointLabel(series, 0)}</span>
          <span>{pointLabel(series, last)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chartBlock}>
      <div className={styles.chartRanges} role="group" aria-label="Chart range">
        {SWM_CHART_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={`${styles.chartRange} ${r === range ? styles.chartRangeActive : ""}`}
            aria-pressed={r === range}
            disabled={!available(r)}
            title={available(r) ? undefined : "No price history for this range yet"}
            onClick={() => {
              setRange(r);
              setHover(null);
            }}
          >
            {r}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
};

export default SwmPriceChart;
