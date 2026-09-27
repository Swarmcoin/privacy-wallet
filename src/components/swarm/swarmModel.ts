import TotalBalanceClass from "../appstate/classes/TotalBalanceClass";
import ValueTransferClass from "../appstate/classes/ValueTransferClass";
import UnifiedAddressClass from "../appstate/classes/UnifiedAddressClass";
import TransparentAddressClass from "../appstate/classes/TransparentAddressClass";
import { ValueTransferKindEnum } from "../appstate/enums/ValueTransferKindEnum";
import { ValueTransferPoolEnum } from "../appstate/enums/ValueTransferPoolEnum";
import { ValueTransferStatusEnum } from "../appstate/enums/ValueTransferStatusEnum";
import { SwarmNetworkProfile } from "../../utils/networkProfiles";
import { ACTIVE_SWARM_PROFILE } from "../../utils/swarmNetwork";

/**
 * The numbers and rows the SWARM screens draw, derived from wallet state.
 *
 * Pure on purpose. Every claim a screen makes about the user's money is
 * decided here, once, where a test can hold it to account — rather than in
 * six components each deciding for themselves what "shielded" adds up to.
 *
 * The rule these functions are written to: nothing on screen may be a value
 * this file invented. Where the wallet does not know something, the answer is
 * "unknown", never a plausible-looking number.
 */

/** Digits blanked out, for "Hide balances". Only the digits: "12.5 SWM" stays readable as an amount. */
export function maskAmount(text: string, hidden: boolean): string {
  return hidden ? text.replace(/[0-9]/g, "•") : text;
}

/**
 * An amount in SWM: grouped, and trimmed to the precision it actually has.
 *
 * Up to 8 decimals because that is the coin's resolution, and trailing zeros
 * dropped past the second so "10.0000" does not imply a precision the number
 * does not carry. Always at least two decimals, so a balance never reads as a
 * whole-number count of coins it is not.
 */
