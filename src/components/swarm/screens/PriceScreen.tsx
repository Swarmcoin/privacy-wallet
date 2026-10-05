import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import SwarmUiContext from "../SwarmUiContext";
import { SwmPriceChart } from "../components/SwmPriceChart";
import { deriveBalances, formatSwm, maskAmount } from "../swarmModel";
import markUrl from "../../../assets/img/swarm-mark.svg";
import { ContextApp } from "../../../context/ContextAppState";
import { clipboard, price as priceBridge } from "../../../electronBridge";
import routes from "../../../constants/routes.json";
import { SWARM_COINS_ARE_TEST_COINS, SWARM_TICKER } from "../../../utils/swarmNetwork";
import { priceIsDimmed, priceIsShown } from "../../../price/swmPrice";
import {
  SOURCE_LABEL,
  fiatLine,
  formatAge,
  formatChange,
  formatClock,
  formatEthPrice,
  formatUsdAmount,
  formatUsdPrice,
  shortHex,
} from "../../../price/swmPriceFormat";
import {
  SWM_POOL_FEE_PCT,
  SWM_POOL_ID,
  SWM_PRICE_FOOTNOTE,
  SWM_PRICE_SETTING_HELP,
  SWM_PRICE_SETTING_LABEL,
  SWM_TOKEN_ADDRESS,
} from "../../../price/swmPool";
import type { SwmPriceListing, SwmPriceSource } from "../../../price/swmPriceTypes";

/**
 * The price page (specs/PRICE-DISPLAY.md §6): the card's content with room,
 * plus what the card leaves out — the price in ETH, the shorter and longer
 * changes, the chart over 24 hours, 48 hours or 30 days, the pool's figures,
 * each aggregator's own reading, the pool and token addresses, and the switch.
 *
 * Reads the same `swmPrice` slice the card does; it polls nothing itself. The
 * listing pages open through `price:open-listing`, which holds both URLs in
 * the main process. The pool id and the token contract shown and copied here
 * are this build's constants, never the relay's copy of them.
 *
 * Off: only the note and the switch. On a test-coin build the page does not
 * exist: no rail entry, and the route goes back to the Overview.
 */

const LISTINGS: { id: SwmPriceListing; label: string }[] = [
  { id: "geckoterminal", label: "GeckoTerminal" },
  { id: "dexscreener", label: "DexScreener" },
];

/** A short-lived "Copied" next to whichever copy button was pressed. */
function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = (key: string, text: string) => {
    clipboard.writeText(text);
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };
  return [copied, copy];
}

function useNow(intervalMs: number, resetOn: unknown): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, resetOn]);
  return now;
}

const PriceSwitch: React.FC<{ on: boolean; onChange: (on: boolean) => void }> = ({ on, onChange }) => (
  <div className={styles.pricePageSetting}>
    <span className={styles.rowMain}>
      <span className={styles.rowTitle}>{SWM_PRICE_SETTING_LABEL}</span>
      <span className={styles.statNote}>{SWM_PRICE_SETTING_HELP}</span>
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={SWM_PRICE_SETTING_LABEL}
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      onClick={() => onChange(!on)}
    />
  </div>
);

