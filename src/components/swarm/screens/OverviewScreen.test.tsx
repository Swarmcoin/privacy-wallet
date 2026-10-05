/**
 * The balance card says "test coins · no market value" on a test network and
 * nowhere else. Up to 0.1.0-mainnet.5 it said it on the mainnet build too,
 * under the owner's real balance.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ContextAppProvider, defaultAppState } from "../../../context/ContextAppState";
import { AppState, TotalBalanceClass } from "../../appstate";
import SwarmUiContext from "../SwarmUiContext";
import { OverviewScreen } from "./OverviewScreen";
import { SWM_PRICE_OFF, SwmPriceState } from "../../../price/swmPriceTypes";
import { price as priceBridge } from "../../../electronBridge";
import { sparklinePaths } from "../components/SwmPriceCard";

jest.mock("../../../electronBridge");

let mockTestCoins = true;
jest.mock("../../../utils/swarmNetwork", () => ({
  ...jest.requireActual("../../../utils/swarmNetwork"),
  get SWARM_COINS_ARE_TEST_COINS() {
    return mockTestCoins;
  },
}));

function renderOverview(state: AppState = defaultAppState, hidden = false) {
  return render(
    <ContextAppProvider value={state}>
      <MemoryRouter>
        <SwarmUiContext.Provider value={{ hidden, toggleHidden: () => undefined }}>
          <OverviewScreen />
        </SwarmUiContext.Provider>
      </MemoryRouter>
    </ContextAppProvider>,
  );
}

describe("the balance card's network note", () => {
  it("says the coins have no value on a test network", () => {
    mockTestCoins = true;
    renderOverview();
    expect(screen.getByText("test coins · no market value")).toBeInTheDocument();
  });

  it("says nothing of the kind on mainnet", () => {
    mockTestCoins = false;
    renderOverview();
    expect(screen.queryByText(/no market value/)).not.toBeInTheDocument();
    expect(screen.queryByText(/test coins/)).not.toBeInTheDocument();
  });
});

/**
 * The SWM price on the Overview (specs/PRICE-DISPLAY.md §3, items 1 and 2).
 */
describe("the SWM price", () => {
  const FRESH: SwmPriceState = {
    priceUsd: "0.8411",
    changePct24h: 36.72,
    sparklineUsd: [0.5259, 0.573, 0.6361, 0.6533, 0.7537, 0.8411],
    source: "geckoterminal",
    generatedUnix: 1791223633,
    fetchedAtMs: Date.now() - 12_000,
    status: "fresh",
    pending: false,
    details: null,
  };

  const balance = Object.assign(new TotalBalanceClass(), {
    confirmedOrchardBalance: 12480.35,
    totalOrchardBalance: 12480.35,
  });

  const withPrice = (swmPrice: SwmPriceState): AppState => ({
    ...defaultAppState,
    totalBalance: balance,
    swmPrice,
  });

  beforeEach(() => {
    mockTestCoins = false;
  });

  it("shows the price card and the fiat value of the balance", () => {
    renderOverview(withPrice(FRESH));
    expect(screen.getByText("SWM PRICE")).toBeInTheDocument();
    expect(screen.getByText("$0.8411")).toBeInTheDocument();
    expect(screen.getByText("▲ 36.7 % 24h")).toBeInTheDocument();
    expect(screen.getByText(/GeckoTerminal · updated 12 s ago/)).toBeInTheDocument();
    expect(screen.queryByText(/Base · Uniswap v4/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Indicative price from the SWM/ETH pool on Base. The pool is small; small trades move it. Not a quote.",
      ),
    ).toBeInTheDocument();
  });

  it("writes the balance in dollars under the total", () => {
    renderOverview(withPrice(FRESH));
    expect(screen.getByLabelText("Total balance")).toHaveTextContent("≈ $10,497.22 USD");
  });

  it("masks the fiat value with the balances, and never the price", () => {
    renderOverview(withPrice(FRESH), true);
    expect(screen.getByLabelText("Total balance")).toHaveTextContent("≈ •••••• USD");
    expect(screen.queryByText(/10,497/)).not.toBeInTheDocument();
    expect(screen.getByText("$0.8411")).toBeInTheDocument();
  });

  it("greys the price and says how old it is once it is ageing", () => {
    const at = new Date(2026, 9, 5, 18, 7).getTime();
    renderOverview(withPrice({ ...FRESH, status: "ageing", fetchedAtMs: at }));
    expect(screen.getByText(/as of 18:07/)).toBeInTheDocument();
    expect(screen.getByTitle("Open the SWM price page")).toHaveAttribute("data-status", "ageing");
  });

  it("says the price is unavailable after an hour without one", () => {
    renderOverview(withPrice({ ...FRESH, status: "unavailable" }));
    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
    expect(screen.queryByText("$0.8411")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total balance")).not.toHaveTextContent(/USD/);
  });

  it("opens the price page, and opens nothing outside the app", () => {
    render(
      <ContextAppProvider value={withPrice(FRESH)}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/dashboard" element={<OverviewScreen />} />
            <Route path="/price" element={<div>the price page</div>} />
          </Routes>
        </MemoryRouter>
      </ContextAppProvider>,
    );
    fireEvent.click(screen.getByTitle("Open the SWM price page"));
    expect(screen.getByText("the price page")).toBeInTheDocument();
    expect(priceBridge.openListing).not.toHaveBeenCalled();
  });

  it("shows nothing when the setting is off", () => {
    renderOverview(withPrice(SWM_PRICE_OFF));
    expect(screen.queryByText("SWM PRICE")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Total balance")).not.toHaveTextContent(/USD/);
  });

  it("shows nothing on a test-coin build, whatever the state says", () => {
    mockTestCoins = true;
    renderOverview(withPrice(FRESH));
    expect(screen.queryByText("SWM PRICE")).not.toBeInTheDocument();
    expect(screen.queryByText(/≈ \$/)).not.toBeInTheDocument();
  });
});

describe("the sparkline", () => {
  it("runs oldest to newest across the box, highest at the top", () => {
    const { line, area } = sparklinePaths([1, 3, 2], 100, 50, 0);
    expect(line).toBe("M0.00,50.00 L50.00,0.00 L100.00,25.00");
    expect(area).toBe(`${line} L100.00,50 L0,50 Z`);
  });

  it("draws flat data as a level line, and nothing for a single point", () => {
    expect(sparklinePaths([2, 2, 2], 100, 50).line).toBe("M0.00,25.00 L50.00,25.00 L100.00,25.00");
    expect(sparklinePaths([2], 100, 50)).toEqual({ line: "", area: "" });
  });

  it("is drawn on the card when the relay sends one", () => {
    mockTestCoins = false;
    renderOverview({
      ...defaultAppState,
      swmPrice: {
        priceUsd: "0.8411",
        changePct24h: -3.2,
        sparklineUsd: [0.9, 0.85, 0.8411],
        source: "dexscreener",
        generatedUnix: 1791223633,
        fetchedAtMs: Date.now(),
        status: "fresh",
        pending: false,
        details: null,
      },
    });
    expect(screen.getByTestId("swm-sparkline")).toBeInTheDocument();
    expect(screen.getByText("▼ 3.2 % 24h")).toBeInTheDocument();
    expect(screen.getByText(/DexScreener · updated just now/)).toBeInTheDocument();
  });
});
