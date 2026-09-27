/**
 * The payout, as a state machine.
 *
 * A two-machine ceremony has more ways to go half-finished than a screen can
 * hold in `useState` without one of them becoming a lie — the classic being
 * a "Broadcast" button that is live while the second signature is still on
 * its way. So the whole flow is one value here, moved by named events, and
 * the screen only renders it. Every test in `treasuryMachine.test.ts` is a
 * sentence about the ceremony rather than about React.
 *
 * Two rules the machine exists to enforce:
 *
 * * **the proposal hash is the identity of a payout.** A signature whose
 *   hash is not this payout's is dropped with a refusal, not merged. The
 *   addon refuses it too, but by then two people have already believed
 *   something.
 * * **nothing is broadcast below the threshold.** `readyToCombine` is the
 *   only thing the Finalize button reads, and it counts distinct signer
 *   fingerprints, not blobs: the same signature fetched twice is one
 *   signature.
 */

import type { Selection, TreasuryUtxoSet } from "./selectUtxos";

/** A fund the build ships a policy for. */
export type Fund = {
  /** `Core`, `Grants`, `Reserve`, `Mining`. */
  name: string;
  /** The policy file, verbatim — what is signed under, not a summary of it. */
  policyJson: string;
  /** Recomputed by the addon, never read out of the file. */
  fingerprint: string;
  address: string;
  threshold: number;
  signerFingerprints: string[];
  /** SHA-256 of the shipped file, so "is this the build's policy" is answerable. */
  fileSha256: string;
};

/** A signer file this machine has been given. */
export type RegisteredSigner = {
  fingerprint: string;
  label: string;
  publicKey: string;
  created: string;
  registered: string;
  sha256: string;
};

/** One signature collected for a payout. */
export type CollectedSignature = {
  /** The signature file, verbatim. */
  json: string;
  fingerprint: string;
  label: string;
  proposalHash: string;
  /** Where it came from, for the screen. */
  origin: "this machine" | "the relay";
};

/** The summary the addon derives from a proposal — the card everyone reads. */
export type ProposalSummary = {
  lines: string[];
  proposal_hash: string;
  fund: string;
  network: string;
  network_upgrade: string;
  policy_address: string;
  policy_fingerprint: string;
  recipient: string;
  recipient_raw_receiver: string;
  memo: string;
  total_in: number;
  fee: number;
  conventional_fee: number;
  amount_out: number;
  expiry_height: number;
  inputs: {
    txid: string;
    vout: number;
    value: number;
    height: number;
    is_coinbase: boolean;
    sighash_all_digest: string;
  }[];
  created: string;
  threshold: number;
  signer_fingerprints: string[];
};

/** Which part of the ceremony the screen is in. */
export type PayoutStep =
  | "compose"
  | "review"
  | "share"
  | "collect"
  | "ready"
  | "broadcasting"
  | "done";

export type PayoutState = {
  step: PayoutStep;
  fund: Fund | null;
  utxos: TreasuryUtxoSet | null;
  selection: Selection | null;
  /** The proposal file, verbatim, once it has been built. */
  proposalJson: string | null;
  summary: ProposalSummary | null;
  signatures: CollectedSignature[];
  /** The six words, on the coordinating machine only. */
  sessionCode: string | null;
  sessionId: string | null;
  /** Set once the proposal has reached the relay. */
  shared: boolean;
  txid: string | null;
  finalHex: string | null;
  /** What went wrong, in words, or null. */
  problem: string | null;
  /** What the screen is waiting on, or null. */
  busy: string | null;
};

export const initialPayout: PayoutState = {
  step: "compose",
  fund: null,
  utxos: null,
  selection: null,
  proposalJson: null,
  summary: null,
  signatures: [],
  sessionCode: null,
  sessionId: null,
  shared: false,
  txid: null,
  finalHex: null,
  problem: null,
  busy: null,
};

export type PayoutEvent =
  | { type: "fund-chosen"; fund: Fund }
  | { type: "utxos-loaded"; utxos: TreasuryUtxoSet }
  | { type: "selection-made"; selection: Selection }
  | { type: "selection-cleared" }
  | { type: "busy"; what: string }
  | { type: "problem"; message: string }
  | { type: "proposal-built"; proposalJson: string; summary: ProposalSummary }
  | { type: "signature-added"; signature: CollectedSignature }
  | { type: "shared"; sessionCode: string; sessionId: string }
  | { type: "combined"; txid: string; finalHex: string }
  | { type: "broadcast"; txid: string }
  | { type: "reset" };

/** How many distinct signers have signed this payout. */
export function distinctSigners(state: PayoutState): number {
  return new Set(state.signatures.map((s) => s.fingerprint)).size;
}

/**
 * Whether there are enough distinct signatures to combine.
 *
 * The threshold comes from the policy the addon verified, not from anything
 * a blob claimed.
 */
export function readyToCombine(state: PayoutState): boolean {
  if (!state.fund || !state.proposalJson) return false;
  return distinctSigners(state) >= state.fund.threshold;
}

/** How many more signatures are needed, for the screen to say so. */
export function signaturesOutstanding(state: PayoutState): number {
  if (!state.fund) return 0;
  return Math.max(0, state.fund.threshold - distinctSigners(state));
}

