import TotalBalanceClass from "../appstate/classes/TotalBalanceClass";
import ValueTransferClass from "../appstate/classes/ValueTransferClass";
import UnifiedAddressClass from "../appstate/classes/UnifiedAddressClass";
import TransparentAddressClass from "../appstate/classes/TransparentAddressClass";
import { AddressScopeEnum } from "../appstate/enums/AddressScopeEnum";
import { ValueTransferKindEnum } from "../appstate/enums/ValueTransferKindEnum";
import { ValueTransferPoolEnum } from "../appstate/enums/ValueTransferPoolEnum";
import { ValueTransferStatusEnum } from "../appstate/enums/ValueTransferStatusEnum";
import {
  chainSees,
  deriveBalances,
  deriveOwnAddresses,
  filterActivity,
  formatSwm,
  incomingUnconfirmed,
  isBlockReward,
  isTransparentAddress,
  maskAmount,
  searchActivity,
  toActivityRow,
  toActivityRows,
  visibilityOf,
} from "./swarmModel";
import { SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE } from "../../utils/networkProfiles";
import { ACTIVE_SWARM_PROFILE } from "../../utils/swarmNetwork";

// SWARM Mainnet encodings. The first two are the FUEL payout address and a
// transparent address the owner could not pay on 2026-09-27; the P2SH is the
// Mining fund's published address (resources/treasury/Mining.policy.json).
// The TEX is only the shape — this function reads prefixes, not checksums.
// Nothing is ever sent to any of them from a test.
const SWARM_MAINNET_UA =
  "swm1q4q6yr3rvnnqw64tqktf7plq86cnmdxezv2g5wjerfpratclfv87guyfqru4vf775ykqd8q9e7uzscmns7w6q2fpxwl5up0ez5xqe5gv";
const SWARM_MAINNET_T = "s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk";
const SWARM_MAINNET_P2SH = "s3R1bWZPrRCtKL122ZN6uySu1ewk2ku849C";
const SWARM_MAINNET_TEX = "texswm1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

const UTEST = "utest1vjdkw7r3h2mq9m0y8xg0n6w4c2eqk5t8v7lz3h9n4p2r6s0t5v9x3z7b1d5f9h3k7m1q5w9";
const TM = "tmQ8xR4vK2mE7zD6yP3aH5wR9tCL2nFs0X";

function vt(
  partial: Partial<ValueTransferClass> & { is_coinbase?: boolean; isCoinbase?: boolean },
): ValueTransferClass {
  return {
    type: ValueTransferKindEnum.received,
    confirmations: 3,
    blockheight: 100,
    status: ValueTransferStatusEnum.confirmed,
    txid: "abc",
    time: 1700000000,
    amount: 1,
    ...partial,
  } as ValueTransferClass;
}

describe("formatSwm", () => {
  it("always shows at least two decimals", () => {
    expect(formatSwm(10)).toBe("10.00");
    expect(formatSwm(0)).toBe("0.00");
  });

  it("groups thousands", () => {
    expect(formatSwm(12480.35)).toBe("12,480.35");
  });

  it("keeps precision the number actually has, and no more", () => {
    expect(formatSwm(0.0001)).toBe("0.0001");
    expect(formatSwm(10.5)).toBe("10.50");
  });
});

describe("maskAmount", () => {
  it("blanks the digits and nothing else", () => {
    expect(maskAmount("12,480.35", true)).toBe("••,•••.••");
    expect(maskAmount("12,480.35", false)).toBe("12,480.35");
  });
});

