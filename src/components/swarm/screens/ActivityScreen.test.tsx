import React from "react";
import { render, screen } from "@testing-library/react";
import { ActivityScreen } from "./ActivityScreen";
import { SwarmUiProvider } from "../SwarmUiContext";
import { ContextAppProvider, defaultAppState } from "../../../context/ContextAppState";

jest.mock("../../../electronBridge", () => ({
  native: {}, clipboard: { writeText: jest.fn() }, shell: {},
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(() => () => {}), send: jest.fn() },
  fs: {}, isSandboxed: false,
}));

it("does not call a failed history read zero transfers", () => {
  render(
    <ContextAppProvider value={{ ...defaultAppState, fetchError: {
      command: "ValueTransfers", error: "Lightclient lock poisoned",
    } }}>
      <SwarmUiProvider><ActivityScreen /></SwarmUiProvider>
    </ContextAppProvider>,
  );
  expect(screen.getByText("History unavailable")).toBeInTheDocument();
  expect(screen.queryByText("0 transfers")).not.toBeInTheDocument();
  expect(screen.queryByText(/Nothing yet/)).not.toBeInTheDocument();
  expect(screen.getByText(/does not mean the wallet has no transfers/)).toBeInTheDocument();
});
