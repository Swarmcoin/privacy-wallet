import {
  canSignIncoming,
  distinctSigners,
  hasSigned,
  incomingReducer,
  initialIncoming,
  initialPayout,
  payoutReducer,
  readyToCombine,
  signaturesOutstanding,
  signersForFund,
  type CollectedSignature,
  type Fund,
  type PayoutEvent,
  type PayoutState,
  type ProposalSummary,
  type RegisteredSigner,
} from "./treasuryMachine";

const HASH = "c1".repeat(32);
const OTHER_HASH = "c2".repeat(32);

const fund: Fund = {
  name: "Core",
  policyJson: "{}",
  fingerprint: "c4eb50cf30afb64d56c31c8e3a0a1753",
  address: "s3fLmEHc1xqs8KAe7QS7oupkhuGDjidV4eq",
  threshold: 2,
  signerFingerprints: ["a5eb896d276f19ce", "f09232728bf931f2", "afc5719115ca6481"],
  fileSha256: "ff".repeat(32),
};

const summary = (hash = HASH): ProposalSummary => ({
  lines: ["fund              Core"],
  proposal_hash: hash,
  fund: "Core",
  network: "swarmmain",
  network_upgrade: "nu6_3",
  policy_address: fund.address,
  policy_fingerprint: fund.fingerprint,
  recipient: "swm1example",
  recipient_raw_receiver: "00".repeat(43),
  memo: "",
  total_in: 1_000_000_000,
  fee: 15_000,
  conventional_fee: 15_000,
  amount_out: 999_985_000,
  expiry_height: 3_000_400,
  inputs: [],
  created: "2026-09-27T00:00:00Z",
  threshold: 2,
  signer_fingerprints: fund.signerFingerprints,
});

const signature = (over: Partial<CollectedSignature> = {}): CollectedSignature => ({
  json: "{}",
  fingerprint: "a5eb896d276f19ce",
  label: "A",
  proposalHash: HASH,
  origin: "this machine",
  ...over,
});

const signer = (fingerprint: string, label: string): RegisteredSigner => ({
  fingerprint,
  label,
  publicKey: "02".padEnd(66, "0"),
  created: "2026-09-26T00:00:00Z",
  registered: "2026-09-27T00:00:00Z",
  sha256: "ab".repeat(32),
});

const run = (events: PayoutEvent[], from: PayoutState = initialPayout): PayoutState =>
  events.reduce(payoutReducer, from);

describe("the coordinator's payout", () => {
  it("starts with nothing to broadcast", () => {
    expect(readyToCombine(initialPayout)).toBe(false);
    expect(initialPayout.step).toBe("compose");
  });

  it("throws the previous payout away when a different fund is chosen", () => {
    const built = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
    ]);
    expect(built.signatures).toHaveLength(1);
    const switched = payoutReducer(built, {
      type: "fund-chosen",
      fund: { ...fund, name: "Grants" },
    });
    expect(switched.proposalJson).toBeNull();
    expect(switched.signatures).toEqual([]);
    expect(switched.step).toBe("compose");
  });

  it("will not combine below the policy's threshold", () => {
    const state = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
    ]);
    expect(distinctSigners(state)).toBe(1);
    expect(signaturesOutstanding(state)).toBe(1);
    expect(readyToCombine(state)).toBe(false);
    expect(state.step).not.toBe("ready");
  });

  it("is ready once the threshold is met by distinct signers", () => {
    const state = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
      {
        type: "signature-added",
        signature: signature({ fingerprint: "afc5719115ca6481", label: "C", origin: "the relay" }),
      },
    ]);
    expect(distinctSigners(state)).toBe(2);
    expect(readyToCombine(state)).toBe(true);
    expect(state.step).toBe("ready");
  });

  it("counts the same signer twice as once, however many times it is polled", () => {
    const state = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
      { type: "signature-added", signature: signature({ origin: "the relay" }) },
    ]);
    expect(state.signatures).toHaveLength(1);
    expect(readyToCombine(state)).toBe(false);
    // Polling the same blob again is not a defect to shout about.
    expect(state.problem).toBeNull();
  });

  it("refuses a signature over a different proposal, and says both hashes", () => {
    const state = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature({ proposalHash: OTHER_HASH }) },
    ]);
    expect(state.signatures).toHaveLength(0);
    expect(state.problem).toContain(OTHER_HASH.slice(0, 16));
    expect(state.problem).toContain(HASH.slice(0, 16));
    expect(state.problem).toContain("has not been added");
  });

  it("refuses a signature when there is no proposal to attach it to", () => {
    const state = payoutReducer(
      { ...initialPayout, fund },
      { type: "signature-added", signature: signature() },
    );
    expect(state.problem).toContain("no proposal");
  });

  it("remembers the session code only once the proposal has been shared", () => {
    const built = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
    ]);
    expect(built.shared).toBe(false);
    expect(built.sessionCode).toBeNull();
    const shared = payoutReducer(built, {
      type: "shared",
      sessionCode: "bala dote koba nemi rate vibo",
      sessionId: "ab".repeat(32),
    });
    expect(shared.shared).toBe(true);
    expect(shared.step).toBe("collect");
    expect(shared.sessionCode).toBe("bala dote koba nemi rate vibo");
  });

  it("goes from combined to broadcast to done, keeping the txid", () => {
    const ready = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
      { type: "signature-added", signature: signature({ fingerprint: "afc5719115ca6481" }) },
      { type: "combined", txid: "dd".repeat(32), finalHex: "0500" },
    ]);
    expect(ready.step).toBe("broadcasting");
    const done = payoutReducer(ready, { type: "broadcast", txid: "dd".repeat(32) });
    expect(done.step).toBe("done");
    expect(done.txid).toBe("dd".repeat(32));
  });

  it("building a new proposal clears the signatures that belonged to the old one", () => {
    const state = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
      { type: "proposal-built", proposalJson: "{}", summary: summary(OTHER_HASH) },
    ]);
    expect(state.signatures).toEqual([]);
    expect(state.shared).toBe(false);
  });

  it("clears the problem when it starts waiting for something", () => {
    const state = run([
      { type: "problem", message: "the relay was unreachable" },
      { type: "busy", what: "sharing" },
    ]);
    expect(state.problem).toBeNull();
    expect(state.busy).toBe("sharing");
  });
});

