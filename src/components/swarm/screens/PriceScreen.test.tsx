/**
 * The SWM price page (specs/PRICE-DISPLAY.md §6): what it shows when the
 * price is fresh, when it is off, and when the relay sends no daily series;
 * the range switch and the readout; the copy controls; the listing buttons;
 * and that a test-coin build has no such page.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ContextAppProvider, defaultAppState } from "../../../context/ContextAppState";
import { AppState, TotalBalanceClass } from "../../appstate";
import SwarmUiContext from "../SwarmUiContext";
import { clipboard, price as priceBridge } from "../../../electronBridge";
import { PriceScreen } from "./PriceScreen";
import { SwmChartSeries, pointLabel, seriesFor } from "../components/SwmPriceChart";
import { SWM_PRICE_OFF, SwmPriceState } from "../../../price/swmPriceTypes";
import { SWM_POOL_ID, SWM_PRICE_FOOTNOTE, SWM_TOKEN_ADDRESS } from "../../../price/swmPool";

jest.mock("../../../electronBridge");

let mockTestCoins = false;
jest.mock("../../../utils/swarmNetwork", () => ({
  ...jest.requireActual("../../../utils/swarmNetwork"),
  get SWARM_COINS_ARE_TEST_COINS() {
    return mockTestCoins;
  },
}));

const HOUR_START = 1791054000;
const DAY_START = 1788739200; // 2026-09-07 00:00 UTC

const FRESH: SwmPriceState = {
  priceUsd: "0.8411",
  changePct24h: 36.72,
  sparklineUsd: Array.from({ length: 48 }, (_, i) => 0.5 + i / 150),
  source: "geckoterminal",
  generatedUnix: HOUR_START + 47 * 3600 + 120,
  fetchedAtMs: Date.now() - 12_000,
  status: "fresh",
  pending: false,
  details: {
    priceEth: "0.000195976",
    changePct1h: 0,
    changePct6h: -3.24,
    hourlyFromUnix: HOUR_START,
    hourlyEndsLive: false,
    dailyEndsLive: false,
    dailyUsd: Array.from({ length: 30 }, (_, i) => 0.3 + i / 50),
    dailyFromUnix: DAY_START,
    transactions24h: { buys: 9, sells: 0 },
    liquidityUsd: 3761.34,
    volume24hUsd: 378.11,
    fdvUsd: 8411.43,
    poolFeePct: 0.9,
    poolCreatedUnix: 1791100000,
    sources: [
      { id: "geckoterminal", ok: true, priceUsd: "0.84114343", fetchedUnix: 1791223633 },
      { id: "dexscreener", ok: false, priceUsd: null, fetchedUnix: null },
    ],
  },
};

const NO_DAILY: SwmPriceState = {
  ...FRESH,
  details: FRESH.details ? { ...FRESH.details, dailyUsd: null, dailyFromUnix: null } : null,
};

const balance = Object.assign(new TotalBalanceClass(), { totalOrchardBalance: 12480.35 });

function renderPage(state: Partial<AppState>, hidden = false) {
  return render(
    <ContextAppProvider value={{ ...defaultAppState, totalBalance: balance, ...state }}>
      <MemoryRouter initialEntries={["/price"]}>
        <SwarmUiContext.Provider value={{ hidden, toggleHidden: () => undefined }}>
          <Routes>
            <Route path="/price" element={<PriceScreen />} />
            <Route path="/dashboard" element={<div>the overview</div>} />
          </Routes>
        </SwarmUiContext.Provider>
      </MemoryRouter>
    </ContextAppProvider>,
  );
}

beforeEach(() => {
  mockTestCoins = false;
  jest.clearAllMocks();
});

describe("a fresh price", () => {
  it("shows the price, the ETH price, three changes and when it was read", () => {
    renderPage({ swmPrice: FRESH });
    expect(within(screen.getByRole("region", { name: "SWM price" })).getByText("$0.8411")).toBeInTheDocument();
    expect(screen.getByText("0.000196 ETH")).toBeInTheDocument();
    expect(screen.getByText("0.0 % 1h")).toBeInTheDocument();
    expect(screen.getByText("▼ 3.2 % 6h")).toBeInTheDocument();
    expect(screen.getByText("▲ 36.7 % 24h")).toBeInTheDocument();
    expect(screen.getByText("updated 12 s ago")).toBeInTheDocument();
  });

  it("shows the balance in SWM and dollars, and masks both with the balances", () => {
    const { unmount } = renderPage({ swmPrice: FRESH });
    const card = screen.getByRole("region", { name: "Your balance" });
    expect(card).toHaveTextContent("12,480.35 SWM");
    expect(card).toHaveTextContent("≈ $10,497.22 USD");
    unmount();

    renderPage({ swmPrice: FRESH }, true);
    const hidden = screen.getByRole("region", { name: "Your balance" });
    expect(hidden).not.toHaveTextContent("12,480");
    expect(hidden).toHaveTextContent("≈ •••••• USD");
    expect(within(screen.getByRole("region", { name: "SWM price" })).getByText("$0.8411")).toBeInTheDocument();
  });

  it("shows the pool's figures", () => {
    renderPage({ swmPrice: FRESH });
    const pool = screen.getByRole("region", { name: "Pool" });
    for (const text of ["$3,761.34", "$378.11", "$8,411.43", "9 / 0", "0.9 %", "Base"]) {
      expect(pool).toHaveTextContent(text);
    }
  });

  it("lists each source with its own reading, a failed one with a dash", () => {
    renderPage({ swmPrice: FRESH });
    const sources = screen.getByRole("region", { name: "Sources" });
    expect(within(sources).getByLabelText("answering")).toHaveTextContent("✓");
    expect(within(sources).getByLabelText("not answering")).toHaveTextContent("—");
  });

  it("opens each listing page through main, by name", () => {
    renderPage({ swmPrice: FRESH });
    fireEvent.click(screen.getByRole("button", { name: /Open on DexScreener/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open on GeckoTerminal/ }));
    expect(priceBridge.openListing).toHaveBeenNthCalledWith(1, "dexscreener");
    expect(priceBridge.openListing).toHaveBeenNthCalledWith(2, "geckoterminal");
  });

  it("shows the pool and the token shortened, and copies them in full from this build's constants", () => {
    renderPage({ swmPrice: FRESH });
    expect(screen.getByText("0xf1e0…4599")).toBeInTheDocument();
    expect(screen.getByText("0xf904…043B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy the pool address" }));
    expect(clipboard.writeText).toHaveBeenCalledWith(SWM_POOL_ID);
    fireEvent.click(screen.getByRole("button", { name: "Copy the token address" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith(SWM_TOKEN_ADDRESS);
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("ends with the note and the switch", () => {
    const setShowSwmPrice = jest.fn();
    renderPage({ swmPrice: FRESH, setShowSwmPrice });
    expect(screen.getByText(SWM_PRICE_FOOTNOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Show SWM price (USD)" }));
    expect(setShowSwmPrice).toHaveBeenCalledWith(false);
  });

  it("goes back to the Overview", () => {
    renderPage({ swmPrice: FRESH });
    fireEvent.click(screen.getByRole("button", { name: "← Overview" }));
    expect(screen.getByText("the overview")).toBeInTheDocument();
  });
});

describe("the chart", () => {
  it("opens on 48h, and switches to 30d and 24h", () => {
    renderPage({ swmPrice: FRESH });
    expect(screen.getByRole("button", { name: "48h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /over 48h/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /over 30d: from \$0\.3000 to \$0\.8800/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    expect(screen.getByRole("img", { name: /over 24h/ })).toBeInTheDocument();
  });

  it("labels the lowest, highest and latest value", () => {
    renderPage({ swmPrice: FRESH });
    const chart = screen.getByTestId("swm-chart");
    expect(chart).toHaveTextContent("$0.5000");
    expect(chart).toHaveTextContent("$0.8133");
  });

  it("reads out the value and time of a point, from the keyboard as from the pointer", () => {
    renderPage({ swmPrice: FRESH });
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    const chart = screen.getByTestId("swm-chart");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    const readout = screen.getByTestId("swm-chart-readout");
    // The second-to-last daily close, and its UTC day.
    expect(readout).toHaveTextContent("$0.8600");
    expect(readout).toHaveTextContent("Oct 5");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByTestId("swm-chart-readout")).not.toBeInTheDocument();
  });

  it("disables 30d when the relay sends no daily series", () => {
    renderPage({ swmPrice: NO_DAILY });
    expect(screen.getByRole("button", { name: "30d" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "48h" })).toBeEnabled();
    expect(within(screen.getByRole("region", { name: "SWM price" })).getByText("$0.8411")).toBeInTheDocument();
  });

  it("times the hourly points from hourly_from_unix, and from the generation hour without it", () => {
    expect(seriesFor("48h", FRESH)?.times[0]).toBe(HOUR_START);
    expect(seriesFor("24h", FRESH)?.times[0]).toBe(HOUR_START + 24 * 3600);
    expect(seriesFor("24h", FRESH)?.points).toHaveLength(24);
    const untimed = { ...FRESH, details: FRESH.details ? { ...FRESH.details, hourlyFromUnix: null } : null };
    expect(seriesFor("48h", untimed)?.times[47]).toBe(HOUR_START + 47 * 3600);
    expect(seriesFor("30d", NO_DAILY)).toBeNull();
  });
});

describe("when there is no price to show", () => {
  it("shows only the note and the switch while the setting is off", () => {
    renderPage({ swmPrice: SWM_PRICE_OFF, showSwmPrice: false });
    expect(screen.getByText(SWM_PRICE_FOOTNOTE)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show SWM price (USD)" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("swm-chart")).not.toBeInTheDocument();
  });

  it("says the price is unavailable, and still offers the listings", () => {
    renderPage({ swmPrice: { ...SWM_PRICE_OFF, status: "unavailable" } });
    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open on DexScreener/ })).toBeInTheDocument();
  });

  it("does not exist on a test-coin build", () => {
    mockTestCoins = true;
    renderPage({ swmPrice: FRESH });
    expect(screen.getByText("the overview")).toBeInTheDocument();
    expect(screen.queryByText("$0.8411")).not.toBeInTheDocument();
  });
});

describe("the live price at the end of each series (§6.1)", () => {
  // 48 hourly closes then the live price; 30 daily closes then the live price.
  const GENERATED = HOUR_START + 47 * 3600 + 1200;
  const LIVE: SwmPriceState = {
    ...FRESH,
    generatedUnix: GENERATED,
    sparklineUsd: [...Array.from({ length: 48 }, (_, i) => 0.5 + i / 150), 0.8411],
    details: FRESH.details
      ? {
          ...FRESH.details,
          hourlyEndsLive: true,
          dailyUsd: [...Array.from({ length: 30 }, (_, i) => 0.3 + i / 50), 0.8411],
          dailyEndsLive: true,
        }
      : null,
  };

  it("times the closes from their start and the live point at the relay's generation time", () => {
    const hourly = seriesFor("48h", LIVE);
    expect(hourly?.points).toHaveLength(49);
    expect(hourly?.times[47]).toBe(HOUR_START + 47 * 3600);
    expect(hourly?.times[48]).toBe(GENERATED);
    expect(hourly?.endsLive).toBe(true);
    expect(seriesFor("30d", LIVE)?.times[30]).toBe(GENERATED);
  });

  it("keeps the live price in every range: 24h is 24 closes and the live price", () => {
    const day = seriesFor("24h", LIVE);
    expect(day?.points).toHaveLength(25);
    expect(day?.points[24]).toBe(0.8411);
    expect(day?.times[0]).toBe(HOUR_START + 24 * 3600);
    expect(seriesFor("30d", LIVE)?.points[30]).toBe(0.8411);
  });

  it("without start times, pins the last close to the generation hour and the live point after it", () => {
    const untimed = { ...LIVE, details: LIVE.details ? { ...LIVE.details, hourlyFromUnix: null } : null };
    const series = seriesFor("48h", untimed);
    expect(series?.times[47]).toBe(Math.floor(GENERATED / 3600) * 3600);
    expect(series?.times[48]).toBe(GENERATED);
  });

  it("says 'now' for the live point, in the readout and under the chart", () => {
    renderPage({ swmPrice: LIVE });
    const chart = screen.getByTestId("swm-chart");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByTestId("swm-chart-readout")).toHaveTextContent("$0.8411now");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByTestId("swm-chart-readout")).not.toHaveTextContent("now");
    expect(pointLabel(seriesFor("30d", LIVE) as SwmChartSeries, 30)).toBe("now");
    expect(pointLabel(seriesFor("30d", LIVE) as SwmChartSeries, 29)).toBe("Oct 6");
  });

  it("treats a series without the live point as closes only", () => {
    expect(seriesFor("48h", FRESH)?.endsLive).toBe(false);
    expect(pointLabel(seriesFor("48h", FRESH) as SwmChartSeries, 47)).not.toBe("now");
  });
});
