/**
 * The balance card says "test coins · no market value" on a test network and
 * nowhere else. Up to 0.1.0-mainnet.5 it said it on the mainnet build too,
 * under the owner's real balance.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ContextAppProvider, defaultAppState } from "../../../context/ContextAppState";
import { OverviewScreen } from "./OverviewScreen";

jest.mock("../../../electronBridge");

let mockTestCoins = true;
jest.mock("../../../utils/swarmNetwork", () => ({
  ...jest.requireActual("../../../utils/swarmNetwork"),
  get SWARM_COINS_ARE_TEST_COINS() {
    return mockTestCoins;
  },
}));

function renderOverview() {
  return render(
    <ContextAppProvider value={defaultAppState}>
      <MemoryRouter>
        <OverviewScreen />
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