describe("deriveBalances", () => {
  const balance = {
    totalIronwoodBalance: 10,
    totalSaplingBalance: 1,
    totalOrchardBalance: 0.5,
    totalTransparentBalance: 2,
    confirmedIronwoodBalance: 9,
    confirmedSaplingBalance: 1,
    confirmedOrchardBalance: 0.5,
    confirmedTransparentBalance: 2,
    totalSpendableBalance: 12.5,
  } as TotalBalanceClass;

  it("adds every shielded pool into one shielded figure", () => {
    expect(deriveBalances(balance).shielded).toBeCloseTo(11.5);
  });

  it("keeps the per-pool split for the breakdown", () => {
    const pools = deriveBalances(balance).shieldedPools;
    expect(pools.map((p) => p.label)).toEqual(["Ironwood", "Sapling", "Orchard"]);
    expect(pools[0].value).toBe(10);
  });

  it("counts everything, shielded and transparent, into the total", () => {
    expect(deriveBalances(balance).total).toBeCloseTo(13.5);
  });

  it("derives pending from what is not yet confirmed", () => {
    expect(deriveBalances(balance).pending).toBeCloseTo(1);
  });

  it("never reports a negative pending amount", () => {
    const racing = { ...balance, confirmedIronwoodBalance: 99 } as TotalBalanceClass;
    expect(deriveBalances(racing).pending).toBe(0);
  });

  it("treats a missing balance as zero rather than NaN", () => {
    const empty = deriveBalances(new TotalBalanceClass());
    expect(empty.total).toBe(0);
    expect(Number.isNaN(empty.pending)).toBe(false);
  });
});

describe("isTransparentAddress", () => {
  it("knows SWARM Testnet's transparent prefix, and upstream's on any build", () => {
    expect(isTransparentAddress(TM, SWARM_TESTNET_PROFILE)).toBe(true);
    expect(isTransparentAddress("t1abc")).toBe(true);
  });

  it("does not mistake a unified address for a transparent one", () => {
    expect(isTransparentAddress(UTEST)).toBe(false);
    expect(isTransparentAddress(undefined)).toBe(false);
  });

  // Until 0.1.0-mainnet.6 only `tm|t1|t3|tex` counted, so on SWARM Mainnet a
  // payment to `s1…` or `s3…` was drawn as private: no "the amount and this
  // address will be public" warning, a memo field for an address that cannot
  // carry one, and "shielded" on the Activity row afterwards.
  it("knows SWARM Mainnet's transparent shapes: s1, s3 and texswm", () => {
    expect(isTransparentAddress(SWARM_MAINNET_T, SWARM_MAINNET_PROFILE)).toBe(true);
    expect(isTransparentAddress(SWARM_MAINNET_P2SH, SWARM_MAINNET_PROFILE)).toBe(true);
    expect(isTransparentAddress(SWARM_MAINNET_TEX, SWARM_MAINNET_PROFILE)).toBe(true);
    expect(isTransparentAddress(SWARM_MAINNET_TEX.toUpperCase(), SWARM_MAINNET_PROFILE)).toBe(true);
  });

  it("does not call a SWARM Mainnet shielded address transparent", () => {
    expect(isTransparentAddress(SWARM_MAINNET_UA, SWARM_MAINNET_PROFILE)).toBe(false);
    expect(isTransparentAddress("zswmsapling1qqqqqqqqqqqqqqqqqqqq", SWARM_MAINNET_PROFILE)).toBe(false);
  });

  it("knows SWARM Testnet's shapes, P2SH included", () => {
    expect(isTransparentAddress(TM, SWARM_TESTNET_PROFILE)).toBe(true);
    expect(isTransparentAddress("t2UNzUUx8mWBCRYPRezvA363EYXyEpHokyi".slice(0, 12), SWARM_TESTNET_PROFILE)).toBe(true);
    expect(isTransparentAddress("textest1qqqqqqqqqqqqqqqqqqqq", SWARM_TESTNET_PROFILE)).toBe(true);
    expect(isTransparentAddress("swarm1qqqqqqqqqqqqqqqqqqqq", SWARM_TESTNET_PROFILE)).toBe(false);
  });

  it("reads Base58 prefixes exactly: `S1…` is not an `s1…` address", () => {
    expect(isTransparentAddress(SWARM_MAINNET_T.replace(/^s1/, "S1"), SWARM_MAINNET_PROFILE)).toBe(false);
  });

  it("answers for the network this build is for when asked without one", () => {
    expect(isTransparentAddress(ACTIVE_SWARM_PROFILE.transparentPrefixes[0] + "abc")).toBe(true);
  });

  it("calls a past send to an s1 address revealed when the pools are unknown", () => {
    const sent = vt({ type: ValueTransferKindEnum.sent, address: SWARM_MAINNET_T });
    expect(visibilityOf(sent, SWARM_MAINNET_PROFILE)).toBe("revealed");
    expect(toActivityRow(sent, 0, SWARM_MAINNET_PROFILE).state).toBe("REVEALED");
  });
});

