/**
 * A mainnet build never calls itself, or its coins, test.
 *
 * The owner's screenshots of 0.1.0-mainnet.5 on 2026-09-27: "test coins · no
 * market value" under a real balance, and address fields asking for
 * "swarm1…, utest1… or tm…" — SWARM Testnet's shapes — in the wallet whose
 * addresses are `swm1…` and `s1…`. Each sentence was right when it was
 * written, for the only network there was, and each survived because nothing
 * read the screens of the build that was not the default one: the repository's
 * own profile is `swarm-testnet`, so every other test renders the testnet.
 *
 * So this renders the screens a mainnet user can reach with the build profile
 * set to `swarm-mainnet` — the value `scripts/set-build-profile.js` writes on
 * a mainnet CI run — and reads everything a person can see: the text, and the
 * placeholder, title, aria-label and alt attributes. Comments are not read;
 * nobody sees them. The testnet build keeps its sentences, and
 * `swarmModel.test.ts` and the screen tests keep rendering those.
 */
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextAppProvider, defaultAppState } from "./context/ContextAppState";
import {
  AppState,
  InfoClass,
  ServerChainNameEnum,
  TotalBalanceClass,
  TransparentAddressClass,
  UnifiedAddressClass,
  ValueTransferClass,
} from "./components/appstate";
import { CreationTypeEnum } from "./components/appstate/enums/CreationTypeEnum";
import { PerformanceLevelEnum } from "./components/appstate/enums/PerformanceLevelEnum";
import { ServerSelectionEnum } from "./components/appstate/enums/ServerSelectionEnum";
import { ValueTransferKindEnum } from "./components/appstate/enums/ValueTransferKindEnum";
import { ValueTransferPoolEnum } from "./components/appstate/enums/ValueTransferPoolEnum";
import { ValueTransferStatusEnum } from "./components/appstate/enums/ValueTransferStatusEnum";
import { ipcRenderer, native } from "./electronBridge";
import {
  ACTIVE_SWARM_PROFILE,
  SWARM_COINS_ARE_TEST_COINS,
  addressPlaceholderFor,
  profilesForNewWallets,
  serverPresetsForNewWallets,
} from "./utils/swarmNetwork";
import { SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE } from "./utils/networkProfiles";

// The lock screen, the security and import modals read `window.electronAPI`
// as their modules load — the preload provides it in the application — so it
// has to exist before they are required, which a static import is too late
// for. It forwards to the mocked bridge, so one mock answers both.
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
const { SwarmUiProvider } = require("./components/swarm/SwarmUiContext");
const { SwarmShell } = require("./components/swarm/SwarmShell");
const { OverviewScreen } = require("./components/swarm/screens/OverviewScreen");
const { SendScreen } = require("./components/swarm/screens/SendScreen");
const { ReceiveScreen } = require("./components/swarm/screens/ReceiveScreen");
const { ActivityScreen } = require("./components/swarm/screens/ActivityScreen");
const { AddressesScreen } = require("./components/swarm/screens/AddressesScreen");
const { SettingsScreen } = require("./components/swarm/screens/SettingsScreen");
const { OnboardingScreen } = require("./components/swarm/screens/OnboardingScreen");
const AddNewWallet = require("./components/addNewWallet/AddNewWallet").default;
const BlockExplorerModal = require("./components/sideBar/components/BlockExplorerModal").default;
const LockScreen = require("./components/lockScreen/LockScreen").default;
/* eslint-enable @typescript-eslint/no-require-imports */

jest.mock("./buildProfile.json", () => ({
  ...jest.requireActual("./buildProfile.json"),
  profile: "swarm-mainnet",
}));
jest.mock("./electronBridge");
jest.mock("./utils/fetchServerList");
jest.mock("./rpc/rpc", () => ({ __esModule: true, default: { deinitialize: jest.fn() } }));
jest.mock("./swap", () => ({
  SwapStore: { clearForWallet: jest.fn() },
  readCurrentWalletFingerprint: jest.fn(),
  createSwapService: jest.fn(),
  swapRecordToValueTransfer: jest.fn(),
}));
jest.mock("./context/ContextSwapService", () => ({ useSwapService: jest.fn(() => null) }));
jest.mock("./utils/selectFastestServer", () => ({
  __esModule: true,
  default: jest.fn(async () => null),
  RACE_CANDIDATES: 3,
}));

