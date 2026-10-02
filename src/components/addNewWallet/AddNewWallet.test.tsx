import React from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "../../test-utils";
import AddNewWallet from "./AddNewWallet";
import { ipcRenderer, native } from "../../electronBridge";
import fetchServerList from "../../utils/fetchServerList";
import { CreationTypeEnum, ServerChainNameEnum } from "../appstate";
import { SwapStore, readCurrentWalletFingerprint } from "../../swap";
import { useSwapService } from "../../context/ContextSwapService";
import selectFastestServer from "../../utils/selectFastestServer";
import { SWARM_NO_AUTOMATIC_REASON, SWARM_SERVER_PRESETS, swarmDefaultServerFor } from "../../utils/swarmNetwork";
import { SWARM_MAINNET_PROFILE } from "../../utils/networkProfiles";

// The testnet build's create screen, which offers both SWARM networks and all
// their presets — pinned, because a mainnet CI run writes `swarm-mainnet` into
// src/buildProfile.json before any test runs, and a mainnet build offers
// SWARM Mainnet alone (0.1.0-mainnet.6). That build's screen is rendered, and
// a wallet created on it, in src/mainnetWording.test.tsx.
jest.mock("../../buildProfile.json", () => ({
  ...jest.requireActual("../../buildProfile.json"),
  profile: "swarm-testnet",
}));
jest.mock("../../electronBridge");
jest.mock("../../utils/fetchServerList");
jest.mock("../../rpc/rpc", () => ({ __esModule: true, default: { deinitialize: jest.fn() } }));
// Named rather than automocked: the delete flow only reaches `clearForWallet`
// and the fingerprint read, and a factory keeps the real store — with its
// module-level wallet binding — out of the test entirely.
jest.mock("../../swap", () => ({
  SwapStore: { clearForWallet: jest.fn() },
  readCurrentWalletFingerprint: jest.fn(),
  createSwapService: jest.fn(),
  swapRecordToValueTransfer: jest.fn(),
}));
jest.mock("../../context/ContextSwapService", () => ({ useSwapService: jest.fn() }));
// Kept as a named factory so `RACE_CANDIDATES` survives: automocking it would
// make the constant undefined, and `slice(0, undefined)` is an empty list.
jest.mock("../../utils/selectFastestServer", () => ({
  __esModule: true,
  default: jest.fn(),
  RACE_CANDIDATES: 3,
}));

const mockSettings = { serveruri: "", serverchain_name: "main", serverselection: "" };

const liveList = fetchServerList as jest.MockedFunction<typeof fetchServerList>;

const probe = selectFastestServer as jest.MockedFunction<typeof selectFastestServer>;

beforeEach(() => {
  (ipcRenderer.invoke as jest.Mock).mockResolvedValue(mockSettings);
  probe.mockReset().mockImplementation(async (servers) => servers[0] ?? null);
  liveList.mockReset().mockResolvedValue([]);
  (useSwapService as jest.Mock).mockReturnValue(null);
  (SwapStore.clearForWallet as jest.Mock).mockResolvedValue(undefined);
  (readCurrentWalletFingerprint as jest.Mock).mockResolvedValue(FINGERPRINT);
  (native.wallet_exists as jest.Mock).mockResolvedValue(true);
  (native.stop_sync as jest.Mock).mockResolvedValue("ok");
  (native.delete_wallet as jest.Mock).mockResolvedValue("ok");
});

const FINGERPRINT = "ufvktail16charss";

const baseProps = {
  closeModal: jest.fn(),
  setWallets: jest.fn(),
  setCurrentWallet: jest.fn(),
  navigateToLoadingScreenChangingWallet: jest.fn(),
  doSaveWallet: jest.fn(),
  clearTimers: jest.fn().mockResolvedValue(undefined),
};

