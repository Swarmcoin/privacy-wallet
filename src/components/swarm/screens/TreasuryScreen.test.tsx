/**
 * Starting a payout, through the screen rather than the machine.
 *
 * Up to 0.1.0-mainnet.5, "New payout from Core" pressed straight from the
 * Funds tab waited for ever on "asking the indexer what this fund holds".
 * `chooseFund` handed the fund to `loadBalance`, which only fed the payout
 * when `payout.fund` named that fund — and `payout` was the one in its
 * closure, from the render before the click, when the payout had no fund.
 * The indexer answered, the answer was dropped, and "Build the proposal"
 * never came alive. An indexer error was dropped the same way. Only pressing
 * Refresh first hid it, which is what every manual run happened to do.
 *
 * `treasuryMachine.test.ts` could not see it: the reducer was right, the
 * event was simply never sent. So these tests go through the screen.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextAppProvider, defaultAppState } from "../../../context/ContextAppState";
import { AppState, InfoClass, ServerChainNameEnum } from "../../appstate";
import { CreationTypeEnum } from "../../appstate/enums/CreationTypeEnum";
import { PerformanceLevelEnum } from "../../appstate/enums/PerformanceLevelEnum";
import { ServerSelectionEnum } from "../../appstate/enums/ServerSelectionEnum";
import * as treasury from "../../../treasury/treasuryService";
import type { LoadedFund } from "../../../treasury/treasuryService";
import type { TreasuryUtxoSet } from "../../../treasury/selectUtxos";
import { TreasuryScreen } from "./TreasuryScreen";

jest.mock("../../../electronBridge");
jest.mock("../../../treasury/treasuryService", () => ({
  ...jest.requireActual("../../../treasury/treasuryService"),
  loadFunds: jest.fn(),
  listSigners: jest.fn(),
  loadFundUtxos: jest.fn(),
}));

const mocked = treasury as jest.Mocked<typeof treasury>;

const SERVER = "https://lwd-main.swarm.green:8443";

const wallet = {
  id: 7,
  fileName: "zingo-wallet-7.dat",
  alias: "Coordinator",
  chain_name: ServerChainNameEnum.swarmMainnetChainName,
  creationType: CreationTypeEnum.Seed,
  uri: SERVER,
  selection: ServerSelectionEnum.custom,
  performanceLevel: PerformanceLevelEnum.Medium,
};

function fund(name: string, address: string, fingerprint: string): LoadedFund {
  return {
    name,
    policyJson: "{}",
    fingerprint,
    address,
    threshold: 2,
    signerFingerprints: ["a5eb896d276f19ce", "f09232728bf931f2", "afc5719115ca6481"],
    fileSha256: "0".repeat(64),
    lockScript: "a914" + "00".repeat(20) + "87",
    network: "swarmmain",
  };
}

const core = fund("Core", "s3fLmEHc1xqs8KAe7QS7oupkhuGDjidV4eq", "c4eb50cf30afb64d56c31c8e3a0a1753");
const grants = fund("Grants", "s3RiGvK5JzS8eh6ywN3K22f2LzDAhicgFuq", "db42c64fbe365bd6558f77dbd633545f");

function holdings(of: LoadedFund, zat: number): TreasuryUtxoSet {
  return {
    address: of.address,
    chain_height: 5000,
    coinbase_maturity: 100,
    mature_total: zat,
    immature_total: 0,
    utxos: [
      {
        txid: "1".repeat(64),
        vout: 0,
        value: zat,
        height: 1000,
        is_coinbase: true,
        script: of.lockScript,
        confirmations: 4001,
        mature: true,
      },
    ],
    truncated: false,
  };
}

function renderTreasury() {
  const state = {
    ...defaultAppState,
    currentWallet: wallet,
    wallets: [wallet],
    info: { ...new InfoClass(), serverUri: SERVER, latestBlock: 5000 } as InfoClass,
  } as AppState;
  return render(
    <ContextAppProvider value={state}>
      <TreasuryScreen />
    </ContextAppProvider>,
  );
}

const WAITING = /asking the indexer what this fund holds/;

beforeEach(() => {
  mocked.loadFunds.mockResolvedValue({ funds: [core, grants], problems: [] });
  mocked.listSigners.mockResolvedValue([]);
});

describe("TreasuryScreen, starting a payout", () => {
  it("hands the fund's outputs to the payout when it is started straight from the Funds tab", async () => {
    mocked.loadFundUtxos.mockResolvedValue(holdings(core, 5_000_000_000));
    renderTreasury();

    // No Refresh first: the balance is still "not asked yet".
    await userEvent.click(await screen.findByRole("button", { name: "New payout from Core" }));

    expect(mocked.loadFundUtxos).toHaveBeenCalledWith(SERVER, core);
    await waitFor(() => expect(screen.queryByText(WAITING)).not.toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/At least how much/), "10");
    expect(screen.getByRole("button", { name: "Build the proposal" })).toBeEnabled();
  });

  it("says why when the indexer cannot be asked, instead of waiting for ever", async () => {
    mocked.loadFundUtxos.mockRejectedValue(new Error("transport error"));
    renderTreasury();

    await userEvent.click(await screen.findByRole("button", { name: "New payout from Core" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("transport error");
    expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  });

  it("uses what the Funds tab already knows without asking again", async () => {
    mocked.loadFundUtxos.mockResolvedValue(holdings(core, 5_000_000_000));
    renderTreasury();

    const [refreshCore] = await screen.findAllByRole("button", { name: "Refresh" });
    await userEvent.click(refreshCore);
    await screen.findByText(/50\.00000000 mature/);
    await userEvent.click(screen.getByRole("button", { name: "New payout from Core" }));

    expect(mocked.loadFundUtxos).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText(/At least how much/), "10");
    expect(screen.getByRole("button", { name: "Build the proposal" })).toBeEnabled();
  });

  it("drops a late answer for a fund the payout has already left", async () => {
    let answerCore: (set: TreasuryUtxoSet) => void = () => {};
    mocked.loadFundUtxos.mockImplementation((_server, asked) =>
      asked.name === "Core"
        ? new Promise<TreasuryUtxoSet>((resolve) => {
            answerCore = resolve;
          })
        : Promise.resolve(holdings(grants, 300_000_000)),
    );
    renderTreasury();

    await userEvent.click(await screen.findByRole("button", { name: "New payout from Core" }));
    await userEvent.click(screen.getByRole("tab", { name: "Funds" }));
    await userEvent.click(screen.getByRole("button", { name: "New payout from Grants" }));
    await waitFor(() => expect(screen.queryByText(WAITING)).not.toBeInTheDocument());

    answerCore(holdings(core, 5_000_000_000));

    // Grants holds 3 SWM; had Core's late 50 SWM landed, 10 would be payable.
    await userEvent.type(screen.getByLabelText(/At least how much/), "10");
    expect(await screen.findByRole("alert")).toHaveTextContent("The most this fund can pay right now is 300000000 zat");
    expect(screen.getByRole("button", { name: "Build the proposal" })).toBeDisabled();
  });
});

describe("TreasuryScreen, a fund with more outputs than it loads", () => {
  it("says on the Funds tab that it shows the oldest 200 of N", async () => {
    const cut: TreasuryUtxoSet = { ...holdings(core, 200 * 500_000_000), truncated: true, total_outputs: 555, total_value: 555 * 500_000_000, loaded_limit: 200 };
    mocked.loadFundUtxos.mockResolvedValue(cut);
    renderTreasury();
    const refresh = (await screen.findAllByRole("button", { name: "Refresh" }))[0];
    await userEvent.click(refresh);
    expect(
      await screen.findByText("Showing the oldest 200 of 555 outputs; a payout can spend at most 200 in one go."),
    ).toBeInTheDocument();
  });
});
