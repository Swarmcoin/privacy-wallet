import React, { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import SwarmUiContext from "../SwarmUiContext";
import { deriveBalances, formatSwm, maskAmount, toActivityRows } from "../swarmModel";
import { ActivityList } from "../components/ActivityList";
import { ContextApp } from "../../../context/ContextAppState";
import routes from "../../../constants/routes.json";
import SwarmMark from "../../logo/SwarmMark";
import {
  SWARM_COINS_ARE_TEST_COINS,
  SWARM_TICKER,
  addressPlaceholderFor,
  swarmProfileOrActive,
} from "../../../utils/swarmNetwork";
import { ZcashURITarget } from "../../../utils/uris";

/**
 * The first screen: one balance, four facts about it, what happened lately,
 * and a way to start a payment.
 *
 * Three things the mockup shows are not here, and each is a claim this
 * network cannot support:
 *
 *   - the fiat line ("≈ $9,364.10 USD"). This wallet has no price feed, so
 *     there is no number to print; on the test network the slot says the
 *     coins are test coins, which is true there and nowhere else.
 *   - "42 peers". A light wallet has no peers. It talks to one indexer, and
 *     the rail names that indexer and the block height it reported instead.
 *   - the fourth card, "ON-CHAIN VIEW — what others can see". A single number
 *     cannot answer that honestly: what an observer sees depends on which of
 *     your addresses they already know. The per-payment version of the same
 *     question is answerable, and the Send screen answers it there.
 */
export const OverviewScreen: React.FC = () => {
  const navigate = useNavigate();
  const { hidden } = useContext(SwarmUiContext);
  const { totalBalance, valueTransfers, readOnly, currentWallet, handleShieldButton, setSendTo } =
    useContext(ContextApp);

  const [poolsOpen, setPoolsOpen] = useState(false);
  const [quickTo, setQuickTo] = useState("");
  const [quickAmount, setQuickAmount] = useState("");

  const profile = swarmProfileOrActive(currentWallet?.chain_name);
  const balances = useMemo(() => deriveBalances(totalBalance), [totalBalance]);
  const rows = useMemo(() => toActivityRows(valueTransfers, profile).slice(0, 5), [valueTransfers, profile]);

  const walletReady = !!currentWallet?.id;
  const canSend = walletReady && !readOnly;
  const amount = Number(quickAmount);
  const quickReady = canSend && quickTo.trim().length > 0 && Number.isFinite(amount) && amount > 0;

  const show = (value: number) => maskAmount(formatSwm(value), hidden);

  /**
   * Quick send does not send. It fills in the Send screen and goes there, so
   * the payment meets exactly the same address check, the same fee, and the
   * same confirmation as one typed on that screen. A second, shorter path to
   * spending money is how a wallet ends up with two ideas of what a valid
   * payment is.
   */
  const startQuickSend = () => {
    if (!quickReady) return;
    const target = new ZcashURITarget();
    target.address = quickTo.trim();
    target.amount = amount;
    setSendTo(target);
    setQuickTo("");
    setQuickAmount("");
    navigate(routes.SEND);
  };

  return (
    <>
      <section className={styles.balanceCard} aria-label="Total balance">
        <div className={styles.balanceFlow} />
        <div className={styles.balanceBee} aria-hidden="true">
          <SwarmMark size={88} animated />
        </div>
        <div className={styles.balanceInner}>
          <div className={styles.balanceKicker}>
            TOTAL BALANCE
            <span className={styles.badge}>
              <span className={styles.statusDot} />
              SHIELDED
            </span>
          </div>
          <div className={styles.balanceValue}>
            {show(balances.total)} <span className={styles.balanceTicker}>{SWARM_TICKER}</span>
          </div>
          {/*
            Only where it is true. Up to 0.1.0-mainnet.5 this line was written
            into the card unconditionally, so the mainnet wallet told its owner
            that real SWM had "no market value". Onboarding already follows
            the build's network; this follows it too.
          */}
          {SWARM_COINS_ARE_TEST_COINS && <div className={styles.balanceNote}>test coins · no market value</div>}
          <div className={styles.actionRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => navigate(routes.SEND)}
              disabled={!canSend}
            >
              <SwarmIcon name="send" size={15} /> Send
            </button>
            <button type="button" className={styles.btn} onClick={() => navigate(routes.RECEIVE)}>
              <SwarmIcon name="receive" size={15} /> Receive
            </button>
            {/* Kept in the layout because it is in the design, disabled because
                there is no swap service on this network. A button that opened
                a screen with nothing behind it would be worse than a greyed one. */}
            <button type="button" className={styles.btn} disabled title="Coming soon">
              <SwarmIcon name="swap" size={15} /> Swap
              <span className={styles.muted} style={{ fontSize: 11 }}>
                Coming soon
              </span>
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={handleShieldButton}
              disabled={!canSend || balances.transparent <= 0}
              title={balances.transparent <= 0 ? "Nothing transparent to shield" : undefined}
            >
              <SwarmIcon name="shield" size={15} /> Shield funds
            </button>
          </div>
        </div>
      </section>

      <div className={styles.statGrid}>
        <div className={`${styles.statCard} ${styles.statCardShielded}`}>
          <div className={styles.statKicker} style={{ color: "var(--swarm-orange)" }}>
            <span className={styles.statusDot} style={{ background: "currentColor" }} />
            SHIELDED
          </div>
          <div className={styles.statValue}>{show(balances.shielded)}</div>
          <div className={styles.statNote}>private, spendable</div>
          <button
            type="button"
            className={styles.statMore}
            aria-expanded={poolsOpen}
            onClick={() => setPoolsOpen((o) => !o)}
          >
            {poolsOpen ? "Hide pools" : "Pool breakdown"}
          </button>
          {poolsOpen && (
            <div className={styles.popover} role="group" aria-label="Shielded pool breakdown">
              {balances.shieldedPools.map((p) => (
                <div key={p.key} className={styles.popoverRow}>
                  <span>{p.label}</span>
                  <span>{show(p.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${styles.statCard} ${styles.statCardTransparent}`}>
          <div className={styles.statKicker} style={{ color: "var(--swarm-clear-blue)" }}>
            <span className={styles.statusDot} style={{ background: "currentColor" }} />
            TRANSPARENT
          </div>
          <div className={styles.statValue}>{show(balances.transparent)}</div>
          <div className={styles.statNote}>public on the chain</div>
        </div>

        <div className={`${styles.statCard} ${styles.statCardPending}`}>
          <div className={styles.statKicker} style={{ color: "var(--swarm-honey)" }}>
            <span className={styles.statusDot} style={{ background: "currentColor" }} />
            PENDING
          </div>
          <div className={styles.statValue}>{show(balances.pending)}</div>
          <div className={styles.statNote}>waiting for confirmations</div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statKicker} style={{ color: "var(--swarm-text-muted)" }}>
            <span className={styles.statusDot} style={{ background: "currentColor" }} />
            SPENDABLE
          </div>
          <div className={styles.statValue}>{show(balances.spendable)}</div>
          <div className={styles.statNote}>confirmed and ready to send</div>
        </div>
      </div>

      <div className={styles.panelGrid}>
        <section className={styles.panel} aria-label="Recent activity">
          <div className={styles.panelHead}>
            <div className={styles.panelTitle}>Recent activity</div>
            <button type="button" className={styles.panelLink} onClick={() => navigate(routes.HISTORY)}>
              View all →
            </button>
          </div>
          <div className={styles.panelBody}>
            <ActivityList
              rows={rows}
              hidden={hidden}
              emptyText={
                walletReady
                  ? "Nothing yet. Payments and block rewards will appear here as they confirm."
                  : "Open a wallet to see its activity."
              }
            />
          </div>
        </section>

        <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Quick send">
          <div className={styles.panelTitle}>Quick send</div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="swarm-quick-to">
              To
            </label>
            <input
              id="swarm-quick-to"
              className={styles.input}
              value={quickTo}
              spellCheck={false}
              placeholder={addressPlaceholderFor(profile)}
              onChange={(e) => setQuickTo(e.target.value)}
              disabled={!canSend}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="swarm-quick-amount">
              Amount
            </label>
            <div className={styles.amountBox}>
              <input
                id="swarm-quick-amount"
                className={styles.amountInput}
                value={quickAmount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => setQuickAmount(e.target.value)}
                disabled={!canSend}
              />
              <span className={styles.amountTicker}>{SWARM_TICKER}</span>
            </div>
          </div>
          <div className={styles.sendModeRow}>
            <span className={styles.sendModeLabel}>
              <span style={{ color: "var(--swarm-orange)", display: "flex" }}>
                <SwarmIcon name="shield" size={15} />
              </span>
              Shielded transaction
            </span>
            <span className={styles.sendModeFee}>fee shown on Send</span>
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnWide}`}
            style={{ marginTop: "auto" }}
            onClick={startQuickSend}
            disabled={!quickReady}
          >
            Review on Send
          </button>
          <div className={styles.statNote} style={{ textAlign: "center" }}>
            {readOnly
              ? "This wallet is watch-only. It cannot send."
              : "Every payment is checked and confirmed on the Send screen."}
          </div>
        </section>
      </div>
    </>
  );
};

export default OverviewScreen;