describe("AddNewWallet modes", () => {
  it('shows "Add a New Wallet" heading in addnew mode', () => {
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet" });
    expect(screen.getByText("Add a New Wallet")).toBeInTheDocument();
  });

  it('shows "Create Wallet" action button in addnew mode', () => {
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet" });
    expect(screen.getByRole("button", { name: /create wallet/i })).toBeInTheDocument();
  });

  it('shows "Wallet Settings" heading in settings mode', () => {
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: "/addnewwallet",
      contextOverrides: { currentWallet: { wallet_name: "test.dat", chain_name: "main" } as never },
    });
    // Navigate with settings state — use MemoryRouter initialEntries
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "settings" } } as never,
    });
    expect(screen.getAllByText("Wallet Settings").length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Delete Wallet" heading in delete mode', () => {
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "delete" } } as never,
    });
    expect(screen.getAllByText("Delete Wallet").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Cancel button before action button", () => {
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet" });
    const buttons = screen.getAllByRole("button");
    const cancelIdx = buttons.findIndex((b) => /^cancel$/i.test(b.textContent ?? ""));
    const actionIdx = buttons.findIndex((b) => /create wallet/i.test(b.textContent ?? ""));
    expect(cancelIdx).toBeLessThan(actionIdx);
  });
});

describe("AddNewWallet offers SWARM's networks and nothing else", () => {
  // The whole of this describe replaces three tests that asserted upstream
  // Zcash's server picker worked. It did work, and that was the defect: on
  // 2026-09-26 an owner picked "Mainnet", took a server off that list, pressed
  // Create and got a real Zcash mainnet wallet with a `u1…` receive address.
  const openServerBlock = async () => fireEvent.click((await screen.findAllByText("Selected Server"))[0]);

  const openScreen = async () => {
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet" });
    await openServerBlock();
  };

  it("offers the two SWARM networks in the Network picker, and no Zcash chain", async () => {
    await openScreen();
    const network = screen.getByRole("combobox", { name: /network/i });

    expect(within(network).getByRole("option", { name: "SWARM Mainnet" })).toBeInTheDocument();
    expect(within(network).getByRole("option", { name: /SWARM Testnet/ })).toBeInTheDocument();
    const values = within(network)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== "");
    expect(values.sort()).toEqual(["swarm-mainnet", "swarm-testnet"]);
  });

  it("has no upstream server list at all", async () => {
    await openScreen();

    expect(screen.queryByLabelText("Server list")).toBeNull();
    expect(screen.queryByRole("radio", { name: "From the list" })).toBeNull();
  });

  it("never asks the public lightwalletd registry for anything", async () => {
    await openScreen();

    await screen.findByLabelText("Custom server URI");
    expect(liveList).not.toHaveBeenCalled();
  });

  it("offers no endpoint belonging to upstream Zcash", async () => {
    await openScreen();
    const presets = await screen.findByRole("combobox", { name: /swarm server/i });

    for (const option of within(presets).getAllByRole("option")) {
      expect((option as HTMLOptionElement).value).not.toMatch(/zec\.rocks|lightwalletd\.com|zcash-infra\.com/i);
    }
  });
});

describe("AddNewWallet never offers Automatic", () => {
  // Automatic resolves through the public registry, which has nothing for
  // either SWARM network by design. It used to be offered on upstream's chains
  // — the chains that are gone — so there is nowhere left for it to appear.
  it("offers no Automatic radio and says why", async () => {
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet" });
    fireEvent.click((await screen.findAllByText("Selected Server"))[0]);

    expect(screen.queryByRole("radio", { name: "Automatic" })).toBeNull();
    expect(await screen.findByText(SWARM_NO_AUTOMATIC_REASON)).toBeInTheDocument();
  });
});