export function formatSwm(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  const fixed = value.toFixed(8);
  const trimmed = fixed.replace(/(\.\d{2}\d*?)0+$/, "$1");
  const [whole, fraction] = trimmed.split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** The shielded pools, in the order the breakdown lists them. */
export const SHIELDED_POOLS = [
  { key: "ironwood", label: "Ironwood" },
  { key: "sapling", label: "Sapling" },
  { key: "orchard", label: "Orchard" },
] as const;

export type PoolAmount = { key: string; label: string; value: number };

export type SwarmBalances = {
  /** Everything the wallet holds, every pool, confirmed and pending. */
  total: number;
  /** All shielded pools added together. */
  shielded: number;
  /** Per-pool split behind the shielded figure, for the details popover. */
  shieldedPools: PoolAmount[];
  transparent: number;
  /** Held but not yet confirmed — the difference between total and confirmed. */
  pending: number;
  /** Confirmed and spendable right now. */
  spendable: number;
};

export function deriveBalances(b: TotalBalanceClass): SwarmBalances {
  const zero = (n: number | undefined) => (Number.isFinite(n) ? (n as number) : 0);

  const ironwood = zero(b?.totalIronwoodBalance);
  const sapling = zero(b?.totalSaplingBalance);
  const orchard = zero(b?.totalOrchardBalance);
  const transparent = zero(b?.totalTransparentBalance);

  const shielded = ironwood + sapling + orchard;
  const total = shielded + transparent;

  const confirmed =
    zero(b?.confirmedIronwoodBalance) +
    zero(b?.confirmedSaplingBalance) +
    zero(b?.confirmedOrchardBalance) +
    zero(b?.confirmedTransparentBalance);

  // Never negative: a confirmed figure can momentarily lead the total while
  // the two are fetched by separate calls, and "-0.0001 pending" is nonsense.
  const pending = Math.max(0, total - confirmed);

  return {
    total,
    shielded,
    shieldedPools: [
      { key: "ironwood", label: "Ironwood", value: ironwood },
      { key: "sapling", label: "Sapling", value: sapling },
      { key: "orchard", label: "Orchard", value: orchard },
    ],
    transparent,
    pending,
    spendable: zero(b?.totalSpendableBalance),
  };
}

/** How much of a transfer the chain reveals. Drives the row's colour and tag. */
export type SwarmVisibility = "shielded" | "revealed";

export type SwarmActivityRow = {
  key: string;
  /** What happened, in the user's words: "Received", "Sent", "Shielded funds". */
  title: string;
  /** Second line: counterparty or reason, already abbreviated. */
  subtitle: string;
  txid: string;
  blockheight: number;
  confirmations: number;
  status: ValueTransferStatusEnum;
  /** Signed, for display: "+84.20" / "−250.00". */
  amount: string;
  /** Sign only, so a list can colour incoming and outgoing differently. */
  direction: "in" | "out" | "self";
  visibility: SwarmVisibility;
  /** The badge text: SHIELDED / REVEALED / MINED / PENDING / FAILED. */
  state: string;
  /** Whether the wallet flagged this receipt as a mined block reward. */
  mined: boolean;
  time: number;
  memos: string[];
  address?: string;
  fee?: number;
};

const SHIELDED_POOL_SET: ReadonlySet<string> = new Set([
  ValueTransferPoolEnum.ironwood,
  ValueTransferPoolEnum.sapling,
  ValueTransferPoolEnum.orchard,
]);

/**
 * Upstream Zcash's transparent shapes. No SWARM wallet can pay one — the
 * address pre-check refuses them by name — but a transparent address is
 * transparent whichever network it belongs to, and an address this cannot
 * place must never be drawn as private.
 */
const UPSTREAM_TRANSPARENT_PREFIXES = ["t1", "t3"] as const;
const UPSTREAM_TEX_HRP = "tex";

/**
 * A transparent address on `profile`'s network — its Base58 prefixes and its
 * TEX HRP, from the profile rather than written out here: `s1…`, `s3…` and
 * `texswm1…` on SWARM Mainnet, `tm…`, `t2…` and `textest1…` on SWARM Testnet.
 * Used to decide whether a *send* is public, which is a fact about the
 * address it goes to and nothing else.
 *
 * Until 0.1.0-mainnet.6 this was `/^(tm|t1|t3|tex)/i`, so on SWARM Mainnet a
 * payment to `s1…` was drawn as private: no warning that the address and the
 * amount become public, and "shielded" on the row afterwards.
 *
 * Base58 prefixes are compared exactly, because Base58 is case-sensitive and
 * `S1…` is not an `s1…` address; a TEX HRP is compared without case, because
 * bech32m may be written in capitals.
 */
export function isTransparentAddress(
  address: string | undefined,
  profile: SwarmNetworkProfile = ACTIVE_SWARM_PROFILE,
): boolean {
  if (!address) return false;
  const value = address.trim();
  const lower = value.toLowerCase();
  const prefixes = [...profile.transparentPrefixes, ...UPSTREAM_TRANSPARENT_PREFIXES];
  const texHrps = [profile.texHrp, UPSTREAM_TEX_HRP];
  return prefixes.some((prefix) => value.startsWith(prefix)) || texHrps.some((hrp) => lower.startsWith(`${hrp}1`));
}

/**
 * Whether the chain learned anything about this transfer beyond its existence.
 *
 * Decided from the pools the value actually moved through, which the wallet
 * reports, rather than from the kind of transfer it was. A send whose pools
 * are unknown is judged by its recipient address — the one other piece of
 * evidence there is.
 */
export function visibilityOf(vt: ValueTransferClass, profile: SwarmNetworkProfile = ACTIVE_SWARM_PROFILE): SwarmVisibility {
  const pools = [...(vt.poolsReceived ?? []), ...(vt.poolsSentFrom ?? [])];
  const touchedTransparent = pools.includes(ValueTransferPoolEnum.transparent);
  const touchedShielded = pools.some((p) => SHIELDED_POOL_SET.has(p));

  if (touchedTransparent) return "revealed";
  if (touchedShielded) return "shielded";

  // No pool information. The recipient address is the only other evidence.
  return isTransparentAddress(vt.address, profile) ? "revealed" : "shielded";
}

/**
 * A value transfer that may carry the coinbase flag.
 *
 * `is_coinbase` is what zingolib puts in the value-transfer JSON; `isCoinbase`
 * is what the renderer's mapper will call it once it carries the field
 * through. Both are read, and both are optional, because the flag is not in
 * the SDK this build is pinned at.
 */
type MaybeCoinbase = { isCoinbase?: boolean; is_coinbase?: boolean };

/**
 * Whether this receipt is a mined block reward.
 *
 * Only ever the wallet's own flag, never an inference. A coinbase receipt
 * looks exactly like a plain payment from someone who wrote no memo — no
 * sender, no memo, a zero fee — so reading those as "mined" would be the
 * wallet telling the user where their money came from on the strength of a
 * guess. zingolib knows, because it already reads `transparent_bundle()
 * .is_coinbase()` to enforce coinbase maturity, and it now says so in the
 * JSON.
 *
 * False for every transfer in the build this is written against: the flag
 * lands with the SDK re-pin, and until then the field is simply absent. That
 * is why it is read defensively rather than assumed — an absent field is
 * "not a reward", not "unknown".
 *
 * MINED is not the same as spendable. A coinbase output is transparent and
 * subject to the 100-block maturity rule, so a fresh reward is flagged here
 * while still unspendable; that state comes from the confirmation count, not
 * from this flag.
 */
export function isBlockReward(vt: ValueTransferClass): boolean {
  if (vt.type !== ValueTransferKindEnum.received) return false;
  const flagged = vt as ValueTransferClass & MaybeCoinbase;
  return flagged.isCoinbase === true || flagged.is_coinbase === true;
}

function abbreviate(address: string | undefined, chars = 8): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

function titleFor(vt: ValueTransferClass): { title: string; direction: "in" | "out" | "self" } {
  switch (vt.type) {
    case ValueTransferKindEnum.received:
      return { title: isBlockReward(vt) ? "Block reward" : "Received", direction: "in" };
    case ValueTransferKindEnum.sent:
      return { title: "Sent", direction: "out" };
    case ValueTransferKindEnum.shield:
      return { title: "Shielded funds", direction: "self" };
    case ValueTransferKindEnum.sendToSelf:
      return { title: "Sent to yourself", direction: "self" };
    case ValueTransferKindEnum.memoToSelf:
      return { title: "Note to yourself", direction: "self" };
    case ValueTransferKindEnum.migration:
      return { title: "Moved between pools", direction: "self" };
    case ValueTransferKindEnum.rejection:
      return { title: "Returned", direction: "in" };
    case ValueTransferKindEnum.swap:
      return { title: "Swap", direction: "out" };
    default:
      return { title: "Transfer", direction: "self" };
  }
}

function stateFor(vt: ValueTransferClass, visibility: SwarmVisibility): string {
  if (vt.status === ValueTransferStatusEnum.failed) return "FAILED";
  if (vt.confirmations === 0) return "PENDING";
  if (isBlockReward(vt)) return "MINED";
  return visibility === "revealed" ? "REVEALED" : "SHIELDED";
}

export function toActivityRow(
  vt: ValueTransferClass,
  index: number,
  profile: SwarmNetworkProfile = ACTIVE_SWARM_PROFILE,
): SwarmActivityRow {
  const visibility = visibilityOf(vt, profile);
  const mined = isBlockReward(vt);
  const { title, direction } = titleFor(vt);
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const memos = (vt.memos ?? []).filter((m) => !!m && m.trim().length > 0);

  let subtitle: string;
  if (mined) {
    subtitle = `block #${vt.blockheight}`;
  } else if (vt.address) {
    subtitle = `${direction === "in" ? "from" : "to"} ${abbreviate(vt.address)}`;
  } else if (visibility === "shielded") {
    // Nothing to name: the counterparty of a shielded receipt is not something
    // the wallet knows. Saying so beats printing an empty line.
    subtitle = direction === "in" ? "from a shielded address" : "to a shielded address";
  } else {
    subtitle = "";
  }

  return {
    key: `${vt.txid}-${index}`,
    title,
    subtitle,
    txid: vt.txid,
    blockheight: vt.blockheight,
    confirmations: vt.confirmations,
    status: vt.status,
    amount: `${sign}${formatSwm(Math.abs(vt.amount ?? 0))}`,
    direction,
    visibility,
    mined,
    state: stateFor(vt, visibility),
    time: vt.time,
    memos,
    address: vt.address,
    fee: vt.fee,
  };
}

/**
 * Every transfer as a row, judged against `profile`'s address shapes — the
 * network of the wallet the transfers belong to, when the caller knows it.
 */
export function toActivityRows(
  vts: ValueTransferClass[],
  profile: SwarmNetworkProfile = ACTIVE_SWARM_PROFILE,
): SwarmActivityRow[] {
  return (vts ?? []).map((vt, index) => toActivityRow(vt, index, profile));
}

/** The filters the Activity screen offers, and what each one keeps. */
export type ActivityFilterKey = "all" | "shielded" | "revealed" | "memos" | "mined";

export function filterActivity(rows: SwarmActivityRow[], filter: ActivityFilterKey): SwarmActivityRow[] {
  switch (filter) {
    case "shielded":
      return rows.filter((r) => r.visibility === "shielded");
    case "revealed":
      return rows.filter((r) => r.visibility === "revealed");
    case "memos":
      return rows.filter((r) => r.memos.length > 0);
    case "mined":
      return rows.filter((r) => r.mined);
    default:
      return rows;
  }
}

export function searchActivity(rows: SwarmActivityRow[], query: string): SwarmActivityRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.title, r.subtitle, r.txid, r.amount, r.address ?? "", ...r.memos].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}

