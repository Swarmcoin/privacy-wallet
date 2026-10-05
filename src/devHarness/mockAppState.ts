import {
  AppState,
  InfoClass,
  TotalBalanceClass,
  ValueTransferClass,
  UnifiedAddressClass,
  TransparentAddressClass,
  AddressBookEntryClass,
  SendPageStateClass,
  ErrorModalClass,
  ConfirmModalClass,
  FetchErrorTypeClass,
  WalletType,
  ServerChainNameEnum,
  ServerSelectionEnum,
  BlockExplorerEnum,
} from "../components/appstate";
import { ValueTransferKindEnum } from "../components/appstate/enums/ValueTransferKindEnum";
import { ValueTransferPoolEnum } from "../components/appstate/enums/ValueTransferPoolEnum";
import { ValueTransferStatusEnum } from "../components/appstate/enums/ValueTransferStatusEnum";
import { CreationTypeEnum } from "../components/appstate/enums/CreationTypeEnum";
import { PerformanceLevelEnum } from "../components/appstate/enums/PerformanceLevelEnum";
import { AddressScopeEnum } from "../components/appstate/enums/AddressScopeEnum";
import { UNKNOWN_MIXNET_VIEW } from "../rpc/components/mixnetPresenter";
import { INITIAL_SERVER_HEALTH } from "../rpc/components/serverHealth";
import { SWM_PRICE_OFF, SwmPriceIpcReading, SwmPriceState } from "../price/swmPriceTypes";
import { parseDetails, stateFor, statusFor } from "../price/swmPrice";

/**
 * Invented wallet state, for looking at the screens without a wallet.
 *
 * This file exists so that no screenshot, no visual check and no review of
 * this work ever needs the owner's real wallet opened. It is never imported
 * by the application: only `src/devHarness/index.tsx` reaches it, and nothing
 * reaches that except the harness build.
 *
 * The addresses are the shapes this network actually produces — `utest1…` for
 * unified, `tm…` for transparent — because a mock that used a made-up prefix
 * would let a screen that mis-handles a real one look fine.
 */

const now = Math.floor(Date.now() / 1000);

export const MOCK_UNIFIED =
  "utest1vjdkw7r3h2mq9m0y8xg0n6w4c2eqk5t8v7lz3h9n4p2r6s0t5v9x3z7b1d5f9h3k7m1q5w9y2a6c0e4g8j2l6n0p4r8t2v6x0z4";
export const MOCK_TRANSPARENT = "tmQ8xR4vK2mE7zD6yP3aH5wR9tCL2nFs0X";

function vt(partial: Partial<ValueTransferClass> & { is_coinbase?: boolean }): ValueTransferClass {
  return {
    type: ValueTransferKindEnum.received,
    confirmations: 12,
    blockheight: 12045,
    status: ValueTransferStatusEnum.confirmed,
    txid: "f3a9c1e78b4d2059ac71e3f0d8b6a24c19e5f7038a1c4d6e2b9f0a7c5d3e18e1a",
    time: now - 3600,
    amount: 1,
    ...partial,
  } as ValueTransferClass;
}