/** Whether this machine holds a signer that this fund's policy names. */
export function signersForFund(fund: Fund | null, held: RegisteredSigner[]): RegisteredSigner[] {
  if (!fund) return [];
  const named = new Set(fund.signerFingerprints);
  return held.filter((signer) => named.has(signer.fingerprint));
}

/** Whether a given signer has already signed this payout. */
export function hasSigned(state: PayoutState, fingerprint: string): boolean {
  return state.signatures.some((s) => s.fingerprint === fingerprint);
}

export function payoutReducer(state: PayoutState, event: PayoutEvent): PayoutState {
  switch (event.type) {
    case "reset":
      return initialPayout;

    case "busy":
      return { ...state, busy: event.what, problem: null };

    case "problem":
      return { ...state, busy: null, problem: event.message };

    case "fund-chosen":
      // Choosing a fund starts a new payout. Keeping the old proposal around
      // under a new fund's heading is how someone signs the wrong thing.
      return { ...initialPayout, fund: event.fund };

    case "utxos-loaded":
      return { ...state, utxos: event.utxos, busy: null, problem: null };

    case "selection-made":
      return { ...state, selection: event.selection, problem: null };

    case "selection-cleared":
      return { ...state, selection: null };

    case "proposal-built":
      return {
        ...state,
        step: "review",
        proposalJson: event.proposalJson,
        summary: event.summary,
        signatures: [],
        shared: false,
        txid: null,
        finalHex: null,
        busy: null,
        problem: null,
      };

    case "signature-added": {
      if (!state.summary) {
        return { ...state, busy: null, problem: "There is no proposal for that signature." };
      }
      if (event.signature.proposalHash !== state.summary.proposal_hash) {
        // The one refusal this machine makes on its own, before the addon
        // gets a chance to: a signature over a different proposal is not a
        // signature over this one, whatever the relay handed back.
        return {
          ...state,
          busy: null,
          problem: `That signature is over a different proposal (${event.signature.proposalHash.slice(0, 16)}…), not this one (${state.summary.proposal_hash.slice(0, 16)}…). It has not been added.`,
        };
      }
      if (hasSigned(state, event.signature.fingerprint)) {
        // Not an error: polling a relay returns the same blob again. The
        // screen should not flicker a refusal at a machine doing its job.
        return { ...state, busy: null };
      }
      const signatures = [...state.signatures, event.signature];
      const next = { ...state, signatures, busy: null, problem: null };
      return { ...next, step: readyToCombine(next) ? "ready" : next.step };
    }

    case "shared":
      return {
        ...state,
        step: "collect",
        shared: true,
        sessionCode: event.sessionCode,
        sessionId: event.sessionId,
        busy: null,
        problem: null,
      };

    case "combined":
      return {
        ...state,
        step: "broadcasting",
        txid: event.txid,
        finalHex: event.finalHex,
        busy: null,
        problem: null,
      };

    case "broadcast":
      return { ...state, step: "done", txid: event.txid, busy: null, problem: null };

    default:
      return state;
  }
}

// -- the second machine ------------------------------------------------------

/** Which part of the ceremony the incoming-payout panel is in. */
export type IncomingStep = "enter-code" | "fetching" | "review" | "signing" | "returned";

export type IncomingState = {
  step: IncomingStep;
  code: string;
  sessionId: string | null;
  /** The policy that came with the proposal, after the addon verified it. */
  fund: Fund | null;
  proposalJson: string | null;
  summary: ProposalSummary | null;
  /** Which of this machine's signers signed, once one has. */
  signedBy: string | null;
  problem: string | null;
  busy: string | null;
};

export const initialIncoming: IncomingState = {
  step: "enter-code",
  code: "",
  sessionId: null,
  fund: null,
  proposalJson: null,
  summary: null,
  signedBy: null,
  problem: null,
  busy: null,
};

export type IncomingEvent =
  | { type: "code-typed"; code: string }
  | { type: "busy"; what: string }
  | { type: "problem"; message: string }
  | {
      type: "fetched";
      sessionId: string;
      fund: Fund;
      proposalJson: string;
      summary: ProposalSummary;
    }
  | { type: "signed"; signedBy: string }
  | { type: "returned" }
  | { type: "reset" };

export function incomingReducer(state: IncomingState, event: IncomingEvent): IncomingState {
  switch (event.type) {
    case "reset":
      return initialIncoming;
    case "code-typed":
      return { ...state, code: event.code, problem: null };
    case "busy":
      return { ...state, busy: event.what, problem: null };
    case "problem":
      return { ...state, busy: null, problem: event.message };
    case "fetched":
      return {
        ...state,
        step: "review",
        sessionId: event.sessionId,
        fund: event.fund,
        proposalJson: event.proposalJson,
        summary: event.summary,
        signedBy: null,
        busy: null,
        problem: null,
      };
    case "signed":
      return { ...state, step: "signing", signedBy: event.signedBy, busy: null, problem: null };
    case "returned":
      return { ...state, step: "returned", busy: null, problem: null };
    default:
      return state;
  }
}

/**
 * Whether the incoming panel may offer to sign.
 *
 * Only when a proposal has been fetched AND this machine holds a signer the
 * proposal's own policy names AND that signer has not already signed here.
 */
export function canSignIncoming(state: IncomingState, held: RegisteredSigner[]): boolean {
  if (state.step !== "review" || !state.fund || !state.summary) return false;
  return signersForFund(state.fund, held).length > 0;
}