describe("visibilityOf", () => {
  it("calls a transfer revealed when it touched the transparent pool", () => {
    expect(visibilityOf(vt({ poolsReceived: [ValueTransferPoolEnum.transparent] }))).toBe("revealed");
    expect(visibilityOf(vt({ poolsSentFrom: [ValueTransferPoolEnum.transparent] }))).toBe("revealed");
  });

  it("calls it shielded when every pool it touched was shielded", () => {
    expect(visibilityOf(vt({ poolsReceived: [ValueTransferPoolEnum.ironwood] }))).toBe("shielded");
    expect(visibilityOf(vt({ poolsReceived: [ValueTransferPoolEnum.sapling] }))).toBe("shielded");
  });

  it("falls back to the recipient address when no pools are reported", () => {
    expect(visibilityOf(vt({ address: TM }), SWARM_TESTNET_PROFILE)).toBe("revealed");
    expect(visibilityOf(vt({ address: UTEST }), SWARM_TESTNET_PROFILE)).toBe("shielded");
  });
});

describe("isBlockReward", () => {
  // The whole point of the flag. Every one of these looks exactly like a
  // coinbase receipt from the outside, and none of them is one.
  it("never infers a reward from a missing sender, an absent memo or a zero fee", () => {
    expect(isBlockReward(vt({ amount: 6.25, address: undefined, fee: 0, memos: undefined }))).toBe(false);
  });

  it("is false while the wallet does not report the flag at all", () => {
    expect(isBlockReward(vt({ type: ValueTransferKindEnum.received }))).toBe(false);
  });

  it("reads the flag zingolib puts in the value-transfer JSON", () => {
    expect(isBlockReward(vt({ type: ValueTransferKindEnum.received, is_coinbase: true }))).toBe(true);
  });

  it("reads the mapped name too, so it survives the renderer's own field", () => {
    expect(isBlockReward(vt({ type: ValueTransferKindEnum.received, isCoinbase: true }))).toBe(true);
  });

  it("treats an explicit false as an ordinary payment", () => {
    expect(isBlockReward(vt({ type: ValueTransferKindEnum.received, is_coinbase: false }))).toBe(false);
  });

  // A reward is money arriving. A flagged send would be the flag misread.
  it("only ever applies to a receipt", () => {
    expect(isBlockReward(vt({ type: ValueTransferKindEnum.sent, is_coinbase: true }))).toBe(false);
  });
});

describe("toActivityRow", () => {
  it("signs an incoming transfer positive and an outgoing one negative", () => {
    expect(toActivityRow(vt({ type: ValueTransferKindEnum.received, amount: 84.2 }), 0).amount).toBe("+84.20");
    expect(toActivityRow(vt({ type: ValueTransferKindEnum.sent, amount: 250 }), 0).amount).toBe("−250.00");
  });

  it("marks a send to a transparent address REVEALED", () => {
    const row = toActivityRow(
      vt({
        type: ValueTransferKindEnum.sent,
        address: TM,
        poolsReceived: [ValueTransferPoolEnum.transparent],
      }),
      0,
    );
    expect(row.visibility).toBe("revealed");
    expect(row.state).toBe("REVEALED");
  });

  it("marks an unconfirmed transfer PENDING rather than shielded", () => {
    expect(toActivityRow(vt({ confirmations: 0 }), 0).state).toBe("PENDING");
  });

  it("marks a failed transfer FAILED", () => {
    expect(toActivityRow(vt({ status: ValueTransferStatusEnum.failed }), 0).state).toBe("FAILED");
  });

  it("says who it cannot name instead of leaving the line blank", () => {
    const row = toActivityRow(vt({ type: ValueTransferKindEnum.received, address: undefined }), 0);
    expect(row.subtitle).toBe("from a shielded address");
  });

  it("names shielding as shielding", () => {
    expect(toActivityRow(vt({ type: ValueTransferKindEnum.shield }), 0).title).toBe("Shielded funds");
  });

  it("tags a flagged receipt MINED and names its block", () => {
    const row = toActivityRow(vt({ type: ValueTransferKindEnum.received, is_coinbase: true, blockheight: 12041 }), 0);
    expect(row.title).toBe("Block reward");
    expect(row.state).toBe("MINED");
    expect(row.mined).toBe(true);
    expect(row.subtitle).toBe("block #12041");
  });

  // Maturity is a confirmation count, not this flag. An unconfirmed reward is
  // still pending, and saying MINED over it would imply it could be spent.
  it("leaves an unconfirmed reward pending rather than mined", () => {
    expect(
      toActivityRow(vt({ type: ValueTransferKindEnum.received, is_coinbase: true, confirmations: 0 }), 0).state,
    ).toBe("PENDING");
  });
});

