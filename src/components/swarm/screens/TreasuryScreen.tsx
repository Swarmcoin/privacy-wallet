import React, { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import styles from "../Swarm.module.css";
import { SwarmIcon } from "../SwarmIcons";
import { ContextApp } from "../../../context/ContextAppState";
import { SWARM_TICKER } from "../../../utils/swarmNetwork";
import { useCopy } from "../../common/useCopy";
import {
  explainSelection,
  formatZat,
  selectUtxos,
  truncationNote,
  type TreasuryUtxoSet,
} from "../../../treasury/selectUtxos";
import {
  canSignIncoming,
  incomingReducer,
  initialIncoming,
  initialPayout,
  payoutReducer,
  readyToCombine,
  signaturesOutstanding,
  signersForFund,
  type RegisteredSigner,
} from "../../../treasury/treasuryMachine";
import {
  base64ToHex,
  parseEnvelope,
  type RelayEnvelope,
} from "../../../treasury/relayClient";
import {
  isSessionCode,
  newSessionCode,
  normaliseSessionCode,
  sessionCodeProblem,
} from "../../../treasury/sessionCode";
import * as treasury from "../../../treasury/treasuryService";
import type { LoadedFund } from "../../../treasury/treasuryService";
import { PassphrasePrompt } from "../components/PassphrasePrompt";
import { ProposalCard } from "../components/ProposalCard";

/**
 * Treasury: a 2-of-3 fund payout, without the command line.
 *
 * The ceremony has not changed — it is the same `swarm-treasury` policy
 * check, the same proposal, the same two independent signatures, the same
 * combiner running the same script interpreter. What has changed is that the
 * files no longer have to be carried by hand. A payout is sealed under a
 * six-word code, left on a relay that cannot read it, and picked up on the
 * other machine by someone who types those six words.
 *
 * Read this screen as four things in a row, because that is the order the
 * ceremony happens in:
 *
 * 1. **Signers** — once per machine. A `.signer.age` backup is chosen, its
 *    passphrase is asked for once to prove it opens, and it is copied into
 *    this app's data directory *still encrypted*. Nothing here ever holds a
 *    decrypted key on disk.
 * 2. **Funds** — the four policies the build ships, read-only, each shown
 *    with the fingerprint this build recomputed (not the one the file
 *    claims) and what the indexer says its address holds.
 * 3. **New payout** — the coordinating machine. Pick a fund, an amount, a
 *    recipient; the app selects whole mature outputs and says in a sentence
 *    what will actually arrive; then build, sign here if this machine can,
 *    and share.
 * 4. **Incoming payout** — the other machine. Six words in, the same card
 *    out, sign, and the signature goes back sealed.
 *
 * Every panel prints the proposal hash. That is not decoration: it is the
 * identity of the payout, it is recomputed from the raw transaction on every
 * screen that shows it, and a signature carrying a different one is refused
 * here before the addon ever sees it.
 */

/** How far ahead of the tip a payout may be mined. */
const EXPIRY_WINDOW = 400;

type Tab = "signers" | "funds" | "payout" | "incoming";

const TABS: { id: Tab; label: string }[] = [
  { id: "signers", label: "Signers" },
  { id: "funds", label: "Funds" },
  { id: "payout", label: "New payout" },
  { id: "incoming", label: "Incoming payout" },
];

/** What the passphrase modal is being opened for. */
type PassphraseAsk =
  | { for: "register"; ageHex: string; path: string }
  | { for: "sign-here"; fingerprint: string; label: string }
  | { for: "sign-incoming"; fingerprint: string; label: string };

export const TreasuryScreen: React.FC = () => {
  const { info, currentWallet, addressesUnified } = useContext(ContextApp);

  const [tab, setTab] = useState<Tab>("funds");
  const [funds, setFunds] = useState<LoadedFund[]>([]);
  const [policyProblems, setPolicyProblems] = useState<string[]>([]);
  const [signers, setSigners] = useState<RegisteredSigner[]>([]);
  const [balances, setBalances] = useState<Record<string, TreasuryUtxoSet | string>>({});
  const [ask, setAsk] = useState<PassphraseAsk | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [payout, dispatch] = useReducer(payoutReducer, initialPayout);
  const [incoming, dispatchIncoming] = useReducer(incomingReducer, initialIncoming);

  // The payout form, kept outside the machine: these are keystrokes, not
  // ceremony steps, and a reducer event per character would say otherwise.
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [memo, setMemo] = useState("");

  const serverUri = currentWallet?.uri ?? "";
  const tip = info?.latestBlock ?? 0;

  /** This wallet's own shielded address: where a payout goes unless told otherwise. */
  const ownAddress = useMemo(
    () => addressesUnified?.find((a) => a.has_orchard)?.encoded_address ?? "",
    [addressesUnified],
  );

  useEffect(() => {
    if (recipient === "" && ownAddress) setRecipient(ownAddress);
  }, [ownAddress, recipient]);

  const refreshSigners = useCallback(async () => {
    try {
      setSigners(await treasury.listSigners());
    } catch (error) {
      setNotice(`Could not read this machine's signers: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await treasury.loadFunds();
        if (!live) return;
        setFunds(loaded.funds);
        setPolicyProblems(loaded.problems);
      } catch (error) {
        if (live) setPolicyProblems([String(error)]);
      }
    })();
    refreshSigners();
    return () => {
      live = false;
    };
  }, [refreshSigners]);

  /**
   * Which fund the payout panel is on, as of the last choice.
   *
   * A ref, not `payout.fund`: the callbacks that need it run in the very
   * event that made the choice, and a callback reads `payout` from the render
   * it was made in, which had not seen the choice yet. Reading it from there
   * is how "New payout" once waited for ever on "asking the indexer": the
   * answer came back, was compared with the fund before the click, and was
   * dropped.
   */
  const payoutFundName = useRef<string | null>(null);

  /** Asks the indexer what a fund holds, for the Funds tab, and answers it or why not. */
  const loadBalance = useCallback(
    async (fund: LoadedFund): Promise<TreasuryUtxoSet | string> => {
      if (!serverUri) return "This wallet has no server to ask what the fund holds.";
      setBalances((prev) => ({ ...prev, [fund.name]: "asking the indexer…" }));
      try {
        const set = await treasury.loadFundUtxos(serverUri, fund);
        setBalances((prev) => ({ ...prev, [fund.name]: set }));
        return set;
      } catch (error) {
        setBalances((prev) => ({ ...prev, [fund.name]: String(error) }));
        return String(error);
      }
    },
    [serverUri],
  );

  /** The Funds tab's Refresh: the payout gets the fresh outputs too, if it is on that fund. */
  const refreshFund = useCallback(
    async (fund: LoadedFund) => {
      const answer = await loadBalance(fund);
      if (typeof answer !== "string" && payoutFundName.current === fund.name) {
        dispatch({ type: "utxos-loaded", utxos: answer });
      }
    },
    [loadBalance],
  );

  /** Loads a fund's outputs into the payout panel, or says there why it could not. */
  const loadPayoutOutputs = useCallback(
    async (fund: LoadedFund) => {
      dispatch({ type: "busy", what: "asking the indexer what this fund holds" });
      const answer = await loadBalance(fund);
      // The payout may have moved to another fund while the indexer answered.
      if (payoutFundName.current !== fund.name) return;
      if (typeof answer === "string") dispatch({ type: "problem", message: answer });
      else dispatch({ type: "utxos-loaded", utxos: answer });
    },
    [loadBalance],
  );

  // -- the selection, recomputed as the amount is typed ---------------------

  const utxoSet = payout.utxos;
  const selection = useMemo(() => {
    if (!utxoSet) return null;
    const zat = Math.round(Number(amount) * 100_000_000);
    if (!amount.trim() || !Number.isFinite(zat)) return null;
    return selectUtxos(utxoSet.utxos, zat, utxoSet);
  }, [utxoSet, amount]);

  // -- actions ---------------------------------------------------------------

  const chooseFund = useCallback(
    async (fund: LoadedFund) => {
      payoutFundName.current = fund.name;
      dispatch({ type: "fund-chosen", fund });
      setTab("payout");
      const known = balances[fund.name];
      if (known && typeof known !== "string") {
        dispatch({ type: "utxos-loaded", utxos: known });
      } else {
        await loadPayoutOutputs(fund);
      }
    },
    [balances, loadPayoutOutputs],
  );

  const build = useCallback(async () => {
    const fund = payout.fund as LoadedFund | null;
    if (!fund || !selection || !selection.ok) return;
    if (!recipient.trim()) {
      dispatch({ type: "problem", message: "Say where the money goes." });
      return;
    }
    dispatch({ type: "busy", what: "building the proposal and its shielded proof" });
    try {
      const { proposalJson, summary } = await treasury.buildProposal({
        fund,
        utxos: selection.selected,
        recipient: recipient.trim(),
        memo,
        expiryHeight: tip + EXPIRY_WINDOW,
      });
      dispatch({ type: "proposal-built", proposalJson, summary });
    } catch (error) {
      dispatch({ type: "problem", message: String(error) });
    }
  }, [payout.fund, selection, recipient, memo, tip]);

  const signHere = useCallback(
    async (passphrase: string, fingerprint: string) => {
      const fund = payout.fund;
      if (!fund || !payout.proposalJson) return;
      dispatch({ type: "busy", what: "signing" });
      try {
        const signed = await treasury.signProposal({
          proposalJson: payout.proposalJson,
          policyJson: fund.policyJson,
          fingerprint,
          passphrase,
        });
        dispatch({
          type: "signature-added",
          signature: {
            json: signed.signatureJson,
            fingerprint: signed.fingerprint,
            label: signed.label,
            proposalHash: signed.proposalHash,
            origin: "this machine",
          },
        });
      } catch (error) {
        dispatch({ type: "problem", message: String(error) });
      }
    },
    [payout.fund, payout.proposalJson],
  );

  const share = useCallback(async () => {
    const fund = payout.fund;
    if (!fund || !payout.proposalJson || !payout.summary) return;
    dispatch({ type: "busy", what: "sealing the proposal and handing it to the relay" });
    try {
      const code = payout.sessionCode ?? newSessionCode();
      const sessionId = await treasury.sessionIdFor(code);
      const envelope: RelayEnvelope = {
        v: 1,
        kind: "proposal",
        policy: fund.policyJson,
        proposal: payout.proposalJson,
        proposalHash: payout.summary.proposal_hash,
        from: "coordinator",
      };
      const sealed = await treasury.seal(code, JSON.stringify(envelope));
      await treasury.relayFor(serverUri).put(sessionId, sealed);
      dispatch({ type: "shared", sessionCode: code, sessionId });
    } catch (error) {
      dispatch({ type: "problem", message: String(error) });
    }
  }, [payout.fund, payout.proposalJson, payout.summary, payout.sessionCode, serverUri]);

  const collect = useCallback(async () => {
    const code = payout.sessionCode;
    const sessionId = payout.sessionId;
    if (!code || !sessionId || !payout.summary) return;
    dispatch({ type: "busy", what: "asking the relay whether the other machine has answered" });
    try {
      const session = await treasury.relayFor(serverUri).get(sessionId);
      if (!session) {
        dispatch({ type: "problem", message: "Nothing is on the relay under this code yet." });
        return;
      }
      let added = 0;
      for (const blob of session.blobs) {
        let envelope: RelayEnvelope;
        try {
          envelope = parseEnvelope(await treasury.unseal(code, base64ToHex(blob.body)));
        } catch {
          // A blob this code does not open, or does not understand. The
          // relay is a public path: anyone who guessed the id could have put
          // something there. Skipping is the whole response.
          continue;
        }
        if (envelope.kind !== "signature") continue;
        const parsed = JSON.parse(envelope.signature) as { fingerprint: string; label: string };
        dispatch({
          type: "signature-added",
          signature: {
            json: envelope.signature,
            fingerprint: parsed.fingerprint,
            label: parsed.label,
            proposalHash: envelope.proposalHash,
            origin: "the relay",
          },
        });
        added += 1;
      }
      if (added === 0) {
        dispatch({
          type: "problem",
          message: "The relay has the proposal but no signature back yet.",
        });
      }
    } catch (error) {
      dispatch({ type: "problem", message: String(error) });
    }
  }, [payout.sessionCode, payout.sessionId, payout.summary, serverUri]);

  const finalise = useCallback(async () => {
    const fund = payout.fund;
    if (!fund || !payout.proposalJson || !readyToCombine(payout)) return;
    dispatch({ type: "busy", what: "combining, and checking the result with the script interpreter" });
    try {
      const combined = await treasury.combine(
        payout.proposalJson,
        fund.policyJson,
        payout.signatures.map((s) => s.json),
      );
      dispatch({ type: "combined", txid: combined.txid, finalHex: combined.raw_hex });
    } catch (error) {
      dispatch({ type: "problem", message: String(error) });
    }
  }, [payout]);

  const send = useCallback(async () => {
    if (!payout.finalHex) return;
    dispatch({ type: "busy", what: "handing the transaction to the network" });
    try {
      const txid = await treasury.broadcast(serverUri, payout.finalHex);
      dispatch({ type: "broadcast", txid });
    } catch (error) {
      dispatch({ type: "problem", message: String(error) });
    }
  }, [payout.finalHex, serverUri]);

  // -- the second machine ----------------------------------------------------

  const fetchIncoming = useCallback(async () => {
    const problem = sessionCodeProblem(incoming.code);
    if (problem) {
      dispatchIncoming({ type: "problem", message: problem });
      return;
    }
    const code = normaliseSessionCode(incoming.code);
    dispatchIncoming({ type: "busy", what: "fetching" });
    try {
      const sessionId = await treasury.sessionIdFor(code);
      const session = await treasury.relayFor(serverUri).get(sessionId);
      if (!session || session.blobs.length === 0) {
        dispatchIncoming({
          type: "problem",
          message: "Nothing is waiting under that code yet.",
        });
        return;
      }
      for (const blob of session.blobs) {
        let envelope: RelayEnvelope;
        try {
          envelope = parseEnvelope(await treasury.unseal(code, base64ToHex(blob.body)));
        } catch {
          continue;
        }
        if (envelope.kind !== "proposal") continue;
        // The policy arrives with the proposal, and is verified here rather
        // than believed: `treasury_policy_verify` recomputes the redeem
        // script, the address and the fingerprint. A policy that arrived
        // edited would be refused before a card is drawn.
        const verified = await treasury.loadFunds();
        const summary = await treasury.summarise(envelope.proposal, envelope.policy);
        const shipped = verified.funds.find((f) => f.fingerprint === summary.policy_fingerprint);
        if (!shipped) {
          dispatchIncoming({
            type: "problem",
            message: `This proposal is under a policy this build does not ship (${summary.policy_fingerprint}). Do not sign it.`,
          });
          return;
        }
        dispatchIncoming({
          type: "fetched",
          sessionId,
          fund: shipped,
          proposalJson: envelope.proposal,
          summary,
        });
        return;
      }
      dispatchIncoming({
        type: "problem",
        message: "That code opened nothing on the relay. Check the six words.",
      });
    } catch (error) {
      dispatchIncoming({ type: "problem", message: String(error) });
    }
  }, [incoming.code, serverUri]);

  const signIncoming = useCallback(
    async (passphrase: string, fingerprint: string) => {
      if (!incoming.fund || !incoming.proposalJson || !incoming.summary || !incoming.sessionId) {
        return;
      }
      dispatchIncoming({ type: "busy", what: "signing" });
      try {
        const signed = await treasury.signProposal({
          proposalJson: incoming.proposalJson,
          policyJson: incoming.fund.policyJson,
          fingerprint,
          passphrase,
        });
        dispatchIncoming({ type: "signed", signedBy: signed.label });
        const envelope: RelayEnvelope = {
          v: 1,
          kind: "signature",
          signature: signed.signatureJson,
          proposalHash: signed.proposalHash,
          fingerprint: signed.fingerprint,
          from: signed.label,
        };
        const sealed = await treasury.seal(
          normaliseSessionCode(incoming.code),
          JSON.stringify(envelope),
        );
        await treasury.relayFor(serverUri).put(incoming.sessionId, sealed);
        dispatchIncoming({ type: "returned" });
      } catch (error) {
        dispatchIncoming({ type: "problem", message: String(error) });
      }
    },
    [incoming.fund, incoming.proposalJson, incoming.summary, incoming.sessionId, incoming.code, serverUri],
  );

  const onPassphrase = useCallback(
    async (passphrase: string) => {
      const request = ask;
      setAsk(null);
      if (!request) return;
      if (request.for === "register") {
        try {
          await treasury.registerSigner(request.ageHex, passphrase);
          setNotice(`Registered the signer in ${request.path}.`);
          await refreshSigners();
        } catch (error) {
          setNotice(String(error));
        }
        return;
      }
      if (request.for === "sign-here") await signHere(passphrase, request.fingerprint);
      if (request.for === "sign-incoming") await signIncoming(passphrase, request.fingerprint);
    },
    [ask, refreshSigners, signHere, signIncoming],
  );

  const pick = useCallback(async () => {
    try {
      const chosen = await treasury.pickSignerFile();
      if (!chosen) return;
      setAsk({ for: "register", ageHex: chosen.ageHex, path: chosen.path });
    } catch (error) {
      setNotice(String(error));
    }
  }, []);

  // -- rendering -------------------------------------------------------------

  const heldForPayout = signersForFund(payout.fund, signers);
  const heldForIncoming = signersForFund(incoming.fund, signers);

  return (
    <div className={styles.panelGrid}>
      <div className={styles.filterBar} role="tablist" aria-label="Treasury sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`${styles.chip} ${tab === entry.id ? styles.chipActive : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className={styles.guidance} role="status">
          {notice}
        </div>
      )}

      {tab === "signers" && (
        <SignersPanel signers={signers} onPick={pick} onRemove={async (fingerprint) => {
          await treasury.removeSigner(fingerprint);
          await refreshSigners();
        }} />
      )}

      {tab === "funds" && (
        <FundsPanel
          funds={funds}
          problems={policyProblems}
          balances={balances}
          onRefresh={refreshFund}
          onPayout={chooseFund}
        />
      )}

      {tab === "payout" && (
        <section className={`${styles.panel} ${styles.panelPad}`} aria-label="New payout">
          <div className={styles.panelTitle}>New payout</div>

          {!payout.fund ? (
            <div className={styles.empty}>Choose a fund on the Funds tab to start a payout.</div>
          ) : (
            <>
              <div className={styles.factList}>
                <div className={styles.factRow}>
                  <span className={styles.label}>Fund</span>
                  <span className={styles.mono}>
                    {payout.fund.name} · {payout.fund.threshold}-of-
                    {payout.fund.signerFingerprints.length}
                  </span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.label}>Policy fingerprint</span>
                  <span className={styles.mono}>{payout.fund.fingerprint}</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.label}>From</span>
                  <span className={styles.mono}>{payout.fund.address}</span>
                </div>
                <div className={styles.factRow}>
                  <span className={styles.label}>Expiry height</span>
                  <span className={styles.mono}>
                    {tip + EXPIRY_WINDOW} (tip {tip} + {EXPIRY_WINDOW})
                  </span>
                </div>
              </div>

              {!payout.proposalJson && (
                <>
                  <label className={styles.label} htmlFor="treasury-amount">
                    At least how much, in {SWARM_TICKER}
                  </label>
                  <input
                    id="treasury-amount"
                    className={styles.input}
                    value={amount}
                    inputMode="decimal"
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00000000"
                  />

                  <label className={styles.label} htmlFor="treasury-recipient">
                    To
                  </label>
                  <input
                    id="treasury-recipient"
                    className={`${styles.input} ${styles.mono}`}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  />
                  {recipient === ownAddress && ownAddress !== "" && (
                    <div className={styles.fieldNote}>
                      This wallet&apos;s own shielded address. Change it to pay someone else.
                    </div>
                  )}

                  <label className={styles.label} htmlFor="treasury-memo">
                    Memo
                  </label>
                  <input
                    id="treasury-memo"
                    className={styles.input}
                    value={memo}
                    maxLength={400}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="What this payout is for"
                  />

                  {utxoSet?.truncated && (
                    <div className={styles.fieldNote} role="note">
                      {truncationNote(utxoSet)}
                    </div>
                  )}
                  {selection && !selection.ok && (
                    <div className={styles.fieldBad} role="alert">
                      {selection.reason}
                    </div>
                  )}
                  {selection && selection.ok && (
                    <div className={styles.guidance} role="note">
                      {explainSelection(selection, null, SWARM_TICKER)}
                      <div className={styles.fieldNote}>
                        {selection.selected.length} output
                        {selection.selected.length === 1 ? "" : "s"}, heights{" "}
                        {selection.selected.map((u) => u.height).join(", ")}.
                      </div>
                    </div>
                  )}

                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={!selection?.ok || !!payout.busy}
                      onClick={build}
                    >
                      Build the proposal
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => payout.fund && loadPayoutOutputs(payout.fund as LoadedFund)}
                    >
                      Refresh outputs
                    </button>
                  </div>
                </>
              )}

              {payout.summary && (
                <>
                  <ProposalCard summary={payout.summary} />

                  <div className={styles.factList}>
                    <div className={styles.factRow}>
                      <span className={styles.label}>Signatures</span>
                      <span className={styles.mono}>
                        {payout.signatures.length} of {payout.fund.threshold}
                        {payout.signatures.length > 0 &&
                          ` — ${payout.signatures.map((s) => `${s.label} (${s.origin})`).join(", ")}`}
                      </span>
                    </div>
                  </div>

                  <div className={styles.actionRow}>
                    {heldForPayout.map((held) => (
                      <button
                        key={held.fingerprint}
                        type="button"
                        className={styles.btn}
                        disabled={payout.signatures.some((s) => s.fingerprint === held.fingerprint)}
                        onClick={() =>
                          setAsk({
                            for: "sign-here",
                            fingerprint: held.fingerprint,
                            label: held.label,
                          })
                        }
                      >
                        Sign here as {held.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={!!payout.busy}
                      onClick={share}
                    >
                      {payout.shared ? "Share again" : "Share for second signature"}
                    </button>
                    {payout.shared && (
                      <button type="button" className={styles.btn} onClick={collect}>
                        Check for signatures
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={!readyToCombine(payout) || !!payout.busy}
                      onClick={finalise}
                    >
                      Combine{" "}
                      {signaturesOutstanding(payout) > 0 &&
                        `(${signaturesOutstanding(payout)} more needed)`}
                    </button>
                  </div>

                  {payout.sessionCode && <SessionCodeCard code={payout.sessionCode} />}

                  {payout.txid && payout.step === "broadcasting" && (
                    <div className={styles.guidance} role="status">
                      <div className={styles.panelTitle}>Combined</div>
                      <div className={styles.mono}>{payout.txid}</div>
                      <div className={styles.fieldNote}>
                        The script interpreter accepted this transaction. Broadcasting is the
                        last step, and it is the only irreversible one: read the amount and the
                        recipient on the card once more first.
                      </div>
                      <div className={styles.actionRow}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          disabled={!!payout.busy}
                          onClick={send}
                        >
                          Broadcast
                        </button>
                      </div>
                    </div>
                  )}

                  {payout.step === "done" && payout.txid && (
                    <div className={styles.guidance} role="status">
                      <div className={styles.panelTitle}>Sent</div>
                      <div className={styles.mono}>{payout.txid}</div>
                      <div className={styles.fieldNote}>
                        The network took it. From here it is a payment like any other: it will
                        appear in this wallet&apos;s own Activity, with its confirmations, as
                        soon as the wallet next syncs past the block it lands in. The payout is
                        shielded, so what Activity shows is the note arriving, not the fund
                        spending.
                      </div>
                    </div>
                  )}
                </>
              )}

              {payout.busy && <div className={styles.fieldNote}>Working: {payout.busy}…</div>}
              {payout.problem && (
                <div className={styles.fieldBad} role="alert">
                  {payout.problem}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === "incoming" && (
        <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Incoming payout">
          <div className={styles.panelTitle}>Incoming payout</div>
          <div className={styles.fieldNote}>
            The coordinating machine shows six words. Type them here.
          </div>
          <label className={styles.label} htmlFor="treasury-code">
            Session code
          </label>
          <input
            id="treasury-code"
            className={`${styles.input} ${styles.mono}`}
            value={incoming.code}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => dispatchIncoming({ type: "code-typed", code: e.target.value })}
            placeholder="six words"
          />
          <div className={styles.actionRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!isSessionCode(incoming.code) || !!incoming.busy}
              onClick={fetchIncoming}
            >
              Fetch the payout
            </button>
            {incoming.step !== "enter-code" && (
              <button
                type="button"
                className={styles.btn}
                onClick={() => dispatchIncoming({ type: "reset" })}
              >
                Start over
              </button>
            )}
          </div>

          {incoming.summary && (
            <>
              <ProposalCard summary={incoming.summary} />
              {heldForIncoming.length === 0 ? (
                <div className={styles.fieldWarn} role="note">
                  This machine holds no signer that this fund&apos;s policy names, so it cannot
                  sign this payout. Register the signer file on the Signers tab.
                </div>
              ) : (
                <div className={styles.actionRow}>
                  {heldForIncoming.map((held) => (
                    <button
                      key={held.fingerprint}
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={
                        !canSignIncoming(incoming, signers) ||
                        incoming.step === "returned" ||
                        !!incoming.busy
                      }
                      onClick={() =>
                        setAsk({
                          for: "sign-incoming",
                          fingerprint: held.fingerprint,
                          label: held.label,
                        })
                      }
                    >
                      Sign as {held.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {incoming.step === "returned" && (
            <div className={styles.guidance} role="status">
              Signed and sent back, sealed under the same code. The coordinating machine can
              combine now. Nothing else is needed from this machine.
            </div>
          )}
          {incoming.busy && <div className={styles.fieldNote}>Working: {incoming.busy}…</div>}
          {incoming.problem && (
            <div className={styles.fieldBad} role="alert">
              {incoming.problem}
            </div>
          )}
        </section>
      )}

      {ask && (
        <PassphrasePrompt
          title={
            ask.for === "register"
              ? "The passphrase for this signer file"
              : `Sign as ${ask.label}`
          }
          explanation={
            ask.for === "register"
              ? "Asked once, to prove the file opens and to read its label and fingerprint. It is not stored: every signature asks again."
              : "Used for this one signature and then dropped. It is never written down by this application."
          }
          onCancel={() => setAsk(null)}
          onSubmit={onPassphrase}
        />
      )}
    </div>
  );
};

// -- the panels ---------------------------------------------------------------

const SignersPanel: React.FC<{
  signers: RegisteredSigner[];
  onPick: () => void;
  onRemove: (fingerprint: string) => Promise<void>;
}> = ({ signers, onPick, onRemove }) => (
  <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Signers">
    <div className={styles.panelTitle}>Signers on this machine</div>
    <div className={styles.fieldNote}>
      One per machine, as the custody design says. The file is copied here still encrypted under
      the passphrase from the ceremony; this application never writes a decrypted key to disk and
      never keeps a passphrase.
    </div>
    {signers.length === 0 ? (
      <div className={styles.empty}>
        No signer is registered on this machine. It can still coordinate a payout and watch the
        funds; it cannot sign.
      </div>
    ) : (
      <div className={styles.factList}>
        {signers.map((signer) => (
          <div className={styles.factRow} key={signer.fingerprint}>
            <span className={styles.label}>{signer.label}</span>
            <span className={styles.mono}>{signer.fingerprint}</span>
            <button type="button" className={styles.btnSmall} onClick={() => onRemove(signer.fingerprint)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    )}
    <div className={styles.actionRow}>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onPick}>
        <SwarmIcon name="addresses" size={15} /> Register a signer file
      </button>
    </div>
  </section>
);

const FundsPanel: React.FC<{
  funds: LoadedFund[];
  problems: string[];
  balances: Record<string, TreasuryUtxoSet | string>;
  onRefresh: (fund: LoadedFund) => void;
  onPayout: (fund: LoadedFund) => void;
}> = ({ funds, problems, balances, onRefresh, onPayout }) => (
  <section className={`${styles.panel} ${styles.panelPad}`} aria-label="Funds">
    <div className={styles.panelTitle}>Funds</div>
    <div className={styles.fieldNote}>
      The policies this build ships, read-only. Every fingerprint below was recomputed by this
      build from the policy&apos;s own keys — it is not the number the file claims.
    </div>
    {problems.map((problem) => (
      <div className={styles.fieldBad} key={problem} role="alert">
        A shipped policy did not verify: {problem}
      </div>
    ))}
    {funds.map((fund) => {
      const balance = balances[fund.name];
      return (
        <div className={styles.factList} key={fund.name}>
          <div className={styles.factRow}>
            <span className={styles.label}>{fund.name}</span>
            <span className={styles.mono}>
              {fund.threshold}-of-{fund.signerFingerprints.length}
            </span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.label}>Address</span>
            <span className={styles.mono}>{fund.address}</span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.label}>Policy fingerprint</span>
            <span className={styles.mono}>{fund.fingerprint}</span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.label}>Balance</span>
            <span className={styles.mono}>
              {balance === undefined
                ? "not asked yet"
                : typeof balance === "string"
                  ? balance
                  : `${formatZat(balance.mature_total)} mature, ${formatZat(balance.immature_total)} not yet spendable (${balance.utxos.length} outputs at height ${balance.chain_height})`}
            </span>
          </div>
          {balance !== undefined && typeof balance !== "string" && balance.truncated && (
            <div role="note">
              <div className={styles.fieldNote}>{truncationNote(balance)}</div>
              {balance.total_value !== undefined && (
                <div className={styles.fieldNote}>
                  The whole fund holds {formatZat(balance.total_value)}; the balance above counts only what is shown.
                </div>
              )}
            </div>
          )}
          <div className={styles.actionRow}>
            <button type="button" className={styles.btnSmall} onClick={() => onRefresh(fund)}>
              Refresh
            </button>
            <button type="button" className={styles.btnSmall} onClick={() => onPayout(fund)}>
              New payout from {fund.name}
            </button>
          </div>
        </div>
      );
    })}
  </section>
);

const SessionCodeCard: React.FC<{ code: string }> = ({ code }) => {
  const { copied, copy } = useCopy(1500);
  return (
    <div className={styles.guidance} role="note">
      <div className={styles.panelTitle}>Read these six words to the other machine</div>
      <div className={`${styles.mono} ${styles.balanceValue}`}>{code}</div>
      <div className={styles.fieldNote}>
        They are the key. The relay holds the sealed payout under a hash of them and cannot open
        it. Anyone who learns these words can read the payout, so say them to the other signer and
        to nobody else. They stop working after 24 hours.
      </div>
      <button type="button" className={styles.btnSmall} onClick={() => copy(code)}>
        {copied ? "Copied" : "Copy the code"}
      </button>
    </div>
  );
};

export default TreasuryScreen;