export const MOCK_VALUE_TRANSFERS: ValueTransferClass[] = [
  vt({
    type: ValueTransferKindEnum.received,
    amount: 84.2,
    time: now - 120,
    confirmations: 2,
    blockheight: 12045,
    poolsReceived: [ValueTransferPoolEnum.ironwood],
    txid: "f3a9c1e78b4d2059ac71e3f0d8b6a24c19e5f7038a1c4d6e2b9f0a7c5d3e18e1a",
    memos: ["Invoice #2291 — thanks"],
  }),
  vt({
    type: ValueTransferKindEnum.received,
    amount: 6.25,
    time: now - 840,
    confirmations: 5,
    blockheight: 12041,
    poolsReceived: [ValueTransferPoolEnum.transparent],
    txid: "a1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6f7082",
    // The flag zingolib sets on a coinbase transaction. Absent from every
    // other row here, exactly as it is absent from the SDK this build is
    // pinned at — so the harness shows both what today looks like and what
    // the tag will look like once the re-pin lands.
    is_coinbase: true,
  } as Partial<ValueTransferClass>),
  vt({
    type: ValueTransferKindEnum.sent,
    amount: 250,
    time: now - 3600,
    confirmations: 24,
    blockheight: 12020,
    fee: 0.0001,
    poolsSentFrom: [ValueTransferPoolEnum.ironwood],
    poolsReceived: [ValueTransferPoolEnum.ironwood],
    address: MOCK_UNIFIED,
    txid: "9b04d2aa7c31e80f5a6d4b29c07e13f8a5b2c9d604e7f1a3b8c5d2e9f604a02c7",
  }),
  vt({
    type: ValueTransferKindEnum.sent,
    amount: 1240.5,
    time: now - 90000,
    confirmations: 140,
    blockheight: 11905,
    fee: 0.0001,
    poolsSentFrom: [ValueTransferPoolEnum.ironwood],
    poolsReceived: [ValueTransferPoolEnum.transparent],
    address: MOCK_TRANSPARENT,
    txid: "2e7c6f1d59a03b48e7d2c6b5a4938f70e1d2c3b4a5968778e9d0c1b2a3948c3d8",
  }),
  vt({
    type: ValueTransferKindEnum.shield,
    amount: 500,
    time: now - 200000,
    confirmations: 320,
    blockheight: 11720,
    fee: 0.0002,
    poolsSentFrom: [ValueTransferPoolEnum.transparent],
    poolsReceived: [ValueTransferPoolEnum.ironwood],
    txid: "0c3de9f2a1b47c58d6e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9012a3bab77c",
  }),
  vt({
    type: ValueTransferKindEnum.sent,
    amount: 42,
    time: now - 400000,
    confirmations: 610,
    blockheight: 11430,
    status: ValueTransferStatusEnum.mempool,
    confirmationsOverride: 0,
    poolsSentFrom: [ValueTransferPoolEnum.ironwood],
    address: MOCK_UNIFIED,
    txid: "77aa10bc4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6e0d1",
  } as Partial<ValueTransferClass>),
];
// The mempool row above has to read as pending, which is confirmations 0.
MOCK_VALUE_TRANSFERS[5].confirmations = 0;

export const MOCK_BALANCE: TotalBalanceClass = {
  totalTransparentBalance: 1240.5,
  totalSaplingBalance: 0,
  totalOrchardBalance: 0,
  totalIronwoodBalance: 11239.85,
  confirmedTransparentBalance: 1240.5,
  confirmedSaplingBalance: 0,
  confirmedOrchardBalance: 0,
  confirmedIronwoodBalance: 11233.6,
  totalSpendableBalance: 12474.1,
} as TotalBalanceClass;

export const MOCK_WALLETS: WalletType[] = [
  {
    id: 1,
    fileName: "swarm-main.dat",
    alias: "Main hive",
    chain_name: ServerChainNameEnum.swarmTestnetChainName,
    creationType: CreationTypeEnum.Main,
    uri: "https://lwd.swarm.green:443",
    selection: ServerSelectionEnum.custom,
    performanceLevel: PerformanceLevelEnum.High,
  },
  {
    id: 2,
    fileName: "swarm-mining.dat",
    alias: "Mining rewards",
    chain_name: ServerChainNameEnum.swarmTestnetChainName,
    creationType: CreationTypeEnum.Seed,
    uri: "http://127.0.0.1:9067",
    selection: ServerSelectionEnum.custom,
    performanceLevel: PerformanceLevelEnum.High,
  },
];

function info(overrides: Partial<InfoClass>): InfoClass {
  return {
    ...new InfoClass(),
    chainName: ServerChainNameEnum.swarmTestnetChainName,
    serverUri: "https://lwd.swarm.green:443",
    latestBlock: 12046,
    walletHeight: 12046,
    currencyName: "SWM",
    version: "0.1.0-testnet.2",
    zingolib: "swarm",
    ...overrides,
  } as InfoClass;
}

export type MockScenario = {
  id: string;
  label: string;
  state: AppState;
};

