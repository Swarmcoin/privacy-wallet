/**
 * Which outputs a payout spends, and the sentence that explains the result.
 *
 * The custody tool implements exactly one disbursement policy, because it is
 * the only one the consensus rules allow for a coinbase output: **whole**
 * selected outputs, no transparent output of any kind, and therefore no
 * change. The shielded note is `total selected - fee`.
 *
 * So "send 100 SWM" is not a thing this page can do. What it can do is pick
 * whole outputs that come to at least 100 SWM and say, before anything is
 * signed, exactly what the recipient will receive instead. That sentence is
 * the whole point of this module: the amount the coordinator typed is a
 * *floor*, and the page must never let them believe otherwise.
 */

/** One unspent output, as the addon reports it from the indexer. */
export type TreasuryUtxo = {
  txid: string;
  vout: number;
  value: number;
  height: number;
  is_coinbase: boolean;
  script: string;
  confirmations: number;
  mature: boolean;
};

/** What the addon answers for a fund's address. */
export type TreasuryUtxoSet = {
  address: string;
  chain_height: number;
  coinbase_maturity: number;
  mature_total: number;
  immature_total: number;
  utxos: TreasuryUtxo[];
  /** Whether the fund holds more outputs than `utxos` carries. */
  truncated: boolean;
  /**
   * How many outputs the fund holds, loaded or not. Absent from addons
   * before 0.1.0-mainnet.6, which said only `truncated`.
   */
  total_outputs?: number;
  /** What all of them come to, loaded or not, in zatoshis. */
  total_value?: number;
  /** The most outputs one load, and so one payout, can carry. */
  loaded_limit?: number;
};

/** What `selectUtxos` needs to know about a set that was cut short. */
export type LoadedExtent = Pick<TreasuryUtxoSet, "truncated" | "total_outputs" | "loaded_limit">;

/**
 * "Showing the oldest 200 of 555 outputs; …", or "" when nothing was cut.
 *
 * The addon loads at most a fixed number of a fund's outputs, oldest first,
 * because each one costs an indexer request to learn whether it is a
 * coinbase. It always said when it had stopped (`truncated`); until
 * 0.1.0-mainnet.6 the page ignored that, so the Mining fund — 555 outputs on
 * 2026-09-27 — looked like a fund of 200. A payout spends only loaded
 * outputs, so the same number is the most one payout can spend.
 */
export function truncationNote(set: LoadedExtent & { utxos: TreasuryUtxo[] }): string {
  if (!set.truncated) return "";
  const loaded = set.loaded_limit ?? set.utxos.length;
  const of = set.total_outputs !== undefined ? `of ${set.total_outputs} outputs` : "outputs of more";
  return `Showing the oldest ${loaded} ${of}; a payout can spend at most ${loaded} in one go.`;
}

/** A selection that can be turned into a proposal. */
export type Selection = {
  ok: true;
  selected: TreasuryUtxo[];
  /** What the selected outputs come to, before the fee. */
  totalIn: number;
  /** The floor the coordinator asked for. */
  requested: number;
  /** How much more than the floor the selection comes to, before the fee. */
  overshoot: number;
};

/** A selection that cannot be made, and why, in words a person can act on. */
export type NoSelection = {
  ok: false;
  reason: string;
};

export type SelectionResult = Selection | NoSelection;

/**
 * The order outputs are considered in: largest first.
 *
 * Largest-first keeps the input count down, and the input count is what the
 * ZIP-317 conventional fee is charged on, so it is also cheapest-first. Ties
 * break on height, then on the outpoint, so the order is total: the same
 * UTXO set always produces the same proposal, on either machine, in either
 * order the indexer happened to return them.
 *
 * The addon sorts identically before it answers, so what the screen explains
 * and what the proposal spends cannot drift apart.
 */
export function selectionOrder(a: TreasuryUtxo, b: TreasuryUtxo): number {
  if (a.value !== b.value) return b.value - a.value;
  if (a.height !== b.height) return a.height - b.height;
  if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
  return a.vout - b.vout;
}

