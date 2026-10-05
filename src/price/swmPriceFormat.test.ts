/**
 * How the price and fiat values are written (specs/PRICE-DISPLAY.md §2.2, §3).
 */
import {
  FIAT_MASK,
  fiatLine,
  fiatValueUsd,
  formatAge,
  formatChange,
  formatClock,
  formatUsdPrice,
  parsePriceUnits,
} from "./swmPriceFormat";

describe("the price", () => {
  it.each([
    ["0.84114343", "$0.8411"],
    ["0.8602", "$0.8602"],
    ["0.000195976", "$0.0001960"],
    ["0.5", "$0.5000"],
    ["1.5", "$1.50"],
    ["1", "$1.00"],
    ["0.99996", "$1.00"],
    ["1234.5678", "$1,234.57"],
  ])("%s is written %s", (input, expected) => {
    expect(formatUsdPrice(input)).toBe(expected);
  });

  it.each([null, undefined, "", "0", "0.00", "-1", "abc", "1e3"])("has nothing to write for %p", (input) => {
    expect(formatUsdPrice(input as string)).toBeNull();
  });
});

describe("the fiat value", () => {
  it("is the balance times the price, rounded half-up to cents", () => {
    expect(fiatValueUsd(12480.35, "0.8411")).toBe("10,497.22");
    expect(fiatLine(12480.35, "0.8411", false)).toBe("≈ $10,497.22 USD");
  });

  it("rounds half a cent up, in decimals rather than floating point", () => {
    // 1.005 × 1 = 1.005 exactly; a float would print 1.00.
    expect(fiatValueUsd(1.005, "1")).toBe("1.01");
    expect(fiatValueUsd(0.00000001, "0.84114343")).toBe("0.00");
  });

  it("uses every decimal the relay sends", () => {
    expect(fiatValueUsd(11133.33, "0.84114343")).toBe("9,364.73");
    expect(fiatValueUsd(223.04, "0.84114343")).toBe("187.61");
  });

  it("keeps the sign of a negative amount", () => {
    expect(fiatValueUsd(-10, "0.8411")).toBe("-8.41");
    expect(fiatLine(-10, "0.8411", false)).toBe("≈ -$8.41 USD");
  });

  it("is masked, size and all, while balances are hidden", () => {
    expect(fiatLine(12480.35, "0.8411", true)).toBe(`≈ ${FIAT_MASK} USD`);
    expect(fiatLine(0.5, "0.8411", true)).toBe(fiatLine(99999999, "0.8411", true));
  });

  it("is nothing without a usable price or amount", () => {
    expect(fiatLine(10, null, false)).toBeNull();
    expect(fiatLine(10, "0", false)).toBeNull();
    expect(fiatLine(Number.NaN, "0.84", false)).toBeNull();
  });

  it("reads the relay's decimal exactly", () => {
    expect(parsePriceUnits("0.84114343")).toBe(841143430000000000n);
    expect(parsePriceUnits("2")).toBe(2000000000000000000n);
    expect(parsePriceUnits("0.0000000000000000001")).toBeNull();
  });
});

describe("the change", () => {
  it.each([
    [36.72, "▲ 36.7 % 24h", "up"],
    [-3.24, "▼ 3.2 % 24h", "down"],
    [0, "0.0 % 24h", "flat"],
    [0.04, "0.0 % 24h", "flat"],
    [1234.56, "▲ 1,234.6 % 24h", "up"],
  ])("%p is %s", (pct, text, tone) => {
    expect(formatChange(pct)).toEqual({ text, tone });
  });

  it("is nothing when the relay sent none", () => {
    expect(formatChange(null)).toBeNull();
  });
});

describe("times", () => {
  it("writes a clock time as hh:mm", () => {
    const at = new Date(2026, 9, 5, 8, 7).getTime();
    expect(formatClock(at)).toBe("08:07");
  });

  it.each([
    [2_000, "just now"],
    [12_000, "12 s ago"],
    [4 * 60_000 + 10_000, "4 min ago"],
    [2 * 3_600_000, "2 h ago"],
  ])("%i ms ago is %s", (age, text) => {
    expect(formatAge(1_000_000_000, 1_000_000_000 + age)).toBe(text);
  });
});
