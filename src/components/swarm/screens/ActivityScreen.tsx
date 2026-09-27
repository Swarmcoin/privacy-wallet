import React, { useContext, useMemo, useState } from "react";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import SwarmUiContext from "../SwarmUiContext";
import { ActivityList } from "../components/ActivityList";
import {
  ActivityFilterKey,
  SwarmActivityRow,
  filterActivity,
  maskAmount,
  searchActivity,
  toActivityRows,
} from "../swarmModel";
import { ContextApp } from "../../../context/ContextAppState";
import { useCopy } from "../../common/useCopy";
import { SWARM_TICKER, swarmProfileOrActive } from "../../../utils/swarmNetwork";

/**
 * Activity: every transfer this wallet knows about, with a detail panel.
 *
 * The old application had a separate Messages screen listing the transfers
 * that carried a memo. A memo is a property of a payment, not a second kind of
 * object, so it is a filter here rather than a destination — the same list,
 * narrowed.
 *
 * The Mined filter shows itself only when the wallet has actually flagged a
 * receipt as a block reward. The flag arrives with the SDK re-pin; until then
 * there is nothing to list, and a tab that was always empty would read as a
 * fault rather than as an absence.
 */

const FILTERS: { key: ActivityFilterKey | "received" | "sent"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "received", label: "Received" },
  { key: "sent", label: "Sent" },
  { key: "shielded", label: "Shielded" },
  { key: "revealed", label: "Revealed" },
  { key: "memos", label: "Memos" },
  { key: "mined", label: "Mined" },
];

function applyFilter(rows: SwarmActivityRow[], key: string): SwarmActivityRow[] {
  if (key === "received") return rows.filter((r) => r.direction === "in");
  if (key === "sent") return rows.filter((r) => r.direction === "out");
  return filterActivity(rows, key as ActivityFilterKey);
}

function fullWhen(time: number): string {
  if (!time) return "—";
  const date = new Date(time * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

const DetailPanel: React.FC<{ row: SwarmActivityRow | null; hidden: boolean }> = ({ row, hidden }) => {
  const { copied, copy } = useCopy(1500);

  if (!row) {
    return (
      <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Transfer details">
        <div className={styles.panelTitle}>Details</div>
        <div className={styles.empty}>Pick a row to see everything the wallet knows about it.</div>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Transfer details">
      <div className={styles.spread}>
        <div className={styles.panelTitle}>{row.title}</div>
        <span
          className={`${styles.rowState} ${
            row.forkLost
              ? styles.stateForkLost
              : row.visibility === "revealed"
                ? styles.stateRevealed
                : styles.stateShielded
          }`}
        >
          <span className={styles.statusDot} />
          {row.state}
        </span>
      </div>

      <div className={styles.factList}>
        <div className={styles.factRow}>
          <span>Amount</span>
          <span className={styles.factVisible}>
            {maskAmount(row.amount, hidden)} {SWARM_TICKER}
          </span>
        </div>
        <div className={styles.factRow}>
          <span>When</span>
          <span className={styles.factVisible}>{fullWhen(row.time)}</span>
        </div>
        <div className={styles.factRow}>
          <span>Confirmations</span>
          <span className={styles.factVisible}>{row.confirmations}</span>
        </div>
        <div className={styles.factRow}>
          <span>Block</span>
          <span className={styles.factVisible}>{row.blockheight ? `#${row.blockheight}` : "not yet mined"}</span>
        </div>
        {row.fee !== undefined && row.fee > 0 && (
          <div className={styles.factRow}>
            <span>Fee</span>
            <span className={styles.factVisible}>
              {row.fee} {SWARM_TICKER}
            </span>
          </div>
        )}
        <div className={styles.factRow}>
          <span>Counterparty</span>
          <span className={styles.factVisible}>
            {row.address ?? (row.visibility === "shielded" ? "hidden by the shielded pool" : "—")}
          </span>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Transaction id</span>
        <div className={styles.addressBlock}>{row.txid}</div>
        <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={() => copy(row.txid)}>
          <SwarmIcon name="copy" size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {row.memos.length > 0 && (
        <div className={styles.field}>
          <span className={styles.label}>
            Memo{" "}
            <span className={styles.labelHint}>(encrypted on the chain — only you and the sender can read it)</span>
          </span>
          {row.memos.map((m, i) => (
            <div key={i} className={styles.memoBlock}>
              {m}
            </div>
          ))}
        </div>
      )}

      <div className={styles.statNote}>
        {row.forkLost
          ? `Another miner's block was chosen at height ${row.blockheight}, so the block this wallet's reward was in is not part of the chain. The reward was never paid, nothing left your balance, and there is nothing to do. With more than one miner this happens to about one block in a hundred.`
          : row.visibility === "shielded"
            ? "On the chain, others can see that this transaction exists and what it paid in fees. Not who, not how much."
            : "This transfer touched a transparent address, so the address and the amount are public on the chain."}
      </div>
    </section>
  );
};

export const ActivityScreen: React.FC = () => {
  const { hidden } = useContext(SwarmUiContext);
  const { valueTransfers, currentWallet } = useContext(ContextApp);
  const profile = swarmProfileOrActive(currentWallet?.chain_name);

  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const rows = useMemo(() => toActivityRows(valueTransfers, profile), [valueTransfers, profile]);
  const anyMined = rows.some((r) => r.mined);
  const filters = FILTERS.filter((f) => f.key !== "mined" || anyMined);
  const visible = useMemo(() => searchActivity(applyFilter(rows, filter), query), [rows, filter, query]);
  const selected = visible.find((r) => r.key === selectedKey) ?? null;

  return (
    <>
      <div className={styles.filterBar}>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${styles.chip} ${filter === f.key ? styles.chipActive : ""}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden="true">
            <SwarmIcon name="search" size={14} />
          </span>
          <input
            className={`${styles.input} ${styles.inputText} ${styles.searchInput}`}
            value={query}
            placeholder="Search memo, address, amount…"
            aria-label="Search activity"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.activityGrid}>
        <section className={styles.panel} aria-label="Activity">
          <div className={styles.panelHead}>
            <div className={styles.panelTitle}>
              {visible.length} {visible.length === 1 ? "transfer" : "transfers"}
            </div>
          </div>
          <div className={styles.panelBody}>
            <ActivityList
              rows={visible}
              hidden={hidden}
              onSelect={(row) => setSelectedKey(row.key)}
              selectedKey={selectedKey}
              emptyText={
                rows.length === 0
                  ? "Nothing yet. Payments and block rewards will appear here as they confirm."
                  : "No transfer matches that."
              }
            />
          </div>
        </section>

        <DetailPanel row={selected} hidden={hidden} />
      </div>
    </>
  );
};

export default ActivityScreen;