function baseState(overrides: Partial<AppState>): AppState {
  return {
    totalBalance: MOCK_BALANCE,
    addressesUnified: [new UnifiedAddressClass(0, 0, MOCK_UNIFIED, false, true, true)],
    addressesTransparent: [
      {
        account: 0,
        address_index: 0,
        scope: AddressScopeEnum.external,
        encoded_address: MOCK_TRANSPARENT,
      } as TransparentAddressClass,
    ],
    addressBook: [
      new AddressBookEntryClass("Ada K.", MOCK_UNIFIED, ServerChainNameEnum.swarmTestnetChainName, "ZEC"),
      new AddressBookEntryClass(
        "Hive pool payouts",
        MOCK_TRANSPARENT,
        ServerChainNameEnum.swarmTestnetChainName,
        "ZEC",
      ),
    ],
    valueTransfers: MOCK_VALUE_TRANSFERS,
    messages: MOCK_VALUE_TRANSFERS.filter((v) => (v.memos ?? []).length > 0),
    errorModal: new ErrorModalClass(),
    confirmModal: new ConfirmModalClass(),
    sendPageState: new SendPageStateClass(),
    swapToState: null,
    info: info({}),
    syncingStatus: {},
    verificationProgress: 100,
    readOnly: false,
    fetchError: {} as FetchErrorTypeClass,
    currentWallet: MOCK_WALLETS[0],
    currentWalletOpenError: "",
    wallets: MOCK_WALLETS,
    birthday: 1,
    orchardPool: true,
    saplingPool: true,
    transparentPool: true,
    openErrorModal: () => {},
    closeErrorModal: () => {},
    openConfirmModal: () => {},
    closeConfirmModal: () => {},
    setSendTo: () => {},
    setSwapTo: () => {},
    calculateShieldFee: async () => 0.0001,
    handleShieldButton: () => {},
    addAddressBookEntry: () => {},
    zecPrice: 0,
    swmPrice: SWM_PRICE_OFF,
    showSwmPrice: true,
    setShowSwmPrice: () => {},
    mixnetView: UNKNOWN_MIXNET_VIEW,
    serverHealth: INITIAL_SERVER_HEALTH,
    rotateServer: () => {},
    switchServer: () => {},
    delegateServerChoice: () => {},
    reopenWallet: () => {},
    avoidedServers: [],
    blockExplorerMainnetTransaction: BlockExplorerEnum.Swarm,
    blockExplorerTestnetTransaction: BlockExplorerEnum.Swarm,
    blockExplorerMainnetAddress: BlockExplorerEnum.Swarm,
    blockExplorerTestnetAddress: BlockExplorerEnum.Swarm,
    blockExplorerMainnetTransactionCustom: "",
    blockExplorerTestnetTransactionCustom: "",
    blockExplorerMainnetAddressCustom: "",
    blockExplorerTestnetAddressCustom: "",
    setBlockExplorer: () => {},
    ...overrides,
  } as AppState;
}

/** The raw failure the owner was shown, kept exactly as it reached the screen. */
export const DNS_FAILURE =
  "sync: Indexer request error. ← code: 'The service is currently unavailable', " +
  'message: "dns error", source: tonic::transport::Error(Transport, ' +
  'ConnectError("dns error", Custom { kind: Uncategorized, error: "failed to lookup address ' +
  'information: Temporary failure in name resolution" }))';

export const SCENARIOS: MockScenario[] = [
  { id: "synced", label: "Synced", state: baseState({}) },
  {
    id: "syncing",
    label: "Syncing 42 %",
    state: baseState({ verificationProgress: 42 }),
  },
  {
    id: "offline",
    label: "Not connected · DNS failure",
    state: baseState({
      verificationProgress: null,
      info: info({ latestBlock: 0 }),
      syncingStatus: { lastError: DNS_FAILURE },
    }),
  },
  {
    id: "empty",
    label: "Fresh wallet",
    state: baseState({
      totalBalance: new TotalBalanceClass(),
      valueTransfers: [],
      messages: [],
      wallets: [MOCK_WALLETS[0]],
    }),
  },
];

/** No wallets at all: what a person sees the very first time. */
SCENARIOS.push({
  id: "firstrun",
  label: "First run · no wallet",
  state: baseState({
    totalBalance: new TotalBalanceClass(),
    valueTransfers: [],
    messages: [],
    wallets: [],
    currentWallet: null,
    addressesUnified: [],
    addressesTransparent: [],
  }),
});

