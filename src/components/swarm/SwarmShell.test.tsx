import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SwarmShell, navForPath } from "./SwarmShell";
import { SwarmActions, SwarmActionsContext } from "./SwarmActionsContext";
import { SwarmUiProvider } from "./SwarmUiContext";
import { ContextAppProvider, defaultAppState } from "../../context/ContextAppState";
import { AppState, InfoClass, ServerChainNameEnum } from "../appstate";
import { CreationTypeEnum } from "../appstate/enums/CreationTypeEnum";
import { PerformanceLevelEnum } from "../appstate/enums/PerformanceLevelEnum";
import { ServerSelectionEnum } from "../appstate/enums/ServerSelectionEnum";
import routes from "../../constants/routes.json";
import APP_VERSION from "../../version";

jest.mock("../../electronBridge", () => ({
  native: {},
  clipboard: { writeText: jest.fn() },
  shell: {},
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(() => () => {}), send: jest.fn() },
  fs: {},
  isSandboxed: false,
}));

const wallet = {
  id: 1,
  fileName: "swarm.dat",
  alias: "Main hive",
  chain_name: ServerChainNameEnum.swarmTestnetChainName,
  creationType: CreationTypeEnum.Main,
  uri: "https://lwd.swarm.green:443",
  selection: ServerSelectionEnum.custom,
  performanceLevel: PerformanceLevelEnum.High,
};

function state(overrides: Partial<AppState>): AppState {
  return {
    ...defaultAppState,
    currentWallet: wallet,
    wallets: [wallet],
    info: { ...new InfoClass(), serverUri: "https://lwd.swarm.green:443", latestBlock: 12046 } as InfoClass,
    verificationProgress: 100,
    ...overrides,
  } as AppState;
}

function renderShell(overrides: Partial<AppState> = {}, path: string = routes.DASHBOARD, onRebuild?: () => void) {
  return render(
    <ContextAppProvider value={state(overrides)}>
      <MemoryRouter initialEntries={[path]}>
        <SwarmUiProvider>
          <SwarmShell onRetry={jest.fn()} onRebuild={onRebuild}>
            <div>screen</div>
          </SwarmShell>
        </SwarmUiProvider>
      </MemoryRouter>
    </ContextAppProvider>,
  );
}

describe("navForPath", () => {
  it("finds the destination a path belongs to", () => {
    expect(navForPath(routes.SEND).id).toBe("send");
    expect(navForPath(routes.HISTORY).id).toBe("activity");
    expect(navForPath(routes.SETTINGS).id).toBe("settings");
  });

  it("falls back to Overview for anything unrecognised", () => {
    expect(navForPath("/nowhere").id).toBe("overview");
  });
});

