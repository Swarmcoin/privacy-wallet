import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import SwarmUiContext from "../SwarmUiContext";
import { SwarmProblemBar } from "../SwarmProblem";
import { chainSees, deriveBalances, formatSwm, isTransparentAddress, maskAmount } from "../swarmModel";
import { plainProblem } from "../swarmStatus";
import { ContextApp } from "../../../context/ContextAppState";
import { AddressKindEnum, SendPageStateClass, ServerChainNameEnum, ToAddrClass } from "../../appstate";
import Utils from "../../../utils/utils";
import ContactPicker from "../../common/ContactPicker";
import SendConfirmModal from "../../send/components/SendConfirmModal";
import SendManyJsonType from "../../send/components/SendManyJSONType";
import {
  FEE_QUOTE_DEBOUNCE_MS,
  calculateSendFee,
  calculateSpendable,
  trimSpendable,
} from "../../send/components/sendPipeline";
import {
  SWARM_COINS_ARE_TEST_COINS,
  SWARM_TICKER,
  addressPlaceholderFor,
  swarmProfileOrActive,
} from "../../../utils/swarmNetwork";
import { priceIsDimmed, priceIsShown } from "../../../price/swmPrice";
import { fiatLine } from "../../../price/swmPriceFormat";

/**
 * Send, as the mockup lays it out: the payment on the left, what it will cost
 * and what it will publish on the right.
 *
 * Nothing about deciding whether a payment can be made is new here. The
 * address is checked by `Utils.getAddressKind`, the fee is quoted by the
 * wallet through `calculateSendFee`, the spendable ceiling comes from
 * `calculateSpendable`, and the confirmation — the step that actually spends
 * money — is the application's existing `SendConfirmModal`, unchanged. This
 * file is the arrangement of those, and the sentences around them.
 *
 * "≈ $187.60 USD" under the amount is the SWM price from the SWARM price
 * service (specs/PRICE-DISPLAY.md), on mainnet wallets with the setting on,
 * greyed when the reading is not current. It is a display, never part of the
 * payment: what is sent is the SWM amount, and nothing here converts.
 *
 * One thing in the mockup is not here: the Slow / Normal / Fast fee picker.
 * This chain's fee is fixed by ZIP 317 and the wallet quotes it; three speeds
 * to choose between would be three prices that do not exist.
 */

type SendScreenProps = {
  sendTransaction: (sendJson: SendManyJsonType[]) => Promise<string>;
  setSendPageState: (sendPageState: SendPageStateClass) => void;
};

