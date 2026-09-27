import {
  explainSelection,
  formatZat,
  selectUtxos,
  selectionOrder,
  type TreasuryUtxo,
} from "./selectUtxos";

const utxo = (over: Partial<TreasuryUtxo>): TreasuryUtxo => ({
  txid: "11".repeat(32),
  vout: 0,
  value: 100,
  height: 1000,
  is_coinbase: true,
  script: "a914bf6506a42d05b142a49bb76de3476c0327ee775187",
  confirmations: 500,
  mature: true,
  ...over,
});

describe("which outputs a payout spends", () => {
  it("takes the fewest whole outputs that reach the amount, largest first", () => {
    const result = selectUtxos(
      [
        utxo({ txid: "aa".repeat(32), value: 300 }),
        utxo({ txid: "bb".repeat(32), value: 700 }),
        utxo({ txid: "cc".repeat(32), value: 500 }),
      ],
      800,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selected.map((u) => u.value)).toEqual([700, 500]);
    expect(result.totalIn).toBe(1200);
    expect(result.overshoot).toBe(400);
  });

  it("never selects an immature output, and says why the fund cannot pay", () => {
    const result = selectUtxos(
      [utxo({ value: 10_000, mature: false, confirmations: 3 })],
      1_000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("none of them mature");
    expect(result.reason).toContain("100 confirmations");
  });

  it("refuses when the mature outputs do not reach the amount, and says the ceiling", () => {
    const result = selectUtxos(
      [utxo({ txid: "aa".repeat(32), value: 400 }), utxo({ txid: "bb".repeat(32), value: 500 })],
      1_000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("900 zat");
    expect(result.reason).toContain("2 mature outputs");
  });

  it("stops as soon as the amount is reached rather than sweeping the fund", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      utxo({ txid: String(i).padStart(2, "0").repeat(32), value: 1_000 }),
    );
    const result = selectUtxos(many, 2_500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selected).toHaveLength(3);
    expect(result.totalIn).toBe(3_000);
  });

  it("is total: the same set in any order selects the same outputs", () => {
    const set = [
      utxo({ txid: "aa".repeat(32), value: 500, height: 10 }),
      utxo({ txid: "bb".repeat(32), value: 500, height: 9 }),
      utxo({ txid: "cc".repeat(32), value: 500, height: 10, vout: 1 }),
    ];
    const forwards = selectUtxos([...set], 900);
    const backwards = selectUtxos([...set].reverse(), 900);
    expect(forwards.ok && backwards.ok).toBe(true);
    if (!forwards.ok || !backwards.ok) return;
    expect(forwards.selected.map((u) => `${u.txid}:${u.vout}`)).toEqual(
      backwards.selected.map((u) => `${u.txid}:${u.vout}`),
    );
    // Oldest first among equal values.
    expect(forwards.selected[0].height).toBe(9);
  });

  it("orders by value, then height, then outpoint", () => {
    expect(selectionOrder(utxo({ value: 2 }), utxo({ value: 1 }))).toBeLessThan(0);
    expect(selectionOrder(utxo({ height: 1 }), utxo({ height: 2 }))).toBeLessThan(0);
    expect(selectionOrder(utxo({ vout: 0 }), utxo({ vout: 1 }))).toBeLessThan(0);
  });

  it("refuses an amount that is not a whole number of zatoshis", () => {
    expect(selectUtxos([utxo({ value: 100 })], 1.5)).toEqual({
      ok: false,
      reason: "Amounts are whole zatoshis.",
    });
    expect(selectUtxos([utxo({ value: 100 })], 0).ok).toBe(false);
  });

  it("says the fund is empty rather than blaming maturity for it", () => {
    const result = selectUtxos([], 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("holds nothing");
  });
});

describe("the sentence the coordinator reads before anything is signed", () => {
  it("says the exact amount the recipient gets, not the amount that was typed", () => {
    const result = selectUtxos(
      [utxo({ txid: "aa".repeat(32), value: 700_000_000 }), utxo({ txid: "bb".repeat(32), value: 500_000_000 })],
      800_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sentence = explainSelection(result, 15_000);
    expect(sentence).toContain("You asked for at least 8.00000000 SWM");
    expect(sentence).toContain("comes to 12.00000000 SWM");
    expect(sentence).toContain("cannot carry change");
    expect(sentence).toContain("recipient receives 11.99985000 SWM");
    expect(sentence).toContain("0.00015000 SWM is the fee");
  });

  it("says the fee is not known yet rather than inventing one", () => {
    const result = selectUtxos([utxo({ value: 100_000_000 })], 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(explainSelection(result, null)).toContain("less the fee");
  });
});

describe("writing amounts", () => {
  it("writes eight places and groups the whole part", () => {
    expect(formatZat(0)).toBe("0.00000000");
    expect(formatZat(1)).toBe("0.00000001");
    expect(formatZat(100_000_000)).toBe("1.00000000");
    expect(formatZat(123_456_789_012_345)).toBe("1,234,567.89012345");
  });
});