// Defect W-1. On the project chain "Automatic" resolves through the public
// lightwalletd registry, which answers nothing for it by design, so the radio
// the screen used to open on led to "No server could be reached for
// swarm-testnet". The project endpoint was only ever filled in by the Network
// dropdown's onChange, which a fresh profile with the chain already stored
// never passes through.
describe("AddNewWallet on the project chain", () => {
  const SWARM = ServerChainNameEnum.swarmTestnetChainName;
  const OWN_NODE = "http://127.0.0.1:9067";
  const MAINNET_SERVER = "https://lwd-main.swarm.green:443";
  // This chain's own default, not the build's: the same source file is
  // packaged twice and `SWARM_SERVER` is the mainnet indexer in the
  // mainnet package.
  const SWARM_SERVER = swarmDefaultServerFor(SWARM);

  /** A profile whose stored chain is the project's, as a fresh install has. */
  const storedSettings = (overrides: Partial<typeof mockSettings> = {}) =>
    (ipcRenderer.invoke as jest.Mock).mockResolvedValue({
      serveruri: "",
      serverchain_name: SWARM,
      serverselection: "auto",
      ...overrides,
    });

  const openServerBlock = async () => fireEvent.click((await screen.findAllByText("Selected Server"))[0]);

  const mount = async (state?: { mode: string }) => {
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: (state ? { pathname: "/addnewwallet", state } : "/addnewwallet") as never,
      ...(state?.mode === "settings"
        ? {
            contextOverrides: {
              currentWallet: {
                id: 4,
                alias: "Mine",
                fileName: "w.dat",
                chain_name: SWARM,
                uri: OWN_NODE,
                selection: "custom",
              } as never,
            },
          }
        : {}),
    });
    await openServerBlock();
  };

  it("opens with the project endpoint already chosen, not on Automatic", async () => {
    storedSettings();
    await mount();

    expect(await screen.findByLabelText("Custom server URI")).toHaveValue(SWARM_SERVER);
    expect(screen.getByLabelText("Custom server URI")).toBeEnabled();
  });

  it("waits for polling to stop before native creation resets the active wallet", async () => {
    storedSettings();
    (native.wallet_exists as jest.Mock).mockResolvedValue(false);
    let stop!: () => void;
    baseProps.clearTimers.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        stop = resolve;
      }),
    );
    // Leave native creation pending so this test cannot generate a real wallet.
    (native.init_new as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /create wallet/i }));
    await waitFor(() => expect(baseProps.clearTimers).toHaveBeenCalled());
    expect(native.init_new).not.toHaveBeenCalled();
    stop();
    await waitFor(() => expect(native.init_new).toHaveBeenCalledTimes(1));
  });

  it("does not offer Automatic, and says why", async () => {
    storedSettings();
    await mount();

    expect(screen.queryByRole("radio", { name: "Automatic" })).toBeNull();
    expect(await screen.findByText(SWARM_NO_AUTOMATIC_REASON)).toBeInTheDocument();
  });

  it("never asks the public server registry about this chain", async () => {
    storedSettings();
    await mount();

    await waitFor(() => expect(screen.getByLabelText("Custom server URI")).toHaveValue(SWARM_SERVER));
    expect(liveList).not.toHaveBeenCalledWith(SWARM);
  });

  it("fills the endpoint when the network is picked from the dropdown", async () => {
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet" });
    await openServerBlock();

    fireEvent.change(screen.getByRole("combobox", { name: /network/i }), { target: { value: SWARM } });

    expect(await screen.findByLabelText("Custom server URI")).toHaveValue(SWARM_SERVER);
    expect(screen.queryByRole("radio", { name: "Automatic" })).toBeNull();
  });

  it("keeps the endpoint chosen through every wallet creation type", async () => {
    storedSettings();
    await mount();

    for (const type of ["new", "seed", "ufvk", "file"]) {
      fireEvent.change(screen.getByRole("combobox", { name: /type of wallet creation/i }), {
        target: { value: type },
      });
      expect(await screen.findByLabelText("Custom server URI")).toHaveValue(SWARM_SERVER);
      expect(screen.queryByRole("radio", { name: "Automatic" })).toBeNull();
    }
  });

  it("holds the same rule on the change-server screen", async () => {
    storedSettings({ serveruri: OWN_NODE, serverselection: "custom" });
    await mount({ mode: "settings" });

    expect(await screen.findByLabelText("Custom server URI")).toHaveValue(OWN_NODE);
    expect(screen.queryByRole("radio", { name: "Automatic" })).toBeNull();
  });

  // Adding a second wallet while one is already open: the screen must inherit
  // the open wallet's chain and server, not fall back to public testnet.
  it("adds a second wallet on the same chain and server as the one already open", async () => {
    storedSettings({ serveruri: OWN_NODE, serverselection: "custom" });
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: "/addnewwallet",
      contextOverrides: {
        currentWallet: {
          id: 4,
          alias: "Mining",
          fileName: "w.dat",
          chain_name: SWARM,
          uri: OWN_NODE,
          selection: "custom",
        } as never,
      },
    });
    await openServerBlock();

    expect(screen.getByRole("combobox", { name: /network/i })).toHaveValue(SWARM);
    expect(await screen.findByLabelText("Custom server URI")).toHaveValue(OWN_NODE);
    expect(screen.queryByRole("radio", { name: "Automatic" })).toBeNull();
  });

  it("offers every SWARM preset and still takes a typed one", async () => {
    storedSettings();
    await mount();

    const presets = await screen.findByRole("combobox", { name: /swarm server/i });
    for (const preset of SWARM_SERVER_PRESETS) {
      expect(within(presets).getByRole("option", { name: `${preset.label} — ${preset.uri}` })).toBeInTheDocument();
    }

    fireEvent.change(presets, { target: { value: OWN_NODE } });
    expect(await screen.findByLabelText("Custom server URI")).toHaveValue(OWN_NODE);

    fireEvent.change(screen.getByLabelText("Custom server URI"), { target: { value: "http://127.0.0.1:1234" } });
    expect(screen.getByLabelText("Custom server URI")).toHaveValue("http://127.0.0.1:1234");
  });

  // The defect the mainnet release of 2026-09-26 shipped with: no mainnet
  // preset at all, so the only way onto the live network was to type the
  // address, and touching the dropdown put the wallet back on the testnet.
  it("puts a mainnet wallet on the mainnet indexer, and builds it on the mainnet chain", async () => {
    storedSettings();
    (native.wallet_exists as jest.Mock).mockResolvedValue(false);
    (native.init_new as jest.Mock).mockResolvedValue('{"seed":"x"}');
    (native.info_server as jest.Mock).mockResolvedValue(
      JSON.stringify({ chain_name: "swarm-mainnet", server_uri: MAINNET_SERVER }),
    );
    await mount();

    fireEvent.change(await screen.findByRole("combobox", { name: /swarm server/i }), {
      target: { value: MAINNET_SERVER },
    });

    await waitFor(() => expect(screen.getByLabelText("Custom server URI")).toHaveValue(MAINNET_SERVER));
    expect(screen.getByRole("combobox", { name: /network/i })).toHaveValue("swarm-mainnet");

    fireEvent.click(screen.getByRole("button", { name: /create wallet/i }));

    // The chain hint is the single string that decides the ChainType, and so
    // decides whether the first address is `swm1…` or something else entirely.
    // It is NOT the bare label: `ChainType::SwarmMainnet` carries the genesis
    // and the SDK gives it no default, so 0.1.0-mainnet.1 — which sent
    // "swarm-mainnet" — could not create a wallet at all.
    await waitFor(() => expect(native.init_new).toHaveBeenCalled());
    expect((native.init_new as jest.Mock).mock.calls[0][1]).toBe(
      `swarm-mainnet:${SWARM_MAINNET_PROFILE.genesis}`,
    );
    expect((native.init_new as jest.Mock).mock.calls[0][0]).toBe(MAINNET_SERVER);
    // And the same hint had to reach the call that runs first, which is where
    // the owner met the error.
    expect((native.wallet_exists as jest.Mock).mock.calls[0][1]).toBe(
      `swarm-mainnet:${SWARM_MAINNET_PROFILE.genesis}`,
    );
    // The record names the restarted chain, so the wallet is never mistaken
    // for one made before the restart of 2 October 2026 and moved again.
    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        "wallets:add",
        expect.objectContaining({
          chain_name: "swarm-mainnet",
          uri: MAINNET_SERVER,
          genesis: "01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2",
        }),
      ),
    );
  });

  it("builds a testnet wallet on the testnet chain", async () => {
    storedSettings();
    (native.wallet_exists as jest.Mock).mockResolvedValue(false);
    (native.init_new as jest.Mock).mockResolvedValue('{"seed":"x"}');
    (native.info_server as jest.Mock).mockResolvedValue(
      JSON.stringify({ chain_name: "swarm-testnet", server_uri: SWARM_SERVER }),
    );
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /create wallet/i }));

    await waitFor(() => expect(native.init_new).toHaveBeenCalled());
    expect((native.init_new as jest.Mock).mock.calls[0][1]).toBe("swarm-testnet");
    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith("wallets:add", expect.objectContaining({ chain_name: "swarm-testnet" })),
    );
    const added = (ipcRenderer.invoke as jest.Mock).mock.calls.find(([channel]) => channel === "wallets:add")[1];
    expect(added.genesis).toBeUndefined();
  });

  // "Another server" takes anything, so the chain the server reports is checked
  // against the chain the wallet was built for, and a mismatch throws the
  // wallet away rather than registering it.
  it("refuses a typed server that serves another chain, and registers nothing", async () => {
    storedSettings();
    (native.wallet_exists as jest.Mock).mockResolvedValue(false);
    (native.init_new as jest.Mock).mockResolvedValue('{"seed":"x"}');
    (native.info_server as jest.Mock).mockResolvedValue(
      JSON.stringify({ chain_name: "main", server_uri: "https://zec.rocks:443" }),
    );
    const openErrorModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, { initialRoute: "/addnewwallet", contextOverrides: { openErrorModal } });
    fireEvent.click((await screen.findAllByText("Selected Server"))[0]);
    await screen.findByLabelText("Custom server URI");

    fireEvent.click(screen.getByRole("button", { name: /create wallet/i }));

    await waitFor(() => expect(openErrorModal).toHaveBeenCalled());
    const said = openErrorModal.mock.calls.map((call) => call[1]).join(" ");
    expect(said).toContain("The wallet was not created.");
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith("wallets:add", expect.anything());
  });

  // A server that does not answer is a sentence naming the host, not a
  // transport error and not a claim about why.
  it("says which host it cannot reach rather than failing at the transport", async () => {
    storedSettings();
    const openErrorModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: "/addnewwallet",
      contextOverrides: { openErrorModal },
    });
    expect(await screen.findByText(SWARM_SERVER)).toBeInTheDocument();
    probe.mockResolvedValue(null);

    fireEvent.click(screen.getByRole("button", { name: /create wallet/i }));

    await waitFor(() => expect(openErrorModal).toHaveBeenCalled());
    const said = openErrorModal.mock.calls.map((call) => call[1]).join(" ");
    expect(said).toContain("keeps retrying");
    expect(said).toContain("lwd.swarm.green");
    // Creation never started: naming the next wallet file is its first step.
    expect(native.wallet_exists).not.toHaveBeenCalled();
  });
});