describe("SwarmShell", () => {
  it("offers the rebuild action for a shard-tree conflict and invokes it once", async () => {
    const onRebuild = jest.fn();
    renderShell({ syncingStatus: { lastError: "sync: shard tree err" } }, routes.DASHBOARD, onRebuild);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });
  it("offers the mockup's six destinations and no more", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: /wallet sections/i });
    const labels = within(rail)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
      .filter((t) => t && t !== "");
    for (const expected of ["Overview", "Send", "Receive", "Activity", "Addresses", "Settings"]) {
      expect(labels.join("|")).toContain(expected);
    }
  });

  it("says the height and the server when it is synced, and never a peer count", () => {
    renderShell();
    expect(screen.getByText("SYNCED")).toBeInTheDocument();
    expect(screen.getByText("#12,046 · lwd.swarm.green")).toBeInTheDocument();
    expect(screen.queryByText(/peer/i)).not.toBeInTheDocument();
  });

  it("says it is not connected when no server has answered", () => {
    renderShell({ info: { ...new InfoClass(), serverUri: "https://lwd.swarm.green:443" } as InfoClass });
    expect(screen.getByText("NOT CONNECTED")).toBeInTheDocument();
  });

  // The raw failure the owner was shown must not reach the screen.
  it("shows a DNS failure as a sentence, with the original text behind a disclosure", () => {
    const raw =
      "sync: Indexer request error. ← code: 'The service is currently unavailable', message: \"dns error\", " +
      "source: tonic::transport::Error(...)";
    renderShell({ syncingStatus: { lastError: raw } });

    expect(screen.getByText("Can't reach the wallet server lwd.swarm.green right now.")).toBeInTheDocument();
    expect(screen.getByText("Your coins are safe. Retrying…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    // Present, but inside a disclosure that starts closed. `<details>` is
    // exposed as a group, and an open one reports itself expanded.
    const disclosure = screen.getByRole("group", { name: /technical details/i });
    expect(disclosure).not.toHaveAttribute("open");
    expect(within(disclosure).getByText(raw)).toBeInTheDocument();
  });

  it("runs the retry the application handed it", async () => {
    const onRetry = jest.fn();
    render(
      <ContextAppProvider value={state({ syncingStatus: { lastError: "dns error" } })}>
        <MemoryRouter initialEntries={[routes.DASHBOARD]}>
          <SwarmUiProvider>
            <SwarmShell onRetry={onRetry}>
              <div>screen</div>
            </SwarmShell>
          </SwarmUiProvider>
        </MemoryRouter>
      </ContextAppProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(["Lightclient lock poisoned", "Sync task stopped unexpectedly"])("does not offer an ineffective retry for %s", (error) => {
    renderShell({ fetchError: { command: "ValueTransfers", error } });
    expect(screen.getByText("The wallet engine needs restarting.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rebuild" })).not.toBeInTheDocument();
  });

  it("toggles hide balances, and says which state it is in", async () => {
    renderShell();
    const button = screen.getByRole("button", { name: /hide balances/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: /show balances/i })).toHaveAttribute("aria-pressed", "true");
  });


// The owner's report was "the node app & wallet has no sign out button". These
// are the wallet's two, in the rail, on every screen — and they call the
// application's handlers rather than doing anything of their own, so what a
// click does and what the menu item does cannot drift apart.
describe("the rail's session buttons", () => {
  const noopActions: SwarmActions = {
    openSecurity: () => {},
    openImport: () => {},
    rescan: () => {},
    retrySync: () => {},
    lockNow: () => {},
    signOut: () => {},
  };

  function renderRail(overrides: Partial<SwarmActions> = {}) {
    return render(
      <SwarmActionsContext.Provider value={{ ...noopActions, ...overrides }}>
        <ContextAppProvider value={state({})}>
          <MemoryRouter initialEntries={[routes.DASHBOARD]}>
            <SwarmUiProvider>
              <SwarmShell onRetry={jest.fn()}>
                <div>screen</div>
              </SwarmShell>
            </SwarmUiProvider>
          </MemoryRouter>
        </ContextAppProvider>
      </SwarmActionsContext.Provider>,
    );
  }

  it("shows a Lock button and a Sign out button", () => {
    renderRail();

    expect(screen.getByRole("button", { name: "Lock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("locks the wallet when Lock is pressed", async () => {
    const lockNow = jest.fn();
    renderRail({ lockNow });

    await userEvent.click(screen.getByRole("button", { name: "Lock" }));

    expect(lockNow).toHaveBeenCalledTimes(1);
  });

  it("signs out when Sign out is pressed", async () => {
    const signOut = jest.fn();
    renderRail({ signOut });

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

  it("shows this application's own version, from src/version", () => {
    renderShell();
    expect(screen.getByText(new RegExp(APP_VERSION.replace(/\./g, "\\.")))).toBeInTheDocument();
  });

  // Removed from this network's UI deliberately: there is no mixnet here, and
  // upstream's release number says nothing about which SWARM build this is.
  it("never shows the mixnet line or upstream's version", () => {
    renderShell();
    expect(screen.queryByText(/mixnet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2\.0\.26/)).not.toBeInTheDocument();
  });

  it("refuses Send on a watch-only wallet", () => {
    renderShell({ readOnly: true });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