export type SwarmAddressRow = {
  key: string;
  address: string;
  kind: "shielded" | "transparent";
  /** "SHIELDED" / "TRANSPARENT", for the card's kicker. */
  label: string;
  /** What this address is for, in one line. */
  note: string;
};

/**
 * The wallet's own addresses, shielded first.
 *
 * A unified address is listed as shielded because that is what it is used
 * for here; its transparent receiver exists but is not what a person is
 * handing out when they copy it.
 */
export function deriveOwnAddresses(
  unified: UnifiedAddressClass[],
  transparent: TransparentAddressClass[],
): SwarmAddressRow[] {
  const shielded: SwarmAddressRow[] = (unified ?? []).map((a, i) => ({
    key: `u-${a.encoded_address}-${i}`,
    address: a.encoded_address,
    kind: "shielded",
    label: "SHIELDED",
    note: "Safe to reuse — payments to it are not linkable on-chain.",
  }));

  const clear: SwarmAddressRow[] = (transparent ?? []).map((a, i) => ({
    key: `t-${a.encoded_address}-${i}`,
    address: a.encoded_address,
    kind: "transparent",
    label: "TRANSPARENT",
    note: "Public. Anything received here is visible on the chain until you shield it.",
  }));

  return [...shielded, ...clear];
}