describe("AddNewWallet delete confirmation", () => {
  const wallet = {
    id: 1,
    alias: "Savings",
    fileName: "zingo-wallet.dat",
    chain_name: ServerChainNameEnum.mainChainName,
  } as never;

  // Deleting removes the wallet file, and until now the only thing between a
  // click and that was the screen the button sits on. The in-flight-swap
  // confirmation existed, but only when a swap was in flight.
  it("asks before deleting, naming the wallet", async () => {
    const openConfirmModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "delete" } } as never,
      contextOverrides: { currentWallet: wallet, openConfirmModal },
    });

    fireEvent.click(screen.getByRole("button", { name: /^delete wallet$/i }));

    await waitFor(() => expect(openConfirmModal).toHaveBeenCalled());
    expect(openConfirmModal.mock.calls[0][1]).toContain("Savings");
  });

  // The confirmation is a question, so declining it has to leave the wallet
  // alone — the action only runs from the callback the modal invokes.
  it("does nothing until the confirmation is accepted", async () => {
    const openConfirmModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "delete" } } as never,
      contextOverrides: { currentWallet: wallet, openConfirmModal },
    });

    fireEvent.click(screen.getByRole("button", { name: /^delete wallet$/i }));

    await waitFor(() => expect(openConfirmModal).toHaveBeenCalled());
    expect(baseProps.clearTimers).not.toHaveBeenCalled();
  });
});