describe("which signers this machine can use", () => {
  it("offers only the signers the fund's own policy names", () => {
    const held = [signer("a5eb896d276f19ce", "A"), signer("0000000000000000", "stranger")];
    expect(signersForFund(fund, held).map((s) => s.label)).toEqual(["A"]);
    expect(signersForFund(null, held)).toEqual([]);
  });

  it("knows whether a signer has already signed this payout", () => {
    const state = run([
      { type: "fund-chosen", fund },
      { type: "proposal-built", proposalJson: "{}", summary: summary() },
      { type: "signature-added", signature: signature() },
    ]);
    expect(hasSigned(state, "a5eb896d276f19ce")).toBe(true);
    expect(hasSigned(state, "afc5719115ca6481")).toBe(false);
  });
});

describe("the second machine", () => {
  it("cannot sign before it has fetched anything", () => {
    expect(canSignIncoming(initialIncoming, [signer("a5eb896d276f19ce", "A")])).toBe(false);
  });

  it("cannot sign a fetched proposal it holds no named signer for", () => {
    const fetched = incomingReducer(initialIncoming, {
      type: "fetched",
      sessionId: "ab".repeat(32),
      fund,
      proposalJson: "{}",
      summary: summary(),
    });
    expect(canSignIncoming(fetched, [signer("0000000000000000", "stranger")])).toBe(false);
    expect(canSignIncoming(fetched, [signer("f09232728bf931f2", "B")])).toBe(true);
  });

  it("walks from code to review to signed to returned", () => {
    let state = incomingReducer(initialIncoming, {
      type: "code-typed",
      code: "bala dote koba nemi rate vibo",
    });
    expect(state.step).toBe("enter-code");
    state = incomingReducer(state, {
      type: "fetched",
      sessionId: "ab".repeat(32),
      fund,
      proposalJson: "{}",
      summary: summary(),
    });
    expect(state.step).toBe("review");
    state = incomingReducer(state, { type: "signed", signedBy: "B" });
    expect(state.step).toBe("signing");
    state = incomingReducer(state, { type: "returned" });
    expect(state.step).toBe("returned");
    expect(incomingReducer(state, { type: "reset" })).toEqual(initialIncoming);
  });

  it("keeps a refusal visible until something else happens", () => {
    const state = incomingReducer(initialIncoming, {
      type: "problem",
      message: "that session code does not open this blob",
    });
    expect(state.problem).toContain("does not open");
    expect(state.busy).toBeNull();
  });
});