/**
 * What the chain records about a payment, per payment.
 *
 * Only the two facts that are true of this network's transactions: a shielded
 * transaction publishes that it happened and what it paid in fees, and
 * nothing else; a transparent one publishes the address and the amount as
 * well. Anything beyond that — who else can link it, what a chain analyst
 * might infer — is not something this wallet can claim to know, so it is not
 * claimed.
 */
export type ChainVisibleFact = { key: string; value: string; hidden: boolean };

export function chainSees(opts: {
  shielded: boolean;
  address?: string;
  amount?: string;
  fee?: string;
  ticker: string;
}): ChainVisibleFact[] {
  const { shielded, address, amount, fee, ticker } = opts;
  if (shielded) {
    return [
      { key: "That a transaction happened", value: "yes", hidden: false },
      { key: "Sender", value: "hidden", hidden: true },
      { key: "Recipient", value: "hidden", hidden: true },
      { key: "Amount", value: "hidden", hidden: true },
      { key: "Memo", value: "encrypted", hidden: true },
      { key: "Fee", value: fee ? `${fee} ${ticker}` : "visible", hidden: false },
    ];
  }
  return [
    { key: "That a transaction happened", value: "yes", hidden: false },
    { key: "Recipient address", value: address ? abbreviate(address, 10) : "visible", hidden: false },
    { key: "Amount", value: amount ? `${amount} ${ticker}` : "visible", hidden: false },
    { key: "Fee", value: fee ? `${fee} ${ticker}` : "visible", hidden: false },
  ];
}

export { abbreviate };
