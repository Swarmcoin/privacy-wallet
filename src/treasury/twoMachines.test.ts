/**
 * The whole ceremony, end to end, with two machines and a relay between
 * them.
 *
 * What is real here: the relay's HTTP contract, the envelope format, the
 * `RelayClient`, the service layer, and both reducers. What is faked is the
 * addon — deliberately. The cryptography has its own suite, in Rust, against
 * the published fixture scalars (`native/src/treasury.rs`); what is not
 * tested anywhere else is whether the two machines actually meet: whether
 * the id one derives is the path the other reads, whether the envelope one
 * seals is the envelope the other parses, and whether the coordinator ends
 * up with two distinct signatures over the one proposal it built.
 *
 * The fake addon is faithful about the things this test is about — a wrong
 * session code fails to open a blob, a signature carries the proposal hash
 * it was made over, and a combine below the threshold refuses — and about
 * nothing else.
 */

import { RelayClient, base64ToHex, hexToBase64, parseEnvelope, type RelayEnvelope, type RelayTransport } from "./relayClient";
import { newSessionCode, normaliseSessionCode } from "./sessionCode";
import {
  initialIncoming,
  initialPayout,
  incomingReducer,
  payoutReducer,
  readyToCombine,
  type Fund,
  type PayoutState,
  type ProposalSummary,
} from "./treasuryMachine";

import * as treasury from "./treasuryService";
import { native as mockNative, ipcRenderer as mockIpc } from "../electronBridge";

// The manual mock in src/__mocks__/electronBridge.ts: every addon function is
// a `jest.fn`, and this file gives them the behaviour the ceremony needs.
jest.mock("../electronBridge");

const bridge = {
  native: mockNative as unknown as Record<string, jest.Mock>,
  ipcRenderer: mockIpc as unknown as { invoke: jest.Mock },
};

// -- the relay, in memory, answering exactly what the service does ----------

type Stored = { blobs: string[] };

function inMemoryRelay() {
  const sessions = new Map<string, Stored>();
  const seen: { method: string; session: string; bytes: number }[] = [];
  const transport: RelayTransport = async ({ method, session, bodyHex }) => {
    if (!/^[0-9a-f]{64}$/.test(session)) {
      return { ok: false, status: 400, text: '{"error":"not a session id"}' };
    }
    if (method === "PUT") {
      const hex = bodyHex ?? "";
      seen.push({ method, session, bytes: hex.length / 2 });
      const stored = sessions.get(session) ?? { blobs: [] };
      if (stored.blobs.length >= 8) {
        return { ok: false, status: 409, text: '{"error":"session full"}' };
      }
      stored.blobs.push(hex);
      sessions.set(session, stored);
      return {
        ok: true,
        status: 201,
        text: JSON.stringify({ slot: stored.blobs.length - 1, count: stored.blobs.length }),
      };
    }
    seen.push({ method, session, bytes: 0 });
    const stored = sessions.get(session);
    if (!stored) return { ok: false, status: 404, text: "" };
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({
        session,
        count: stored.blobs.length,
        expires_at: "2026-09-28T00:00:00Z",
        blobs: stored.blobs.map((hex, slot) => ({
          slot,
          created: "2026-09-27T00:00:00Z",
          size: hex.length / 2,
          body: hexToBase64(hex),
        })),
      }),
    };
  };
  return { transport, sessions, seen };
}

// -- the fake addon ----------------------------------------------------------

const POLICY = JSON.stringify({
  schema: "swarm-treasury.policy",
  fund: "Core",
  network: "swarmmain",
  threshold: 2,
  signers: [
    { label: "A", public_key: "02".padEnd(66, "a"), fingerprint: "a5eb896d276f19ce" },
    { label: "B", public_key: "02".padEnd(66, "b"), fingerprint: "f09232728bf931f2" },
    { label: "C", public_key: "02".padEnd(66, "c"), fingerprint: "afc5719115ca6481" },
  ],
  address: "s3fLmEHc1xqs8KAe7QS7oupkhuGDjidV4eq",
  policy_fingerprint: "c4eb50cf30afb64d56c31c8e3a0a1753",
});

const PROPOSAL_HASH = "9a".repeat(32);

const PROPOSAL = JSON.stringify({
  schema: "swarm-treasury.proposal",
  fund: "Core",
  proposal_hash: PROPOSAL_HASH,
  amount_out: 999_985_000,
});