describe("filterActivity", () => {
  const rows = toActivityRows([
    vt({ type: ValueTransferKindEnum.received, poolsReceived: [ValueTransferPoolEnum.ironwood], memos: ["hello"] }),
    vt({ type: ValueTransferKindEnum.sent, poolsReceived: [ValueTransferPoolEnum.transparent], address: TM }),
    vt({ type: ValueTransferKindEnum.received, poolsReceived: [ValueTransferPoolEnum.sapling] }),
  ]);

  it("keeps everything by default", () => {
    expect(filterActivity(rows, "all")).toHaveLength(3);
  });

  it("separates shielded from revealed", () => {
    expect(filterActivity(rows, "shielded")).toHaveLength(2);
    expect(filterActivity(rows, "revealed")).toHaveLength(1);
  });

  // The old app had a separate Messages screen. A memo is a property of a
  // transfer, so here it is a filter over the one list.
  it("finds the transfers that carry a memo", () => {
    expect(filterActivity(rows, "memos")).toHaveLength(1);
  });

  it("lists mined rewards only when the wallet flagged them", () => {
    expect(filterActivity(rows, "mined")).toHaveLength(0);
    const withReward = toActivityRows([vt({ type: ValueTransferKindEnum.received, is_coinbase: true })]);
    expect(filterActivity(withReward, "mined")).toHaveLength(1);
  });
});

// A block reward whose block lost a fork. pepper-sync marks the transactions
// of a reorged-away block `Failed` when it truncates (`set_transactions_
// failed_unchecked`), and truncation is the only way a `Confirmed` coinbase
// can become one. On the owner's wallet on 2026-09-27 seven of ~765 rewards
// read "Block reward +5.00 FAILED"; the explorer shows another miner's block
// at each of those heights. Nothing was paid and nothing left the balance —
// failed outputs are in no balance the SDK computes — so the row says that
// instead of "FAILED", which reads as the wallet losing money.
describe("a block reward lost to a fork", () => {
  const lost = vt({
    type: ValueTransferKindEnum.received,
    isCoinbase: true,
    status: ValueTransferStatusEnum.failed,
    confirmations: 0,
    blockheight: 1316,
    amount: 5,
  });

  it("says it was lost to a fork, not that it failed", () => {
    const row = toActivityRow(lost, 0, SWARM_MAINNET_PROFILE);
    expect(row.state).toBe("LOST TO A FORK");
    expect(row.forkLost).toBe(true);
    expect(row.title).toBe("Block reward");
  });

  it("names the block and says nothing was paid and nothing left the balance", () => {
    expect(toActivityRow(lost, 0).subtitle).toBe(
      "block #1316 was replaced by another miner's block; nothing was paid and nothing left your balance",
    );
  });

  it("stays under the Mined filter: it is true information about mining", () => {
    expect(filterActivity(toActivityRows([lost]), "mined")).toHaveLength(1);
  });

  it("is not how a failed ordinary send or receipt is labelled", () => {
    const send = toActivityRow(
      vt({ type: ValueTransferKindEnum.sent, status: ValueTransferStatusEnum.failed, address: TM }),
      0,
    );
    expect(send.state).toBe("FAILED");
    expect(send.forkLost).toBe(false);
    const receipt = toActivityRow(vt({ status: ValueTransferStatusEnum.failed }), 0);
    expect(receipt.state).toBe("FAILED");
    expect(receipt.forkLost).toBe(false);
  });

  it("is never counted as on its way", () => {
    const pending = vt({ confirmations: 0, status: ValueTransferStatusEnum.mempool, txid: "p" });
    const failedReceipt = vt({ confirmations: 0, status: ValueTransferStatusEnum.failed, txid: "f" });
    // The mapper gives every failed transfer zero confirmations, so the old
    // Receive-screen rule ("received, 0 confirmations") listed each lost
    // reward as a payment on its way, for ever.
    expect(incomingUnconfirmed([lost, pending, failedReceipt]).map((t) => t.txid)).toEqual(["p"]);
  });

  it("cannot reach a balance the screens compute: those come from the SDK's totals alone", () => {
    // `deriveBalances` reads the addon's balance and nothing else, and the
    // SDK sums only `Confirmed` and pending outputs (zingo-status
    // `is_confirmed` / `is_pending`; `Failed` is neither), so a lost
    // reward has no way in.
    expect(deriveBalances.length).toBe(1);
    expect(deriveBalances(new TotalBalanceClass()).total).toBe(0);
  });
});

