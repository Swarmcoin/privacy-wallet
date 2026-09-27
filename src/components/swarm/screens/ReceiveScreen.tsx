import React, { useContext, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import { ContextApp } from "../../../context/ContextAppState";
import { useCopy } from "../../common/useCopy";
import { SWARM_TICKER } from "../../../utils/swarmNetwork";
import { checkAddressForChain } from "../../../utils/swarmAddress";
import { incomingUnconfirmed } from "../swarmModel";

/**
 * Receive: the two addresses this wallet can be paid at, side by side, and
 * plain guidance on which one to hand over.
 *
 * What those addresses look like depends on the network: `swm1…` and `s1…`/`s3…`
 * on SWARM Mainnet, `swarm1…` and `tm…`/`t2…` on SwarmTestnet. A screen that
 * showed an address shape the wallet's own chain never produces would teach the
 * user to mistrust the real one.
 *
 * And one shape is never shown at all. On 2026-09-26 an owner installed the
 * first mainnet build, created a wallet through a screen that still offered
 * upstream Zcash's chains, and this screen showed him a `u1…` unified address —
 * a real Zcash mainnet address, in a SWARM wallet, which nothing in SWARM can
 * pay and which he had every reason to read as his. So an address is checked
 * against the wallet's own profile before it is drawn: anything else is named
 * as the foreign thing it is, with no QR code and no copy button, because the
 * only wrong thing to do with an address of unknown provenance is make it easy
 * to hand out.
 *
 * The mining lines are the only guidance here that is not about addresses, and
 * they are here because the two miners in SWARM Node want different ones:
 * getting that wrong is how a reward ends up somewhere the wallet cannot see.
 */

type AddressCardProps = {
  kicker: string;
  title: string;
  address: string | undefined;
  note: string;
  revealed?: boolean;
  /** The chain the wallet is on, which decides which addresses belong to it. */
  chain: string | undefined;
};

const AddressCard: React.FC<AddressCardProps> = ({ kicker, title, address, note, revealed, chain }) => {
  const { copied, copy } = useCopy(1500);

  // Undefined when there is nothing to check yet or when the chain is one this
  // application has no rules for; a verdict that refuses is an address that
  // does not belong to this wallet's network and must not be offered.
  const verdict = address ? checkAddressForChain(address, chain) : undefined;
  const foreign = !!address && (!verdict || !verdict.accepted);

  return (
    <section
      className={`${styles.panel} ${styles.panelPad} ${revealed ? styles.chainCardRevealed : styles.chainCard}`}
      aria-label={title}
    >
      <div className={revealed ? styles.chainKickerRevealed : styles.chainKicker}>{kicker}</div>
      <div className={styles.panelTitle}>{title}</div>

      {foreign ? (
        <div className={styles.empty} role="note">
          This is not a SWARM address. This wallet was created on a network SWARM does not serve, so nothing sent to
          it would arrive here. Create a new wallet to receive SWM.
        </div>
      ) : address ? (
        <>
          <div className={styles.qrFrame}>
            <QRCodeSVG value={address} size={168} includeMargin={false} level="M" />
          </div>
          <div className={styles.addressBlock}>{address}</div>
          <div className={styles.inputRow}>
            <button
              type="button"
              className={`${styles.btn} ${revealed ? "" : styles.btnPrimary}`}
              style={{ flex: 1, justifyContent: "center" }}
              onClick={() => copy(address)}
            >
              <SwarmIcon name="copy" size={14} />
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          This wallet has no {revealed ? "transparent" : "shielded"} address yet. It appears once the wallet has
          finished opening.
        </div>
      )}

      <div className={styles.statNote}>{note}</div>
    </section>
  );
};

export const ReceiveScreen: React.FC = () => {
  const { addressesUnified, addressesTransparent, valueTransfers, currentWallet } = useContext(ContextApp);
  const chain = currentWallet?.chain_name;
  const [showAll, setShowAll] = useState(false);

  const unified = addressesUnified?.[0]?.encoded_address;
  const transparent = addressesTransparent?.[0]?.encoded_address;

  // Not every zero-confirmation receipt: a failed one (a reward lost to a
  // fork among them) has zero confirmations too, and is not on its way.
  const incoming = incomingUnconfirmed(valueTransfers);

  return (
    <>
      <div className={styles.twoColumn}>
        <AddressCard
          kicker="SHIELDED · PRIVATE"
          title="Unified address"
          address={unified}
          chain={chain}
          note="Safe to reuse. Payments to it are not linkable on the chain, and the sender can attach an encrypted memo."
        />
        <div className={styles.sideColumn}>
          <AddressCard
            kicker="TRANSPARENT · PUBLIC"
            title="Transparent address"
            address={transparent}
            chain={chain}
            revealed
            note="Anything received here is visible on the chain until you shield it. Use it only when something cannot pay a unified address."
          />

          <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Which address to give out">
            <div className={styles.panelTitle}>Which one do I give out?</div>
            <div className={styles.guidance}>
              <div className={styles.guidanceRow}>
                <span className={styles.guidanceMark} aria-hidden="true">
                  <SwarmIcon name="receive" size={14} />
                </span>
                <div>
                  <strong>Payments from other wallets:</strong> give the unified address.
                </div>
              </div>
              <div className={styles.guidanceRow}>
                <span className={styles.guidanceMark} aria-hidden="true">
                  <SwarmIcon name="shield" size={14} />
                </span>
                <div>
                  <strong>Mining with SWARM Node:</strong> paste the unified address for the 1-thread built-in miner, or
                  the transparent address for the multi-core miner.
                </div>
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-label="Incoming">
            <div className={styles.panelHead}>
              <div className={styles.panelTitle}>Incoming · unconfirmed</div>
            </div>
            <div className={styles.panelBody}>
              {incoming.length === 0 ? (
                <div className={styles.empty}>Nothing on its way right now.</div>
              ) : (
                incoming.map((vt) => (
                  <div key={vt.txid} className={styles.rowItem} style={{ cursor: "default" }}>
                    <span className={`${styles.statusDot} ${styles.pendingDot}`} />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>Payment on its way</span>
                      <span className={styles.rowMeta}>{vt.confirmations}/3 confirmations</span>
                    </span>
                    <span className={`${styles.rowAmount} ${styles.rowAmountIn}`}>
                      +{vt.amount} {SWARM_TICKER}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {(addressesUnified?.length ?? 0) + (addressesTransparent?.length ?? 0) > 2 && (
        <button type="button" className={styles.panelLink} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Hide" : "Show"} every address this wallet owns →
        </button>
      )}
      {showAll && (
        <section className={styles.panel} aria-label="All addresses">
          <div className={styles.panelBody}>
            {[...(addressesUnified ?? []), ...(addressesTransparent ?? [])].map((a) => (
              <div key={a.encoded_address} className={styles.rowItem} style={{ cursor: "default" }}>
                <span className={`${styles.mono} ${styles.addressInline}`}>{a.encoded_address}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
};

export default ReceiveScreen;
