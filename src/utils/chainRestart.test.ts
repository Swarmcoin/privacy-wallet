import { CreationTypeEnum, PerformanceLevelEnum, ServerChainNameEnum, ServerSelectionEnum, WalletType } from "../components/appstate";
import {
  CHAIN_RESTART_NOTICE,
  genesisForNewRecord,
  needsMoveToRestartedChain,
  recordAfterMove,
  replaceRetiredServer,
} from "./chainRestart";
import { SWARM_MAINNET_ABANDONED_GENESIS, SWARM_MAINNET_GENESIS } from "./networkProfiles";
import serverUrisList from "./serverUrisList";

const record = (overrides: Partial<WalletType> = {}): WalletType => ({
  id: 4,
  fileName: "zingo-wallet-4.dat",
  alias: "1",
  chain_name: ServerChainNameEnum.swarmMainnetChainName,
  creationType: CreationTypeEnum.Seed,
  uri: "https://lwd-main.swarm.green:8443",
  selection: ServerSelectionEnum.custom,
  performanceLevel: PerformanceLevelEnum.High,
  ...overrides,
});

describe("the network restart of 2 October 2026", () => {
  it("says it in one sentence", () => {
    expect(CHAIN_RESTART_NOTICE).toBe(
      "The SWARM network was restarted on 2 October 2026. Your addresses and recovery phrase are unchanged; balances start again from the new chain.",
    );
  });

  it("moves every mainnet record that does not name the restarted chain", () => {
    expect(needsMoveToRestartedChain(record())).toBe(true);
    expect(needsMoveToRestartedChain(record({ genesis: SWARM_MAINNET_ABANDONED_GENESIS }))).toBe(true);
    expect(needsMoveToRestartedChain(record({ genesis: "" }))).toBe(true);
    expect(needsMoveToRestartedChain(record({ genesis: SWARM_MAINNET_GENESIS ?? "" }))).toBe(false);
  });

  it("moves no other network's wallet", () => {
    expect(needsMoveToRestartedChain(record({ chain_name: ServerChainNameEnum.swarmTestnetChainName }))).toBe(false);
    expect(needsMoveToRestartedChain(record({ chain_name: ServerChainNameEnum.mainChainName }))).toBe(false);
    expect(needsMoveToRestartedChain(null)).toBe(false);
  });

  it("marks a moved record with the restarted chain and its indexer", () => {
    const moved = recordAfterMove(record());
    expect(moved.genesis).toBe(SWARM_MAINNET_GENESIS);
    expect(moved.uri).toBe("https://lwd-main.swarm.green:443");
    expect(needsMoveToRestartedChain(moved)).toBe(false);
    // Nothing else about the wallet changes.
    expect({ ...moved, genesis: undefined, uri: "" }).toEqual({ ...record(), genesis: undefined, uri: "" });
  });

  it("replaces the abandoned chain's indexer address and nothing else", () => {
    for (const old of [
      "https://lwd-main.swarm.green:8443",
      "https://lwd-main.swarm.green:8443/",
      "lwd-main.swarm.green:8443",
      " https://LWD-MAIN.swarm.green:8443 ",
    ]) {
      expect(replaceRetiredServer(old)).toBe("https://lwd-main.swarm.green:443");
    }
    for (const kept of ["https://lwd-main.swarm.green:443", "https://lwd.swarm.green:443", "http://127.0.0.1:9067", ""]) {
      expect(replaceRetiredServer(kept)).toBe(kept);
    }
  });

  it("lists the old port as retired", () => {
    const retired = serverUrisList().find((s) => s.uri === "https://lwd-main.swarm.green:8443");
    expect(retired?.obsolete).toBe(true);
    expect(serverUrisList().find((s) => s.default)?.uri).toBe("https://lwd-main.swarm.green:443");
  });

  it("writes the restarted genesis into new mainnet records, but not into a file brought in", () => {
    expect(genesisForNewRecord(ServerChainNameEnum.swarmMainnetChainName, false)).toBe(SWARM_MAINNET_GENESIS);
    // A file from elsewhere may hold the abandoned chain's state: it is moved
    // when it is first opened.
    expect(genesisForNewRecord(ServerChainNameEnum.swarmMainnetChainName, true)).toBeUndefined();
    expect(genesisForNewRecord(ServerChainNameEnum.swarmTestnetChainName, false)).toBeUndefined();
  });
});