/**
 * Selects whole mature outputs coming to at least `requested` zatoshis.
 *
 * Immature outputs are never selected and never counted: a coinbase output
 * needs its hundred confirmations, and a proposal that spends one early is a
 * proposal the network refuses after two people have signed it.
 */
export function selectUtxos(utxos: TreasuryUtxo[], requested: number, extent?: LoadedExtent): SelectionResult {
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, reason: "Enter how much to pay out." };
  }
  if (!Number.isInteger(requested)) {
    return { ok: false, reason: "Amounts are whole zatoshis." };
  }

  const mature = utxos.filter((u) => u.mature).sort(selectionOrder);
  if (mature.length === 0) {
    const immature = utxos.length;
    return {
      ok: false,
      reason:
        immature > 0
          ? `This fund has ${immature} output${immature === 1 ? "" : "s"}, none of them mature yet. A collector output can be spent after 100 confirmations.`
          : "This fund holds nothing the indexer can see.",
    };
  }

  const matureTotal = mature.reduce((sum, u) => sum + u.value, 0);
  if (matureTotal < requested && extent?.truncated) {
    // Not "the most this fund can pay": the fund holds more than was loaded,
    // and what was loaded is all one payout can spend.
    const loaded = extent.loaded_limit ?? utxos.length;
    const of = extent.total_outputs !== undefined ? ` of ${extent.total_outputs}` : "";
    return {
      ok: false,
      reason:
        `This floor cannot be reached in one payout. A payout spends only the outputs loaded here, ` +
        `the oldest ${loaded}${of}, and the mature ones among them come to ${matureTotal} zat; ` +
        `you asked for at least ${requested} zat. Pay it out in parts of at most ${matureTotal} zat.`,
    };
  }
  if (matureTotal < requested) {
    return {
      ok: false,
      reason: `The most this fund can pay right now is ${matureTotal} zat, across ${mature.length} mature output${mature.length === 1 ? "" : "s"}. You asked for ${requested} zat.`,
    };
  }

  const selected: TreasuryUtxo[] = [];
  let totalIn = 0;
  for (const utxo of mature) {
    selected.push(utxo);
    totalIn += utxo.value;
    if (totalIn >= requested) break;
  }

  return { ok: true, selected, totalIn, requested, overshoot: totalIn - requested };
}

/** Eight decimal places, no exponent, the way every other screen writes SWM. */
export function formatZat(zat: number): string {
  const negative = zat < 0;
  const value = Math.abs(Math.trunc(zat));
  const whole = Math.floor(value / 100_000_000);
  const fraction = String(value % 100_000_000).padStart(8, "0");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${fraction}`;
}

/**
 * The sentence the page shows once a selection has been made.
 *
 * It says the exact amount the recipient receives, and it says it before the
 * proposal is built rather than after, because the number the coordinator
 * typed is not that number and they have to see the difference while they can
 * still change their mind.
 */
export function explainSelection(selection: Selection, fee: number | null, ticker = "SWM"): string {
  const count = selection.selected.length;
  const outputs = `${count} whole output${count === 1 ? "" : "s"}`;
  const asked = `You asked for at least ${formatZat(selection.requested)} ${ticker}.`;
  const takes = `The smallest set of ${outputs} that reaches it comes to ${formatZat(selection.totalIn)} ${ticker}.`;
  // A coinbase spend may carry no transparent output at all, not even change
  // back to the fund, so every zatoshi of the selected outputs leaves.
  const noChange =
    "A payout from a collector output cannot carry change, so all of it leaves the fund:";
  const arrives =
    fee === null
      ? `the recipient receives ${formatZat(selection.totalIn)} ${ticker} less the fee.`
      : `the recipient receives ${formatZat(selection.totalIn - fee)} ${ticker}, and ${formatZat(fee)} ${ticker} is the fee.`;
  return `${asked} ${takes} ${noChange} ${arrives}`;
}
