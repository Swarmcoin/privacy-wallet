/**
 * The SWM price outside the Overview: the switch in Settings and the dollar
 * line under the amount on Send (specs/PRICE-DISPLAY.md §2.2, §3 item 3).
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ContextAppProvider, defaultAppState } from "../../../context/ContextAppState";
import { AppState } from "../../appstate";
import SwarmUiContext from "../SwarmUiContext";
import { ipcRenderer } from "../../../electronBridge";
import { SWM_PRICE_OFF, SwmPriceState } from "../../../price/swmPriceTypes";

jest.mock("../../../electronBridge");

let mockTestCoins = false;
jest.mock("../../../utils/swarmNetwork", () => ({
  ...jest.requireActual("../../../utils/swarmNetwork"),
  get SWARM_COINS_ARE_TEST_COINS() {
    return mockTestCoins;
  },
}));

// The modals Settings mounts read `window.electronAPI` as their modules load.
Object.defineProperty(window, "electronAPI", {
  value: {
    ipcRenderer: {
      invoke: (...args: unknown[]) => (ipcRenderer.invoke as jest.Mock)(...args),
      on: (...args: unknown[]) => (ipcRenderer.on as jest.Mock)(...args),
      send: jest.fn(),
    },
  },
  writable: true,
});
/* eslint-disable @typescript-eslint/no-require-imports */
const { SettingsScreen, SWM_PRICE_SETTING_HELP } = require("./SettingsScreen");
const { SendScreen } = require("./SendScreen");
/* eslint-enable @typescript-eslint/no-require-imports */

const FRESH: SwmPriceState = {
  priceUsd: "0.8411",
  changePct24h: 36.72,
  sparklineUsd: null,
  source: "geckoterminal",
  generatedUnix: 1791223633,
  fetchedAtMs: Date.now(),
  status: "fresh",
  pending: false,
  details: null,
};

function renderWith(ui: React.ReactElement, state: Partial<AppState>, hidden = false) {
  return render(
    <ContextAppProvider value={{ ...defaultAppState, ...state }}>
      <MemoryRouter>
        <SwarmUiContext.Provider value={{ hidden, toggleHidden: () => undefined }}>{ui}</SwarmUiContext.Provider>
      </MemoryRouter>
    </ContextAppProvider>,
  );
}

beforeEach(() => {
  mockTestCoins = false;
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async () => ({}));
});

describe("Settings → Show SWM price (USD)", () => {
  it("is a switch, on by default, with the specification's help text", () => {
    renderWith(<SettingsScreen />, { showSwmPrice: true });
    const toggle = screen.getByRole("switch", { name: "Show SWM price (USD)" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(SWM_PRICE_SETTING_HELP)).toBeInTheDocument();
    expect(SWM_PRICE_SETTING_HELP).toBe(
      "The price comes from the SWARM price service (wallet.swarm.green), which reads the SWM/ETH pool on Base from GeckoTerminal and DexScreener. Your addresses and balances are never sent. Switch this off and the wallet makes no price requests.",
    );
  });

  it("switches off, and on again", () => {
    const setShowSwmPrice = jest.fn();
    const { rerender } = renderWith(<SettingsScreen />, { showSwmPrice: true, setShowSwmPrice });
    fireEvent.click(screen.getByRole("switch", { name: "Show SWM price (USD)" }));
    expect(setShowSwmPrice).toHaveBeenCalledWith(false);

    rerender(
      <ContextAppProvider value={{ ...defaultAppState, showSwmPrice: false, setShowSwmPrice }}>
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>
      </ContextAppProvider>,
    );
    const toggle = screen.getByRole("switch", { name: "Show SWM price (USD)" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(setShowSwmPrice).toHaveBeenLastCalledWith(true);
  });

  it("is not offered on a test-coin build", () => {
    mockTestCoins = true;
    renderWith(<SettingsScreen />, {});
    expect(screen.queryByRole("switch", { name: "Show SWM price (USD)" })).not.toBeInTheDocument();
  });
});

describe("Send → the amount in dollars", () => {
  const renderSend = (state: Partial<AppState>, hidden = false) =>
    renderWith(<SendScreen sendTransaction={async () => ""} setSendPageState={() => undefined} />, state, hidden);

  const type = (value: string) => fireEvent.change(screen.getByLabelText("Amount"), { target: { value } });

  it("follows the amount as it is typed", () => {
    renderSend({ swmPrice: FRESH });
    expect(screen.queryByTestId("send-amount-fiat")).not.toBeInTheDocument();
    type("223.04");
    expect(screen.getByTestId("send-amount-fiat")).toHaveTextContent("≈ $187.60 USD");
    type("1");
    expect(screen.getByTestId("send-amount-fiat")).toHaveTextContent("≈ $0.84 USD");
    type("abc");
    expect(screen.queryByTestId("send-amount-fiat")).not.toBeInTheDocument();
  });

  it("is masked while balances are hidden", () => {
    renderSend({ swmPrice: FRESH }, true);
    type("223.04");
    expect(screen.getByTestId("send-amount-fiat")).toHaveTextContent("≈ •••••• USD");
  });

  it("is absent when the price is off, unavailable, or the coins are test coins", () => {
    const { unmount } = renderSend({ swmPrice: SWM_PRICE_OFF });
    type("223.04");
    expect(screen.queryByTestId("send-amount-fiat")).not.toBeInTheDocument();
    unmount();

    const view = renderSend({ swmPrice: { ...FRESH, status: "unavailable" } });
    type("223.04");
    expect(screen.queryByTestId("send-amount-fiat")).not.toBeInTheDocument();
    view.unmount();

    mockTestCoins = true;
    renderSend({ swmPrice: FRESH });
    type("223.04");
    expect(screen.queryByTestId("send-amount-fiat")).not.toBeInTheDocument();
  });
});