/**
 * The SWM price in each state the card can be in, for `?price=<kind>`.
 *
 * The values are the specification's example document (GeckoTerminal's
 * reading of 2026-10-05 18:07 UTC and the hourly closes before it). The
 * picture only shows them on a build whose profile is swarm-mainnet: a
 * test-coin build draws no price whatever the state says.
 */
export function mockSwmPrice(kind: string | null): SwmPriceState | null {
  if (!kind) return null;
  // 48 hourly and 30 daily closes shaped like the pool's real history: flat
  // and thin, then the climb of 2026-10-04/05. Invented, deterministic.
  const wave = (n: number, from: number, to: number, wobble: number) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const base = from + (to - from) * t * t;
      return Number((base * (1 + wobble * Math.sin(i * 1.7) * (1 - t))).toFixed(4));
    });
  const hourly = wave(48, 0.5259, 0.8411, 0.035);
  hourly[47] = 0.8411;
  const daily = wave(30, 0.31, 0.8411, 0.08);
  daily[29] = 0.8411;
  const hourStart = Math.floor(now / 3600) * 3600 - 47 * 3600;
  const dayStart = Math.floor(now / 86400) * 86400 - 29 * 86400;
  const fresh: SwmPriceState = {
    priceUsd: "0.84114343",
    changePct24h: 36.72,
    sparklineUsd: hourly,
    source: "geckoterminal",
    generatedUnix: now - 12,
    fetchedAtMs: Date.now() - 12_000,
    status: "fresh",
    pending: false,
    details: {
      priceEth: "0.000195976",
      changePct1h: 0,
      changePct6h: 28.75,
      hourlyFromUnix: hourStart,
      dailyUsd: daily,
      dailyFromUnix: dayStart,
      transactions24h: { buys: 9, sells: 0 },
      liquidityUsd: 3761.34,
      volume24hUsd: 378.11,
      fdvUsd: 8411.43,
      poolFeePct: 0.9,
      poolCreatedUnix: 1791100000,
      sources: [
        { id: "geckoterminal", ok: true, priceUsd: "0.84114343", fetchedUnix: now - 30 },
        { id: "dexscreener", ok: false, priceUsd: "0.8602", fetchedUnix: now - 400 },
      ],
    },
  };
  switch (kind) {
    case "fresh":
      return fresh;
    case "nodaily":
      return fresh.details ? { ...fresh, details: { ...fresh.details, dailyUsd: null, dailyFromUnix: null } } : fresh;
    case "down":
      return { ...fresh, changePct24h: -3.24, sparklineUsd: [...hourly].reverse() };
    case "ageing":
      return { ...fresh, status: "ageing", fetchedAtMs: Date.now() - 12 * 60_000 };
    case "stale":
      return { ...fresh, status: "stale", fetchedAtMs: Date.now() - 41 * 60_000 };
    case "unavailable":
      return { ...SWM_PRICE_OFF, status: "unavailable" };
    case "pending":
      return { ...SWM_PRICE_OFF, status: "unavailable", pending: true };
    case "off":
      return SWM_PRICE_OFF;
    default:
      return null;
  }
}

/**
 * `?priceJson=<the answer of price:swm>`: a real reading, for a screenshot
 * against the live relay. The screenshot script fetches it with the main
 * process's own `fetchSwmPrice` (public/swmPrice.js) and hands the validated
 * result over in the URL; this turns it into state the way the poller does.
 */
export function swmPriceFromIpc(json: string | null): SwmPriceState | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as SwmPriceIpcReading;
    const reading = {
      priceUsd: p.priceUsd,
      changePct24h: p.changePct24h,
      sparklineUsd: p.sparklineUsd,
      source: p.source,
      generatedUnix: p.generatedUnix,
      fetchedAtMs: Date.now(),
      relayStale: p.stale,
      details: parseDetails(p.details),
    };
    return stateFor(reading, statusFor(reading, Date.now()));
  } catch {
    return null;
  }
}

export function scenarioById(id: string): MockScenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
