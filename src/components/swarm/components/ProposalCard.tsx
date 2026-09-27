import React from "react";
import styles from "../Swarm.module.css";
import { formatZat } from "../../../treasury/selectUtxos";
import { SWARM_TICKER } from "../../../utils/swarmNetwork";
import type { ProposalSummary } from "../../../treasury/treasuryMachine";

/**
 * The card both machines read, and the only thing either of them signs.
 *
 * Every number on it came back from `treasury_proposal_summary`, which
 * recomputes the transaction's own hash and every input digest from the raw
 * bytes before it answers. So this is not a rendering of what the proposal
 * file *says*; it is a rendering of what the proposal file *is*. If the two
 * disagreed, there would be no card — the call refuses instead.
 *
 * The proposal hash is printed at the top and the bottom on purpose. It is
 * the one value the two people are meant to compare out loud before either
 * of them types a passphrase, and a value you have to scroll for is a value
 * nobody compares.
 */

export const ProposalCard: React.FC<{ summary: ProposalSummary }> = ({ summary }) => (
  <section className={`${styles.panel} ${styles.panelPad} ${styles.chainCard}`} aria-label="Payout">
    <div className={styles.chainKicker}>PROPOSAL {summary.proposal_hash.slice(0, 16)}…</div>

    <div className={styles.balanceKicker}>THE RECIPIENT RECEIVES</div>
    <div className={styles.balanceValue}>
      {formatZat(summary.amount_out)} <span className={styles.balanceTicker}>{SWARM_TICKER}</span>
    </div>

    <div className={styles.factList}>
      <div className={styles.factRow}>
        <span className={styles.label}>Fund</span>
        <span className={styles.mono}>{summary.fund}</span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>From</span>
        <span className={styles.mono}>{summary.policy_address}</span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>To</span>
        <span className={styles.mono}>{summary.recipient}</span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Raw receiver</span>
        <span className={styles.mono}>{summary.recipient_raw_receiver}</span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Memo</span>
        <span className={styles.mono}>{summary.memo || "(none)"}</span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Leaving the fund</span>
        <span className={styles.mono}>
          {formatZat(summary.total_in)} {SWARM_TICKER} across {summary.inputs.length} whole output
          {summary.inputs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Fee</span>
        <span className={styles.mono}>
          {formatZat(summary.fee)} {SWARM_TICKER}
          {summary.fee !== summary.conventional_fee &&
            ` (ZIP-317 conventional ${formatZat(summary.conventional_fee)})`}
        </span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Change</span>
        <span className={styles.mono}>
          none — a coinbase spend may carry no transparent output at all
        </span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Network</span>
        <span className={styles.mono}>
          {summary.network} · {summary.network_upgrade}
        </span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Expires at height</span>
        <span className={styles.mono}>{summary.expiry_height}</span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.label}>Policy</span>
        <span className={styles.mono}>
          {summary.policy_fingerprint} · needs {summary.threshold} of{" "}
          {summary.signer_fingerprints.length}
        </span>
      </div>
    </div>

    <details className={styles.details}>
      <summary className={styles.detailsSummary}>
        The {summary.inputs.length} output{summary.inputs.length === 1 ? "" : "s"} being spent, and
        the digest each signer signs
      </summary>
      <div className={styles.detailsBody}>
        {summary.inputs.map((input, index) => (
          <div className={styles.factRow} key={`${input.txid}:${input.vout}`}>
            <span className={styles.label}>[{index}]</span>
            <span className={styles.mono}>
              {input.txid}:{input.vout} · {formatZat(input.value)} {SWARM_TICKER} · height{" "}
              {input.height}
              {input.is_coinbase ? " · coinbase" : ""}
              <br />
              digest {input.sighash_all_digest}
            </span>
          </div>
        ))}
      </div>
    </details>

    <details className={styles.details}>
      <summary className={styles.detailsSummary}>
        The same thing as the offline tool prints it
      </summary>
      <div className={`${styles.detailsBody} ${styles.mono}`}>
        {summary.lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </details>

    <div className={styles.factTotal}>
      <span className={styles.label}>Proposal hash</span>
      <span className={styles.mono}>{summary.proposal_hash}</span>
    </div>
    <div className={styles.fieldNote}>
      Compare this hash out loud with the other machine before either of you types a passphrase.
      It is computed here from the transaction&apos;s own bytes, not read out of the file.
    </div>
  </section>
);

export default ProposalCard;