const SUMMARY: ProposalSummary = {
  lines: ["fund              Core"],
  proposal_hash: PROPOSAL_HASH,
  fund: "Core",
  network: "swarmmain",
  network_upgrade: "nu6_3",
  policy_address: "s3fLmEHc1xqs8KAe7QS7oupkhuGDjidV4eq",
  policy_fingerprint: "c4eb50cf30afb64d56c31c8e3a0a1753",
  recipient: "swm1recipient",
  recipient_raw_receiver: "00".repeat(43),
  memo: "Q4 grant",
  total_in: 1_000_000_000,
  fee: 15_000,
  conventional_fee: 15_000,
  amount_out: 999_985_000,
  expiry_height: 3_000_400,
  inputs: [],
  created: "2026-09-27T00:00:00Z",
  threshold: 2,
  signer_fingerprints: ["a5eb896d276f19ce", "f09232728bf931f2", "afc5719115ca6481"],
};

const utf8ToHex = (text: string): string =>
  Array.from(new TextEncoder().encode(text))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hexToUtf8 = (hex: string): string =>
  new TextDecoder().decode(
    Uint8Array.from((hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16))),
  );

/** A "seal" that is reversible only with the same code. Not cryptography. */
const fakeSeal = (code: string, plaintext: string) =>
  utf8ToHex(JSON.stringify({ under: normaliseSessionCode(code), plaintext }));

const fakeUnseal = (code: string, hex: string) => {
  const parsed = JSON.parse(hexToUtf8(hex)) as { under: string; plaintext: string };
  if (parsed.under !== normaliseSessionCode(code)) {
    throw new Error("that session code does not open this blob");
  }
  return parsed.plaintext;
};

/** The id is a function of the normalised code and nothing else. */
const fakeSessionId = (code: string) =>
  utf8ToHex(normaliseSessionCode(code))
    .padEnd(64, "0")
    .slice(0, 64);

function installFakeAddon(signerLabels: Record<string, string>) {
  const { native, ipcRenderer } = bridge;
  native.treasury_policy_verify.mockImplementation(async (json: string) => {
    const parsed = JSON.parse(json);
    return JSON.stringify({
      fund: parsed.fund,
      network: parsed.network,
      threshold: parsed.threshold,
      signers: parsed.signers,
      redeem_script: "52ae",
      lock_script: "a914bf6506a42d05b142a49bb76de3476c0327ee775187",
      script_hash: "bf6506a42d05b142a49bb76de3476c0327ee7751",
      address: parsed.address,
      policy_fingerprint: parsed.policy_fingerprint,
      created: "2026-09-26T12:12:42Z",
    });
  });
  native.treasury_proposal_build.mockResolvedValue(PROPOSAL);
  native.treasury_proposal_summary.mockResolvedValue(JSON.stringify(SUMMARY));
  native.treasury_proposal_sign.mockImplementation(
    async (_proposal: string, _policy: string, ageHex: string) =>
      JSON.stringify({
        schema: "swarm-treasury.signature",
        label: signerLabels[ageHex],
        fingerprint: ageHex,
        proposal_hash: PROPOSAL_HASH,
      }),
  );
  native.treasury_signatures_combine.mockImplementation(
    async (_proposal: string, _policy: string, sigs: string) => {
      const parsed = JSON.parse(sigs) as { fingerprint: string }[];
      const distinct = new Set(parsed.map((s) => s.fingerprint));
      if (distinct.size < 2) throw new Error("a 2-of-3 policy needs two signatures");
      return JSON.stringify({
        raw_hex: "0500beef",
        txid: "dd".repeat(32),
        record: { signers: [...distinct], fee: 15_000, amount_out: 999_985_000, transaction_bytes: 4 },
      });
    },
  );
  native.treasury_seal.mockImplementation(async (code: string, text: string) =>
    fakeSeal(code, text),
  );
  native.treasury_unseal.mockImplementation(async (code: string, hex: string) =>
    fakeUnseal(code, hex),
  );
  native.treasury_session_id.mockImplementation(async (code: string) => fakeSessionId(code));

  ipcRenderer.invoke.mockImplementation(async (channel: string, arg: unknown) => {
    switch (channel) {
      case "treasury:policies":
        return [{ file: "Core.policy.json", json: POLICY, fileSha256: "ff".repeat(32) }];
      // The signer store: a fingerprint in, the still-encrypted bytes out.
      // The fake addon treats those bytes as the fingerprint itself.
      case "treasury:signers:read":
        return String(arg);
      case "treasury:signers:list":
        return [];
      default:
        throw new Error(`the test was not asked about ${channel}`);
    }
  });
}

// -- the two machines --------------------------------------------------------