describe("AddNewWallet delete and swap records", () => {
  const walletOfType = (creationType: CreationTypeEnum) =>
    ({
      id: 1,
      alias: "Savings",
      fileName: "zingo-wallet.dat",
      uri: "https://mainnet.example:443",
      chain_name: ServerChainNameEnum.mainChainName,
      creationType,
    }) as never;

  /** Open the delete screen, click through, and accept the confirmation. */
  const confirmDelete = async (creationType: CreationTypeEnum) => {
    const openConfirmModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "delete" } } as never,
      contextOverrides: { currentWallet: walletOfType(creationType), openConfirmModal },
    });

    fireEvent.click(screen.getByRole("button", { name: /^delete wallet$/i }));
    await waitFor(() => expect(openConfirmModal).toHaveBeenCalled());
    // The modal's accept callback is what actually deletes.
    openConfirmModal.mock.calls[0][2]();
    return openConfirmModal;
  };

  // The wallet file goes, so the records that describe swaps made from it have
  // nothing left to belong to.
  it("clears the swap bucket when the wallet file is deleted with the wallet", async () => {
    await confirmDelete(CreationTypeEnum.Seed);

    await waitFor(() => expect(SwapStore.clearForWallet).toHaveBeenCalledWith(FINGERPRINT));
    await waitFor(() => expect(native.delete_wallet).toHaveBeenCalled());
  });

  // A wallet opened from an existing .DAT is not destroyed by this flow — the
  // file stays put and can be opened again. Clearing the bucket would leave
  // that reopened wallet with an empty history for a delete that only ever
  // removed a list entry, so the records stay with the file.
  it("keeps the swap bucket when the wallet was opened from a file left on disk", async () => {
    await confirmDelete(CreationTypeEnum.File);

    await waitFor(() => expect(baseProps.setCurrentWallet).toHaveBeenCalledWith(null));
    expect(SwapStore.clearForWallet).not.toHaveBeenCalled();
    expect(native.delete_wallet).not.toHaveBeenCalled();
  });

  // The in-flight warning tells the user what they lose. For a file-backed
  // wallet that is the tracking, not the record, and saying otherwise would
  // send someone hunting for a seed phrase they do not need.
  it("warns that a file-backed wallet keeps its in-flight swap record", async () => {
    (useSwapService as jest.Mock).mockReturnValue({ hasInflightDeposits: jest.fn().mockResolvedValue(true) });
    const openConfirmModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "delete" } } as never,
      contextOverrides: { currentWallet: walletOfType(CreationTypeEnum.File), openConfirmModal },
    });

    fireEvent.click(screen.getByRole("button", { name: /^delete wallet$/i }));

    await waitFor(() => expect(openConfirmModal).toHaveBeenCalled());
    const body: string = openConfirmModal.mock.calls[0][1];
    expect(body).toContain("open the file again");
    expect(body).not.toContain("seed phrase");
  });

  // The same warning for every other wallet keeps saying what it said.
  it("warns that a seed-backed wallet loses its in-flight swap record", async () => {
    (useSwapService as jest.Mock).mockReturnValue({ hasInflightDeposits: jest.fn().mockResolvedValue(true) });
    const openConfirmModal = jest.fn();
    render(<AddNewWallet {...baseProps} />, {
      initialRoute: { pathname: "/addnewwallet", state: { mode: "delete" } } as never,
      contextOverrides: { currentWallet: walletOfType(CreationTypeEnum.Seed), openConfirmModal },
    });

    fireEvent.click(screen.getByRole("button", { name: /^delete wallet$/i }));

    await waitFor(() => expect(openConfirmModal).toHaveBeenCalled());
    expect(openConfirmModal.mock.calls[0][1]).toContain("removes the record that tracks it");
  });
});