/**
 * What a mainnet build may not say about itself or its coins.
 *
 * Words, not substrings, where a word is meant: "latest" and "attest" are not
 * "test". The address shapes are SWARM Testnet's and upstream testnet's; none
 * of them is a thing a mainnet user can pay.
 */
const FORBIDDEN: readonly RegExp[] = [
  /\btest\b/i,
  /testnet/i,
  /no value/i,
  /no market/i,
  /experiment/i,
  /may be wiped/i,
  /\butest/i,
  /\bswarm1/i,
  /\btm…/,
  /\btm\.\.\./,
  /\bt2…/,
  /textest/i,
];

const MAINNET_SERVER = "https://lwd-main.swarm.green:8443";

const wallet = {
  id: 4,
  fileName: "zingo-wallet-4.dat",
  alias: "Wallet 4",
  chain_name: ServerChainNameEnum.swarmMainnetChainName,
  creationType: CreationTypeEnum.Seed,
  uri: MAINNET_SERVER,
  selection: ServerSelectionEnum.custom,
  performanceLevel: PerformanceLevelEnum.High,
};

function transfer(partial: Partial<ValueTransferClass> & { isCoinbase?: boolean }): ValueTransferClass {
  return {
    type: ValueTransferKindEnum.received,
    confirmations: 12,
    blockheight: 1300,
    status: ValueTransferStatusEnum.confirmed,
    txid: `tx-${Math.random().toString(16).slice(2)}`,
    time: 1790000000,
    amount: 5,
    ...partial,
  } as ValueTransferClass;
}

/** A mainnet wallet with a little of everything to draw. */
function mainnetState(overrides: Partial<AppState> = {}): AppState {
  const unified = {
    encoded_address:
      "swm1q4q6yr3rvnnqw64tqktf7plq86cnmdxezv2g5wjerfpratclfv87guyfqru4vf775ykqd8q9e7uzscmns7w6q2fpxwl5up0ez5xqe5gv",
    has_orchard: true,
  } as UnifiedAddressClass;
  const transparent = { encoded_address: "s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk" } as TransparentAddressClass;
  const balance = {
    ...new TotalBalanceClass(),
    totalIronwoodBalance: 12,
    confirmedIronwoodBalance: 12,
    totalTransparentBalance: 5,
    confirmedTransparentBalance: 5,
    totalSpendableBalance: 12,
  } as TotalBalanceClass;
  return {
    ...defaultAppState,
    currentWallet: wallet,
    wallets: [wallet],
    info: { ...new InfoClass(), serverUri: MAINNET_SERVER, latestBlock: 1400, chainName: "swarm-mainnet" } as InfoClass,
    verificationProgress: 100,
    totalBalance: balance,
    addressesUnified: [unified],
    addressesTransparent: [transparent],
    valueTransfers: [
      transfer({ isCoinbase: true, blockheight: 1310 }),
      transfer({ isCoinbase: true, blockheight: 1316, status: ValueTransferStatusEnum.failed, confirmations: 0 }),
      transfer({ type: ValueTransferKindEnum.sent, amount: 1, address: "s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk" }),
      transfer({ amount: 2, poolsReceived: [ValueTransferPoolEnum.ironwood], memos: ["for the hive"] }),
    ],
    ...overrides,
  } as AppState;
}

function renderInApp(ui: React.ReactElement, state: AppState = mainnetState(), route = "/") {
  return render(
    <ContextAppProvider value={state}>
      <MemoryRouter initialEntries={[route]}>
        <SwarmUiProvider>{ui}</SwarmUiProvider>
      </MemoryRouter>
    </ContextAppProvider>,
  );
}