describe("two machines and a relay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installFakeAddon({
      a5eb896d276f19ce: "A",
      f09232728bf931f2: "B",
      afc5719115ca6481: "C",
    });
  });

  it("carries a payout from one machine to the other and back, and combines it", async () => {
    const relay = inMemoryRelay();
    const client = new RelayClient("https://lwd-main.swarm.green", relay.transport);

    // -- the coordinating machine -------------------------------------------
    const { funds } = await treasury.loadFunds();
    expect(funds).toHaveLength(1);
    const fund = funds[0];
    expect(fund.name).toBe("Core");
    expect(fund.threshold).toBe(2);

    let payout: PayoutState = payoutReducer(initialPayout, {
      type: "fund-chosen",
      fund: fund as Fund,
    });
    const built = await treasury.buildProposal({
      fund,
      utxos: [
        {
          txid: "33".repeat(32),
          vout: 0,
          value: 1_000_000_000,
          height: 3_000_000,
          is_coinbase: true,
          script: fund.lockScript,
          confirmations: 400,
          mature: true,
        },
      ],
      recipient: "swm1recipient",
      memo: "Q4 grant",
      expiryHeight: 3_000_400,
    });
    payout = payoutReducer(payout, {
      type: "proposal-built",
      proposalJson: built.proposalJson,
      summary: built.summary,
    });

    // A signs here.
    const signedHere = await treasury.signProposal({
      proposalJson: built.proposalJson,
      policyJson: fund.policyJson,
      fingerprint: "a5eb896d276f19ce",
      passphrase: "the first machine's passphrase",
    });
    payout = payoutReducer(payout, {
      type: "signature-added",
      signature: {
        json: signedHere.signatureJson,
        fingerprint: signedHere.fingerprint,
        label: signedHere.label,
        proposalHash: signedHere.proposalHash,
        origin: "this machine",
      },
    });
    expect(readyToCombine(payout)).toBe(false);

    // Shared under six words.
    const code = newSessionCode();
    const sessionId = await treasury.sessionIdFor(code);
    const proposalEnvelope: RelayEnvelope = {
      v: 1,
      kind: "proposal",
      policy: fund.policyJson,
      proposal: built.proposalJson,
      proposalHash: built.summary.proposal_hash,
      from: "coordinator",
    };
    await client.put(sessionId, await treasury.seal(code, JSON.stringify(proposalEnvelope)));
    payout = payoutReducer(payout, { type: "shared", sessionCode: code, sessionId });
    expect(payout.step).toBe("collect");

    // The relay was handed a path and some bytes, and nothing else.
    expect(relay.seen[0].session).toBe(sessionId);
    expect(relay.sessions.get(sessionId)?.blobs[0]).not.toContain(utf8ToHex("swm1recipient"));

    // -- the second machine, which knows only the six words ------------------
    let incoming = incomingReducer(initialIncoming, { type: "code-typed", code });
    const theirSessionId = await treasury.sessionIdFor(incoming.code);
    expect(theirSessionId).toBe(sessionId);

    const fetched = await client.get(theirSessionId);
    expect(fetched?.count).toBe(1);
    const opened = parseEnvelope(
      await treasury.unseal(incoming.code, base64ToHex(fetched!.blobs[0].body)),
    );
    expect(opened.kind).toBe("proposal");
    if (opened.kind !== "proposal") return;

    const theirSummary = await treasury.summarise(opened.proposal, opened.policy);
    incoming = incomingReducer(incoming, {
      type: "fetched",
      sessionId: theirSessionId,
      fund: fund as Fund,
      proposalJson: opened.proposal,
      summary: theirSummary,
    });
    expect(incoming.summary?.proposal_hash).toBe(built.summary.proposal_hash);

    const signedThere = await treasury.signProposal({
      proposalJson: opened.proposal,
      policyJson: opened.policy,
      fingerprint: "f09232728bf931f2",
      passphrase: "the second machine's passphrase",
    });
    const signatureEnvelope: RelayEnvelope = {
      v: 1,
      kind: "signature",
      signature: signedThere.signatureJson,
      proposalHash: signedThere.proposalHash,
      fingerprint: signedThere.fingerprint,
      from: signedThere.label,
    };
    await client.put(
      theirSessionId,
      await treasury.seal(incoming.code, JSON.stringify(signatureEnvelope)),
    );
    incoming = incomingReducer(incoming, { type: "returned" });

    // -- back on the coordinating machine ------------------------------------
    const polled = await client.get(sessionId);
    expect(polled?.count).toBe(2);
    for (const blob of polled!.blobs) {
      const envelope = parseEnvelope(await treasury.unseal(code, base64ToHex(blob.body)));
      if (envelope.kind !== "signature") continue;
      const parsed = JSON.parse(envelope.signature) as { fingerprint: string; label: string };
      payout = payoutReducer(payout, {
        type: "signature-added",
        signature: {
          json: envelope.signature,
          fingerprint: parsed.fingerprint,
          label: parsed.label,
          proposalHash: envelope.proposalHash,
          origin: "the relay",
        },
      });
    }
    expect(readyToCombine(payout)).toBe(true);
    expect(payout.step).toBe("ready");
    expect(payout.signatures.map((s) => s.label).sort()).toEqual(["A", "B"]);

    const combined = await treasury.combine(
      built.proposalJson,
      fund.policyJson,
      payout.signatures.map((s) => s.json),
    );
    payout = payoutReducer(payout, {
      type: "combined",
      txid: combined.txid,
      finalHex: combined.raw_hex,
    });
    expect(payout.txid).toBe("dd".repeat(32));
    expect(payout.step).toBe("broadcasting");
  });

  it("a machine that types the code wrong reads nothing, and says so", async () => {
    const relay = inMemoryRelay();
    const client = new RelayClient("https://lwd-main.swarm.green", relay.transport);
    const code = newSessionCode();
    const wrong = newSessionCode();
    const sessionId = await treasury.sessionIdFor(code);

    await client.put(
      sessionId,
      await treasury.seal(
        code,
        JSON.stringify({
          v: 1,
          kind: "proposal",
          policy: POLICY,
          proposal: PROPOSAL,
          proposalHash: PROPOSAL_HASH,
          from: "coordinator",
        }),
      ),
    );

    // A different code derives a different path: the wrong machine does not
    // even find the session, let alone open it.
    const wrongId = await treasury.sessionIdFor(wrong);
    expect(wrongId).not.toBe(sessionId);
    await expect(client.get(wrongId)).resolves.toBeNull();

    // And if it somehow reached the right path, the blob still does not open.
    const found = await client.get(sessionId);
    await expect(
      treasury.unseal(wrong, base64ToHex(found!.blobs[0].body)),
    ).rejects.toThrow("does not open this blob");
  });

  it("a signature over another proposal is refused rather than counted", async () => {
    const relay = inMemoryRelay();
    const client = new RelayClient("https://lwd-main.swarm.green", relay.transport);
    const code = newSessionCode();
    const sessionId = await treasury.sessionIdFor(code);
    const { funds } = await treasury.loadFunds();

    let payout = payoutReducer(initialPayout, { type: "fund-chosen", fund: funds[0] as Fund });
    payout = payoutReducer(payout, {
      type: "proposal-built",
      proposalJson: PROPOSAL,
      summary: SUMMARY,
    });

    // Someone who knows the code puts a signature over a different payout on
    // the relay. It opens; it is still not a signature over this one.
    await client.put(
      sessionId,
      await treasury.seal(
        code,
        JSON.stringify({
          v: 1,
          kind: "signature",
          signature: JSON.stringify({ fingerprint: "f09232728bf931f2", label: "B" }),
          proposalHash: "ee".repeat(32),
          fingerprint: "f09232728bf931f2",
          from: "B",
        }),
      ),
    );
    const polled = await client.get(sessionId);
    const envelope = parseEnvelope(await treasury.unseal(code, base64ToHex(polled!.blobs[0].body)));
    if (envelope.kind !== "signature") throw new Error("the fixture is a signature");
    payout = payoutReducer(payout, {
      type: "signature-added",
      signature: {
        json: envelope.signature,
        fingerprint: envelope.fingerprint,
        label: "B",
        proposalHash: envelope.proposalHash,
        origin: "the relay",
      },
    });
    expect(payout.signatures).toHaveLength(0);
    expect(payout.problem).toContain("different proposal");
    expect(readyToCombine(payout)).toBe(false);
  });

  it("junk on the relay is skipped, not shown", async () => {
    const relay = inMemoryRelay();
    const client = new RelayClient("https://lwd-main.swarm.green", relay.transport);
    const code = newSessionCode();
    const sessionId = await treasury.sessionIdFor(code);

    // Anybody who guesses a path can write to it. Nothing they write opens.
    await client.put(sessionId, utf8ToHex("not even an age file"));
    const polled = await client.get(sessionId);
    await expect(
      treasury.unseal(code, base64ToHex(polled!.blobs[0].body)),
    ).rejects.toThrow();
  });
});