export const PriceScreen: React.FC = () => {
  const navigate = useNavigate();
  const { hidden } = useContext(SwarmUiContext);
  const { swmPrice: price, totalBalance, showSwmPrice, setShowSwmPrice } = useContext(ContextApp);
  const balances = useMemo(() => deriveBalances(totalBalance), [totalBalance]);
  const now = useNow(10_000, price.fetchedAtMs);
  const [copied, copy] = useCopied();

  if (SWARM_COINS_ARE_TEST_COINS) return <Navigate to={routes.DASHBOARD} replace />;

  const back = (
    <button type="button" className={styles.panelLink} onClick={() => navigate(routes.DASHBOARD)}>
      ← Overview
    </button>
  );

  const note = (
    <section className={`${styles.panel} ${styles.panelPad}`} aria-label="About this price">
      <div className={styles.pricePageNote}>
        <SwarmIcon name="info" size={15} />
        <span>{SWM_PRICE_FOOTNOTE}</span>
      </div>
      <PriceSwitch on={showSwmPrice} onChange={setShowSwmPrice} />
    </section>
  );

  if (!showSwmPrice || price.status === "off") {
    return (
      <div className={styles.pricePage}>
        <div className={styles.pricePageHead}>{back}</div>
        {note}
      </div>
    );
  }

  const shown = priceIsShown(price);
  const dim = priceIsDimmed(price);
  const details = price.details;
  const priceText = shown ? formatUsdPrice(price.priceUsd) : null;
  const ethText = shown ? formatEthPrice(details?.priceEth) : null;

  let when = "";
  if (shown && price.fetchedAtMs !== null) {
    when =
      price.status === "fresh"
        ? `updated ${formatAge(price.fetchedAtMs, now)}`
        : `as of ${formatClock(price.fetchedAtMs)}`;
  } else {
    when = price.pending ? "reading the price…" : "price unavailable";
  }
  const dotClass =
    price.status === "fresh"
      ? styles.priceDotFresh
      : price.status === "ageing"
        ? styles.priceDotAgeing
        : styles.priceDotStale;

  const chips: { label: string; pct: number | null | undefined }[] = [
    { label: "1h", pct: details?.changePct1h },
    { label: "6h", pct: details?.changePct6h },
    { label: "24h", pct: price.changePct24h },
  ];

  const balanceFiat = shown ? fiatLine(balances.total, price.priceUsd, hidden) : null;

  const tx = details?.transactions24h;
  const stats: { k: string; v: string | null }[] = [
    { k: "Liquidity", v: formatUsdAmount(details?.liquidityUsd) },
    { k: "24 h volume", v: formatUsdAmount(details?.volume24hUsd) },
    { k: "Fully diluted value", v: formatUsdAmount(details?.fdvUsd) },
    { k: "Buys / sells 24 h", v: tx ? `${tx.buys} / ${tx.sells}` : null },
    { k: "Pool fee", v: `${(details?.poolFeePct ?? SWM_POOL_FEE_PCT).toLocaleString("en-US")} %` },
    { k: "Network", v: "Base" },
  ];

  const sourceReading = (id: SwmPriceSource) => details?.sources.find((s) => s.id === id) ?? null;

  return (
    <div className={`${styles.pricePage} ${dim ? styles.priceCardDim : ""}`} data-status={price.status}>
      <div className={styles.pricePageHead}>
        {back}
        <span className={styles.pricePageId}>
          <img src={markUrl} alt="" width={26} height={12} aria-hidden="true" />
          SWM / USD · Base
        </span>
        <span className={styles.pricePageWhen}>
          <span className={`${styles.statusDot} ${dotClass}`} aria-hidden="true" />
          {when}
        </span>
      </div>

      <div className={styles.pricePageGrid}>
        <section className={`${styles.panel} ${styles.pricePageMain}`} aria-label="SWM price">
          {priceText ? (
            <>
              <div className={styles.pricePageLine}>
                <span key={price.fetchedAtMs ?? 0} className={`${styles.priceValue} ${styles.pricePageValue}`}>
                  {priceText}
                </span>
                <span className={styles.priceUnit}>USD</span>
              </div>
              {ethText && <div className={styles.pricePageEth}>{ethText}</div>}
              <div className={styles.pricePageChips}>
                {chips.map(({ label, pct }) => {
                  const change = formatChange(pct, label);
                  const tone = change?.tone;
                  return (
                    <span
                      key={label}
                      className={`${styles.priceChip} ${
                        tone === "up" ? styles.priceChipUp : tone === "down" ? styles.priceChipDown : ""
                      }`}
                    >
                      {change ? change.text : `— ${label}`}
                    </span>
                  );
                })}
              </div>
              <SwmPriceChart price={price} dim={dim} />
            </>
          ) : (
            <div className={styles.priceMissing}>{price.pending ? "Reading the price…" : "Price unavailable"}</div>
          )}
        </section>

        <div className={styles.pricePageSide}>
          <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Your balance">
            <div className={styles.panelTitle}>Your balance</div>
            <div className={styles.pricePageBalance}>
              <span className={styles.mono}>
                {maskAmount(formatSwm(balances.total), hidden)} {SWARM_TICKER}
              </span>
              {balanceFiat && <span className={styles.pricePageBalanceFiat}>{balanceFiat}</span>}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Pool">
            <div className={styles.pricePageStats}>
              {stats.map(({ k, v }) => (
                <div key={k} className={styles.pricePageStat}>
                  <span className={styles.pricePageStatKey}>{k}</span>
                  <span className={styles.pricePageStatValue}>{v ?? "—"}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className={styles.panel} aria-label="Sources">
        <div className={styles.panelHead}>
          <div className={styles.panelTitle}>Sources</div>
          <span className={styles.statNote}>Read by the SWARM price service, never by this wallet</span>
        </div>
        <div className={styles.panelBody}>
          {LISTINGS.map(({ id, label }) => {
            const reading = sourceReading(id);
            const ok = !!reading?.ok && !!reading.priceUsd;
            return (
              <div key={id} className={`${styles.rowItem} ${styles.pricePageRow} ${ok ? "" : styles.pricePageRowOff}`}>
                <span className={styles.rowTitle}>{SOURCE_LABEL[id]}</span>
                <span className={styles.pricePageRowValue}>
                  {reading?.priceUsd ? formatUsdPrice(reading.priceUsd) : "—"}
                </span>
                <span className={styles.pricePageMark} aria-label={ok ? "answering" : "not answering"}>
                  {ok ? "✓" : "—"}
                </span>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall}`}
                  onClick={() => void priceBridge.openListing(id)}
                >
                  Open on {label} <SwarmIcon name="external" size={12} />
                </button>
              </div>
            );
          })}
          {[
            { key: "pool", k: "Pool", v: SWM_POOL_ID, note: "Uniswap v4 · SWM / ETH" },
            { key: "token", k: "Token", v: SWM_TOKEN_ADDRESS, note: "SWM on Base · 8 decimals" },
          ].map(({ key, k, v, note: rowNote }) => (
            <div key={key} className={`${styles.rowItem} ${styles.pricePageRow}`}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{k}</span>
                <span className={styles.statNote}>{rowNote}</span>
              </span>
              <span className={styles.pricePageRowValue} title={v}>
                {shortHex(v)}
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onClick={() => copy(key, v)}
                aria-label={`Copy the ${k.toLowerCase()} address`}
              >
                <SwarmIcon name={copied === key ? "check" : "copy"} size={13} /> {copied === key ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      </section>

      {note}
    </div>
  );
};

export default PriceScreen;