export const SendScreen: React.FC<SendScreenProps> = ({ sendTransaction, setSendPageState }) => {
  const { hidden } = useContext(SwarmUiContext);
  const { sendPageState, totalBalance, info, readOnly, currentWallet, addressBook, addressesUnified, swmPrice } =
    useContext(ContextApp);

  const chain: ServerChainNameEnum = currentWallet?.chain_name ?? ServerChainNameEnum.mainChainName;
  const profile = swarmProfileOrActive(chain);
  const balances = useMemo(() => deriveBalances(totalBalance), [totalBalance]);

  // The screen's own draft. It becomes a SendPageState only at the moment the
  // confirmation opens, so a half-typed address is never something the rest of
  // the application can act on.
  const prefilled = sendPageState.toaddrs.find(ToAddrClass.hasContent);
  const [to, setTo] = useState<string>(prefilled?.to ?? "");
  const [amount, setAmount] = useState<string>(prefilled?.amount ? String(prefilled.amount) : "");
  const [memo, setMemo] = useState<string>(prefilled?.memo ?? "");

  const [addressKind, setAddressKind] = useState<AddressKindEnum | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [spendable, setSpendable] = useState<number>(0);
  const [fee, setFee] = useState<number>(0);
  const [quoteError, setQuoteError] = useState<string>("");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trimmedTo = to.trim();
  const parsedAmount = Number(amount);
  const amountValid = amount.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const addressValid = trimmedTo.length > 0 && addressKind !== undefined;
  const transparentDestination = isTransparentAddress(trimmedTo, profile);

  // Ask the wallet what the address is. Debounced, because it is a call across
  // the bridge and the field is being typed into.
  useEffect(() => {
    if (!trimmedTo) {
      setAddressKind(undefined);
      setChecking(false);
      return undefined;
    }
    setChecking(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      Utils.getAddressKind(trimmedTo, chain)
        .then((kind) => {
          if (cancelled) return;
          setAddressKind(kind);
          setChecking(false);
        })
        .catch(() => {
          if (cancelled) return;
          setAddressKind(undefined);
          setChecking(false);
        });
    }, FEE_QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedTo, chain]);

  // What can be sent to this destination, fee included. Keyed on the address
  // alone: typing an amount must not refetch it.
  useEffect(() => {
    let cancelled = false;
    const address = addressValid ? trimmedTo : "";
    calculateSpendable(address, totalBalance.totalSpendableBalance).then(({ spendable: value }) => {
      if (!cancelled) setSpendable(value);
    });
    return () => {
      cancelled = true;
    };
  }, [addressValid, trimmedTo, totalBalance.totalSpendableBalance]);

  // The fee, quoted by the wallet for this exact payment.
  const quoteRef = useRef(0);
  useEffect(() => {
    if (!addressValid || !amountValid || readOnly) {
      setFee(0);
      setQuoteError("");
      return undefined;
    }
    const ticket = ++quoteRef.current;
    const timer = setTimeout(() => {
      const row = new ToAddrClass();
      row.to = trimmedTo;
      row.amount = parsedAmount;
      row.memo = memo;
      calculateSendFee([row]).then(({ fee: quoted, error }) => {
        if (quoteRef.current !== ticket) return;
        setFee(quoted);
        setQuoteError(error);
      });
    }, FEE_QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [addressValid, amountValid, trimmedTo, amount, parsedAmount, memo, readOnly]);

  const show = (value: number) => maskAmount(formatSwm(value), hidden);
  const amountFiat =
    !SWARM_COINS_ARE_TEST_COINS && amountValid && priceIsShown(swmPrice)
      ? fiatLine(parsedAmount, swmPrice.priceUsd, hidden)
      : null;
  const total = (Number.isFinite(parsedAmount) ? parsedAmount : 0) + fee;
  const overSpendable = amountValid && spendable > 0 && parsedAmount + fee > spendable;
  const canReview = !readOnly && addressValid && amountValid && !quoteError && !overSpendable;

  const facts = chainSees({
    shielded: !transparentDestination,
    address: trimmedTo,
    amount: amountValid ? formatSwm(parsedAmount) : undefined,
    fee: fee > 0 ? formatSwm(fee) : undefined,
    ticker: SWARM_TICKER,
  });

  const openConfirmation = () => {
    if (!canReview) return;
    const row = new ToAddrClass();
    row.to = trimmedTo;
    row.amount = parsedAmount;
    row.memo = memo;
    const next = new SendPageStateClass();
    next.toaddrs = [row];
    // Published before the modal opens: the modal reads the payment out of the
    // application's state, not out of this screen, which is what makes it the
    // same confirmation the old Send screen used.
    setSendPageState(next);
    setConfirmOpen(true);
  };

  const clearToAddrs = () => {
    setTo("");
    setAmount("");
    setMemo("");
    setSendPageState(new SendPageStateClass());
  };

  const contacts = (addressBook ?? []).filter((c) => !c.chain || c.chain === chain);
  const ownAddress = addressesUnified?.[0]?.encoded_address;

  return (
    <>
      {readOnly && (
        <div className={styles.problem} role="status">
          <span className={styles.problemIcon}>
            <SwarmIcon name="warning" size={18} />
          </span>
          <div className={styles.problemBody}>
            <div className={styles.problemHeadline}>This wallet is watch-only.</div>
            <div className={styles.problemText}>
              It can show you what arrives, but it holds no spending key and cannot pay anyone.
            </div>
          </div>
        </div>
      )}

      <SwarmProblemBar problem={plainProblem(quoteError)} />

      <div className={styles.twoColumn}>
        <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Payment">
          <div className={styles.field}>
            <span className={styles.label}>From</span>
            <div className={styles.fromBox}>
              <span className={styles.fromMark} aria-hidden="true">
                <SwarmIcon name="shield" size={15} />
              </span>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{currentWallet?.alias ?? "This wallet"}</span>
                <span className={styles.rowMeta}>
                  shielded · {show(balances.shielded)} {SWARM_TICKER}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="swarm-send-to">
              Recipient
            </label>
            <div className={styles.inputRow}>
              <input
                id="swarm-send-to"
                className={styles.input}
                value={to}
                spellCheck={false}
                placeholder={addressPlaceholderFor(profile)}
                onChange={(e) => setTo(e.target.value)}
                disabled={readOnly}
                aria-describedby="swarm-send-to-status"
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSmall}`}
                onClick={() => setContactsOpen(true)}
                disabled={readOnly}
              >
                Contacts
              </button>
            </div>
            <div id="swarm-send-to-status" aria-live="polite">
              {trimmedTo.length === 0 && <div className={styles.fieldNote}>Paste the address you were given.</div>}
              {trimmedTo.length > 0 && checking && <div className={styles.fieldNote}>Checking…</div>}
              {trimmedTo.length > 0 && !checking && addressValid && !transparentDestination && (
                <div className={styles.fieldOk}>
                  <SwarmIcon name="check" size={13} /> Shielded address — this payment will be private.
                </div>
              )}
              {trimmedTo.length > 0 && !checking && addressValid && transparentDestination && (
                <div className={styles.fieldWarn}>
                  <SwarmIcon name="eye" size={13} /> Transparent address — the amount and this address will be public.
                </div>
              )}
              {trimmedTo.length > 0 && !checking && !addressValid && (
                <div className={styles.fieldBad}>
                  <SwarmIcon name="warning" size={13} /> Not an address this network recognises.
                </div>
              )}
              {ownAddress && trimmedTo === ownAddress && (
                <div className={styles.fieldNote}>This is your own address. The payment would come back to you.</div>
              )}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="swarm-send-amount">
              Amount
            </label>
            <div className={styles.amountBox}>
              <input
                id="swarm-send-amount"
                className={`${styles.amountInput} ${styles.amountInputLarge}`}
                value={amount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
                disabled={readOnly}
              />
              <span className={styles.amountTicker}>{SWARM_TICKER}</span>
              <button
                type="button"
                className={styles.maxButton}
                disabled={readOnly || spendable <= 0}
                onClick={() => setAmount(String(trimSpendable(spendable)))}
              >
                MAX
              </button>
            </div>
            {amountFiat && (
              <div
                className={`${styles.fiatNote} ${priceIsDimmed(swmPrice) ? styles.fiatDim : ""}`}
                data-testid="send-amount-fiat"
              >
                {amountFiat}
              </div>
            )}
            <div className={styles.fieldNote}>
              {spendable > 0
                ? `${show(spendable)} ${SWARM_TICKER} spendable, fee included`
                : "Nothing spendable yet — coins need three confirmations."}
            </div>
            {overSpendable && (
              <div className={styles.fieldBad}>
                <SwarmIcon name="warning" size={13} /> More than this wallet can send, once the fee is counted.
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="swarm-send-memo">
              Memo{" "}
              <span className={styles.labelHint}>
                {transparentDestination
                  ? "(a transparent address cannot carry a memo)"
                  : "(optional — encrypted, only the recipient can read it)"}
              </span>
            </label>
            <input
              id="swarm-send-memo"
              className={`${styles.input} ${styles.inputText}`}
              value={memo}
              placeholder={transparentDestination ? "" : "What is this payment for?"}
              onChange={(e) => setMemo(e.target.value)}
              disabled={readOnly || transparentDestination}
            />
          </div>
        </section>

        <div className={styles.sideColumn}>
          <section
            className={`${styles.panel} ${styles.panelPad} ${
              transparentDestination ? styles.chainCardRevealed : styles.chainCard
            }`}
            aria-label="What the chain will see"
          >
            <div className={transparentDestination ? styles.chainKickerRevealed : styles.chainKicker}>
              WHAT THE CHAIN WILL SEE
            </div>
            <div className={styles.factList}>
              {facts.map((f) => (
                <div key={f.key} className={styles.factRow}>
                  <span>{f.key}</span>
                  <span className={f.hidden ? styles.factHidden : styles.factVisible}>{f.value}</span>
                </div>
              ))}
            </div>
            <div className={styles.statNote}>
              {transparentDestination
                ? "Sending to a transparent address makes the address and the amount public."
                : "A shielded payment publishes that a transaction happened and what it paid in fees. Nothing else."}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Summary">
            <div className={styles.panelTitle}>Summary</div>
            <div className={styles.factList}>
              <div className={styles.factRow}>
                <span>Amount</span>
                <span className={styles.mono}>
                  {amountValid ? show(parsedAmount) : "—"} {SWARM_TICKER}
                </span>
              </div>
              <div className={styles.factRow}>
                <span>Network fee</span>
                <span className={styles.mono}>
                  {fee > 0 ? `${formatSwm(fee)} ${SWARM_TICKER}` : "quoted when the payment is ready"}
                </span>
              </div>
              <div className={`${styles.factRow} ${styles.factTotal}`}>
                <span>Total</span>
                <span className={styles.mono}>
                  {amountValid ? show(total) : "—"} {SWARM_TICKER}
                </span>
              </div>
            </div>
            <div className={styles.statNote}>The fee is set by the network, not chosen.</div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnWide}`}
              onClick={openConfirmation}
              disabled={!canReview}
            >
              Review payment
            </button>
            <div className={styles.statNote} style={{ textAlign: "center" }}>
              Nothing is sent until you confirm on the next step.
            </div>
          </section>
        </div>
      </div>

      <ContactPicker
        contacts={contacts}
        chainLabel={Utils.chainDisplayName(chain)}
        modalIsOpen={contactsOpen}
        closeModal={() => setContactsOpen(false)}
        onSelect={(address) => {
          setTo(address);
          setContactsOpen(false);
        }}
      />

      <SendConfirmModal
        sendPageState={sendPageState}
        totalBalance={totalBalance}
        info={info}
        sendTransaction={sendTransaction}
        clearToAddrs={clearToAddrs}
        closeModal={() => setConfirmOpen(false)}
        modalIsOpen={confirmOpen}
        sendFee={fee}
        currencyName={info.currencyName || SWARM_TICKER}
      />
    </>
  );
};

export default SendScreen;
