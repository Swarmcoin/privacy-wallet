import React from "react";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import { maskAmount, SwarmActivityRow } from "../swarmModel";

const STATE_CLASS: Record<string, string> = {
  SHIELDED: styles.stateShielded,
  REVEALED: styles.stateRevealed,
  PENDING: styles.statePending,
  FAILED: styles.stateFailed,
  MINED: styles.stateMined,
  // Neutral, not red. Red on this list means something went wrong that the
  // user may have to act on — a payment to retry. A reward lost to a fork
  // asks nothing of anyone, took nothing from the balance, and happens to
  // about one reward in a hundred; drawn red, it reads as the wallet or the
  // miner being broken.
  "LOST TO A FORK": styles.stateForkLost,
};

function whenLabel(time: number): string {
  if (!time) return "";
  const date = new Date(time * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type ActivityListProps = {
  rows: SwarmActivityRow[];
  hidden: boolean;
  emptyText: string;
  onSelect?: (row: SwarmActivityRow) => void;
  /** The row the detail panel is showing, if any. */
  selectedKey?: string | null;
};

/**
 * The shared list of transfers, used by Overview's recent five and by the
 * Activity screen's full history, so a payment reads the same in both.
 */
export const ActivityList: React.FC<ActivityListProps> = ({ rows, hidden, emptyText, onSelect, selectedKey }) => {
  if (rows.length === 0) {
    return <div className={styles.empty}>{emptyText}</div>;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((row) => (
        <li key={row.key}>
          <button
            type="button"
            className={`${styles.rowItem} ${row.key === selectedKey ? styles.rowItemSelected : ""}`}
            onClick={onSelect ? () => onSelect(row) : undefined}
            style={onSelect ? undefined : { cursor: "default" }}
            aria-current={row.key === selectedKey ? "true" : undefined}
          >
            <span
              className={`${styles.rowIcon} ${
                row.visibility === "revealed" ? styles.rowIconRevealed : styles.rowIconShielded
              }`}
            >
              <SwarmIcon name={row.direction === "in" ? "receive" : row.direction === "out" ? "send" : "shield"} />
            </span>
            <span className={styles.rowMain}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowMeta}>{[row.subtitle, whenLabel(row.time)].filter(Boolean).join(" · ")}</span>
            </span>
            <span className={styles.rowRight}>
              <span
                className={`${styles.rowAmount} ${
                  row.forkLost
                    ? styles.rowAmountVoid
                    : row.direction === "in"
                      ? styles.rowAmountIn
                      : styles.rowAmountOut
                }`}
              >
                {maskAmount(row.amount, hidden)}
              </span>
              <span className={`${styles.rowState} ${STATE_CLASS[row.state] ?? ""}`}>
                <span className={styles.statusDot} />
                {row.state}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

export default ActivityList;