/** Everything on the page a person can read, one string per source. */
function visibleStrings(): string[] {
  const strings = [document.body.textContent ?? ""];
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    for (const attribute of ["placeholder", "title", "aria-label", "alt"]) {
      const value = element.getAttribute(attribute);
      if (value) strings.push(`[${attribute}] ${value}`);
    }
  }
  return strings;
}

/** Every forbidden word on the page, with the sentence around it. */
function testWording(): string[] {
  const found: string[] = [];
  for (const text of visibleStrings()) {
    for (const pattern of FORBIDDEN) {
      const match = pattern.exec(text);
      if (match) {
        const at = match.index;
        found.push(`${pattern}: …${text.slice(Math.max(0, at - 60), at + 60)}…`);
      }
    }
  }
  return found;
}

beforeEach(() => {
  (ipcRenderer.invoke as jest.Mock).mockImplementation(async (channel: string) => {
    if (channel === "loadSettings") {
      return { serveruri: MAINNET_SERVER, serverchain_name: "swarm-mainnet", serverselection: "custom" };
    }
    if (channel === "lock:status") return { hasCode: false };
    if (channel === "wallets:all") return [wallet];
    return undefined;
  });
  (ipcRenderer.on as jest.Mock).mockImplementation(() => () => {});
  (native.get_spendable_balance_with_address as jest.Mock).mockResolvedValue(JSON.stringify({ spendable_balance: 0 }));
  (native.parse_address as jest.Mock).mockResolvedValue(JSON.stringify({ status: "Invalid address" }));
  (native.wallet_exists as jest.Mock).mockResolvedValue(false);
});

afterEach(cleanup);

describe("the build this test renders", () => {
  it("is a mainnet build, the way a mainnet CI run writes the profile", () => {
    expect(ACTIVE_SWARM_PROFILE.id).toBe("swarm-mainnet");
    expect(SWARM_COINS_ARE_TEST_COINS).toBe(false);
  });

  it("still catches the sentences mainnet.5 shipped", () => {
    // If the scan cannot see these, a clean result means nothing.
    document.body.innerHTML = '<div>test coins · no market value</div><input placeholder="swarm1…, utest1… or tm…" />';
    expect(testWording().length).toBeGreaterThanOrEqual(4);
    document.body.innerHTML = "";
  });
});

describe("a mainnet build's screens say nothing about test coins or test networks", () => {
  it("Overview, inside the rail", () => {
    renderInApp(
      <SwarmShell onRetry={jest.fn()}>
        <OverviewScreen />
      </SwarmShell>,
    );
    // Nothing where the testnet says "test coins · no market value".
    expect(screen.getByText("TOTAL BALANCE")).toBeInTheDocument();
    expect(testWording()).toEqual([]);
  });

  it("Send", () => {
    renderInApp(<SendScreen sendTransaction={jest.fn()} setSendPageState={jest.fn()} />);
    expect(screen.getByPlaceholderText("swm1… or s1…")).toBeInTheDocument();
    expect(testWording()).toEqual([]);
  });

  it("Receive", () => {
    renderInApp(<ReceiveScreen />);
    expect(testWording()).toEqual([]);
  });

  it("Activity", () => {
    renderInApp(<ActivityScreen />);
    expect(testWording()).toEqual([]);
  });

  it("Addresses, with the new-contact form open", () => {
    renderInApp(<AddressesScreen addAddressBookEntry={jest.fn()} removeAddressBookEntry={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add contact/i }));
    expect(screen.getByPlaceholderText("swm1… or s1…")).toBeInTheDocument();
    expect(testWording()).toEqual([]);
  });

  it("Settings", () => {
    renderInApp(<SettingsScreen />);
    expect(testWording()).toEqual([]);
  });

  it("the welcome a first run sees", () => {
    renderInApp(
      <OnboardingScreen>
        <div />
      </OnboardingScreen>,
      mainnetState({ currentWallet: null, wallets: [] }),
    );
    expect(screen.getByText(/This is the live network/)).toBeInTheDocument();
    expect(testWording()).toEqual([]);
  });

  it("the lock screen", () => {
    renderInApp(<LockScreen onUnlock={jest.fn()} />);
    expect(testWording()).toEqual([]);
  });

  it("the block explorer settings from the app menu", () => {
    renderInApp(<BlockExplorerModal modalIsOpen closeModal={jest.fn()} modalTitle="Block explorer" />);
    expect(testWording()).toEqual([]);
  });

  it("creating a wallet: the network and the server it offers", async () => {
    renderInApp(
      <AddNewWallet
        closeModal={jest.fn()}
        setWallets={jest.fn()}
        setCurrentWallet={jest.fn()}
        navigateToLoadingScreenChangingWallet={jest.fn()}
        doSaveWallet={jest.fn()}
        clearTimers={jest.fn().mockResolvedValue(undefined)}
      />,
      mainnetState(),
      "/addnewwallet",
    );
    fireEvent.click((await screen.findAllByText("Selected Server"))[0]);
    const network = screen.getByRole("combobox", { name: /network/i });
    expect(
      Array.from((network as HTMLSelectElement).options)
        .map((o) => o.value)
        .filter(Boolean),
    ).toEqual(["swarm-mainnet"]);
    const presets = await screen.findByRole("combobox", { name: /swarm server/i });
    const offered = Array.from((presets as HTMLSelectElement).options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(offered).toEqual([MAINNET_SERVER]);
    expect(testWording()).toEqual([]);
  });
});

