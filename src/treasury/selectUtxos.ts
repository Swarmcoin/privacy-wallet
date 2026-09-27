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
  truncated: boolean;
};

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
export function selectUtxos(
  utxos: TreasuryUtxo[],
  requested: number,
  extent?: Pick<TreasuryUtxoSet, "truncated">,
): SelectionResult {
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
    // Not "the most this fund can pay": the fund holds more than the page
    // read (`describeHoldings`), and a payout spends only what was read, so
    // this is the most one payout can spend.
    return {
      ok: false,
      reason:
        `This floor cannot be reached in one payout. A payout spends only the outputs read here, ` +
        `the oldest ${utxos.length}, and the mature ones among them come to ${matureTotal} zat; you asked ` +
        `for at least ${requested} zat. Pay it out in parts of at most ${matureTotal} zat.`,
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
 * What the Funds tab says a fund holds.
 *
 * The addon reads at most a fixed number of a fund's outputs (each one costs
 * the indexer a transaction lookup to learn whether it is a coinbase output),
 * the oldest first, and answers `truncated` when there were more. A fund that
 * collects a share of every block passes that limit within hours of launch, so
 * the sum of what was read is a floor, not a balance, and the sentence has to
 * say which one it is. Until 0.1.0-mainnet.6 it did not: every mainnet fund
 * showed the sum of its first 200 outputs as if it were all it held, with
 * nothing "not yet spendable" because the newest outputs were never read.
 */
export function describeHoldings(set: TreasuryUtxoSet): string {
  const read = `${set.utxos.length} output${set.utxos.length === 1 ? "" : "s"}`;
  if (set.truncated) {
    const were = set.utxos.length === 1 ? "was" : "were";
    return `at least ${formatZat(set.mature_total)} mature: only the oldest ${read} ${were} read, and the fund holds more (height ${set.chain_height})`;
  }
  return `${formatZat(set.mature_total)} mature, ${formatZat(set.immature_total)} not yet spendable (${read} at height ${set.chain_height})`;
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