describe("searchActivity", () => {
  const rows = toActivityRows([
    vt({ type: ValueTransferKindEnum.received, memos: ["Invoice #2291"], txid: "f3a9c1e7" }),
    vt({ type: ValueTransferKindEnum.sent, address: TM, txid: "9b04d2aa" }),
  ]);

  it("matches a memo, a hash and an address", () => {
    expect(searchActivity(rows, "invoice")).toHaveLength(1);
    expect(searchActivity(rows, "9b04")).toHaveLength(1);
    expect(searchActivity(rows, TM.slice(0, 6))).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    expect(searchActivity(rows, "  ")).toHaveLength(2);
  });
});

describe("deriveOwnAddresses", () => {
  it("lists shielded addresses before transparent ones", () => {
    const rows = deriveOwnAddresses(
      [new UnifiedAddressClass(0, 0, UTEST, false, true, true)],
      [
        {
          account: 0,
          address_index: 0,
          scope: AddressScopeEnum.external,
          encoded_address: TM,
        } as TransparentAddressClass,
      ],
    );
    expect(rows.map((r) => r.kind)).toEqual(["shielded", "transparent"]);
    expect(rows[0].address).toBe(UTEST);
  });

  it("survives a wallet with no addresses yet", () => {
    expect(deriveOwnAddresses([], [])).toEqual([]);
  });
});

describe("chainSees", () => {
  it("says a shielded payment publishes its existence and its fee, and nothing else", () => {
    const facts = chainSees({ shielded: true, fee: "0.0001", ticker: "SWM" });
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(byKey["Sender"]).toBe("hidden");
    expect(byKey["Recipient"]).toBe("hidden");
    expect(byKey["Amount"]).toBe("hidden");
    expect(byKey["Fee"]).toBe("0.0001 SWM");
    expect(byKey["That a transaction happened"]).toBe("yes");
  });

  it("says a transparent payment publishes the address and the amount", () => {
    const facts = chainSees({ shielded: false, address: TM, amount: "250.00", ticker: "SWM" });
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(byKey["Amount"]).toBe("250.00 SWM");
    expect(byKey["Recipient address"]).toContain("tmQ8xR4vK2");
  });

  // Nothing here may claim to know what a chain analyst could infer.
  it("claims nothing beyond what the chain records", () => {
    const keys = chainSees({ shielded: true, ticker: "SWM" }).map((f) => f.key);
    expect(keys).toEqual(["That a transaction happened", "Sender", "Recipient", "Amount", "Memo", "Fee"]);
  });
});