describe("the main process and the packaging say nothing about test coins either", () => {
  /**
   * The macOS application menu, the About panel, the window, dock and DMG
   * names, the camera prompt: all of them come from `public/electron.js` and
   * `configs/swarm-builder.cjs`, which no renderer test ever reads. Their
   * names come from the build profile's `productName` ("SWARM Wallet" on
   * mainnet); what is checked here is that no sentence in them is written
   * for a test network. The two lowercase chain identifiers upstream's server
   * registry is keyed by, "test" and "testnet", are data, not wording.
   */
  const SCANNED = ["public/electron.js", "public/preload.js", "configs/swarm-builder.cjs"];
  const WORDING: readonly RegExp[] = [
    /Testnet/,
    /test coins/i,
    /test network/i,
    /no value/i,
    /no market/i,
    /experiment/i,
    /may be wiped/i,
    /\butest1/i,
    /\bswarm1/i,
  ];

  it.each(SCANNED)("%s", (file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const source = fs
      .readFileSync(path.resolve(__dirname, "..", file), "utf8")
      .split(/\r?\n/)
      // Comments are for the next reader, not the user.
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    const literals = [...source.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g)].map(
      (m) => m[0],
    );
    const worded = literals.filter((literal) => WORDING.some((pattern) => pattern.test(literal)));
    expect(worded).toEqual([]);
  });
});

describe("what the wording is derived from", () => {
  it("asks each network for its own address shapes", () => {
    expect(addressPlaceholderFor(SWARM_MAINNET_PROFILE)).toBe("swm1… or s1…");
    // The testnet keeps the sentence it always had.
    expect(addressPlaceholderFor(SWARM_TESTNET_PROFILE)).toBe("swarm1…, utest1… or tm…");
  });

  it("offers a new wallet on this build's own network only, on mainnet", () => {
    expect(profilesForNewWallets(SWARM_MAINNET_PROFILE)).toEqual([SWARM_MAINNET_PROFILE]);
    expect(profilesForNewWallets(SWARM_TESTNET_PROFILE)).toEqual([SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE]);
    expect(serverPresetsForNewWallets(SWARM_MAINNET_PROFILE).every((p) => p.profileId === "swarm-mainnet")).toBe(true);
    expect(serverPresetsForNewWallets(SWARM_TESTNET_PROFILE).some((p) => p.profileId === "swarm-testnet")).toBe(true);
  });
});
