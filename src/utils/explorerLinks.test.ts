import {
  explorerAddressUrl,
  explorerTxUrl,
  migrateExplorerChoice,
  swarmExplorerFor,
  usesMainnetExplorerSetting,
} from "./explorerLinks";
import Utils from "./utils";
import { BlockExplorerEnum } from "../components/appstate/enums/BlockExplorerEnum";
import { ServerChainNameEnum } from "../components/appstate/enums/ServerChainNameEnum";
import { SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE } from "./networkProfiles";
import { shell } from "../electronBridge";

jest.mock("../electronBridge");

const mockOpenExternal = shell.openExternal as jest.Mock;

beforeEach(() => {
  mockOpenExternal.mockClear();
});

// The two SWARM explorers, by their explicit names. The bare
// explore.swarm.green serves the testnet and is never linked.
const MAINNET_EXPLORER = "https://mainnet.explore.swarm.green";
const TESTNET_EXPLORER = "https://testnet.explore.swarm.green";

// Real identifiers, read back from both explorers on 2026-09-27.
const MAINNET_TXID = "f9db8168efc9fbd042c3c48937e8f5f65c7657a3342e40b1633fd3f584bc26c7";
const MAINNET_T_ADDRESS = "s3RiGvK5JzS8eh6ywN3K22f2LzDAhicgFuq";
const TESTNET_TXID = "b56e601ba63fb5672caf67ef581503853642fa68001b85fbcbe74a99e6e9101c";
const TESTNET_T_ADDRESS = "t2DGVURG5tAyXXSkj85JV5xbvTobYv7H99n";
const TESTNET_UA =
  "swarm12flymdvahre66el73vpyej6nva55s0lhxhp97ujv7k0vrhgvdgmsfp2xtccadctpqaku2uvw8jqm4w5py66mml9yxf600eluzumd473r";

const SWARM_CHAINS = [ServerChainNameEnum.swarmMainnetChainName, ServerChainNameEnum.swarmTestnetChainName];
const EVERY_CHOICE = [
  BlockExplorerEnum.Swarm,
  BlockExplorerEnum.Zcashexplorer,
  BlockExplorerEnum.Cipherscan,
  BlockExplorerEnum.Zexplorer,
  BlockExplorerEnum.Custom,
  "Zypherscan" as BlockExplorerEnum,
  undefined as unknown as BlockExplorerEnum,
];
// Every upstream Zcash explorer host this application has ever linked.
const ZCASH_HOSTS = /zcashexplorer\.app|cipherscan\.app|zexplorer\.app|zypherscan/i;

describe("each SWARM network has its own explorer", () => {
  it("names the explicit hosts, never the bare one", () => {
    expect(SWARM_MAINNET_PROFILE.explorerUrl).toBe(MAINNET_EXPLORER);
    expect(SWARM_TESTNET_PROFILE.explorerUrl).toBe(TESTNET_EXPLORER);
    expect(swarmExplorerFor(ServerChainNameEnum.swarmMainnetChainName)).toBe(MAINNET_EXPLORER);
    expect(swarmExplorerFor(ServerChainNameEnum.swarmTestnetChainName)).toBe(TESTNET_EXPLORER);
    for (const url of [SWARM_MAINNET_PROFILE.explorerUrl, SWARM_TESTNET_PROFILE.explorerUrl]) {
      expect(new URL(url).host).not.toBe("explore.swarm.green");
    }
  });

  it("has none for upstream chains or an unknown one", () => {
    for (const chain of [
      ServerChainNameEnum.mainChainName,
      ServerChainNameEnum.testChainName,
      ServerChainNameEnum.regtestChainName,
      "mainnet",
      undefined,
      null,
    ]) {
      expect(swarmExplorerFor(chain)).toBeUndefined();
    }
  });
});

describe("transaction links", () => {
  it("send a SWARM mainnet transaction to the mainnet SWARM explorer", () => {
    expect(explorerTxUrl(MAINNET_TXID, ServerChainNameEnum.swarmMainnetChainName, BlockExplorerEnum.Swarm, "")).toBe(
      `${MAINNET_EXPLORER}/transactions/${MAINNET_TXID}`,
    );
  });

  it("send a SWARM testnet transaction to the testnet SWARM explorer", () => {
    expect(explorerTxUrl(TESTNET_TXID, ServerChainNameEnum.swarmTestnetChainName, BlockExplorerEnum.Swarm, "")).toBe(
      `${TESTNET_EXPLORER}/transactions/${TESTNET_TXID}`,
    );
  });

  it("go through Utils.zecExplorerTxUrl and Utils.openTxid the same way", () => {
    expect(
      Utils.zecExplorerTxUrl(MAINNET_TXID, ServerChainNameEnum.swarmMainnetChainName, BlockExplorerEnum.Swarm, ""),
    ).toBe(`${MAINNET_EXPLORER}/transactions/${MAINNET_TXID}`);
    Utils.openTxid(TESTNET_TXID, ServerChainNameEnum.swarmTestnetChainName, BlockExplorerEnum.Swarm, "");
    expect(mockOpenExternal).toHaveBeenCalledWith(`${TESTNET_EXPLORER}/transactions/${TESTNET_TXID}`);
  });
});

describe("address links", () => {
  it("send a SWARM mainnet address to the mainnet SWARM explorer", () => {
    expect(
      explorerAddressUrl(MAINNET_T_ADDRESS, ServerChainNameEnum.swarmMainnetChainName, BlockExplorerEnum.Swarm, ""),
    ).toBe(`${MAINNET_EXPLORER}/address/${MAINNET_T_ADDRESS}`);
  });

  it("send SWARM testnet addresses, transparent and unified, to the testnet SWARM explorer", () => {
    expect(
      explorerAddressUrl(TESTNET_T_ADDRESS, ServerChainNameEnum.swarmTestnetChainName, BlockExplorerEnum.Swarm, ""),
    ).toBe(`${TESTNET_EXPLORER}/address/${TESTNET_T_ADDRESS}`);
    expect(explorerAddressUrl(TESTNET_UA, ServerChainNameEnum.swarmTestnetChainName, BlockExplorerEnum.Swarm, "")).toBe(
      `${TESTNET_EXPLORER}/address/${TESTNET_UA}`,
    );
  });

  it("open through Utils.openAddress", () => {
    Utils.openAddress(MAINNET_T_ADDRESS, ServerChainNameEnum.swarmMainnetChainName, BlockExplorerEnum.Swarm, "");
    expect(mockOpenExternal).toHaveBeenCalledWith(`${MAINNET_EXPLORER}/address/${MAINNET_T_ADDRESS}`);
    Utils.openAddress(TESTNET_UA, ServerChainNameEnum.swarmTestnetChainName, BlockExplorerEnum.Swarm, "");
    expect(mockOpenExternal).toHaveBeenLastCalledWith(`${TESTNET_EXPLORER}/address/${TESTNET_UA}`);
  });
});

describe("no SWARM chain ever reaches a Zcash explorer", () => {
  // Whatever the settings file holds: the old default, another Zcash
  // explorer, a removed one, nothing at all.
  it.each(SWARM_CHAINS)("%s: every stored choice gives a link on that network's own explorer", (chain) => {
    const own = chain === ServerChainNameEnum.swarmMainnetChainName ? MAINNET_EXPLORER : TESTNET_EXPLORER;
    const other = chain === ServerChainNameEnum.swarmMainnetChainName ? TESTNET_EXPLORER : MAINNET_EXPLORER;
    for (const choice of EVERY_CHOICE) {
      for (const url of [explorerTxUrl("abc", chain, choice, ""), explorerAddressUrl("addr", chain, choice, "")]) {
        expect(url).not.toBe("");
        expect(url).not.toMatch(ZCASH_HOSTS);
        expect(url.startsWith(`${own}/`)).toBe(true);
        expect(url.startsWith(`${other}/`)).toBe(false);
        expect(new URL(url).host).not.toBe("explore.swarm.green");
      }
    }
  });

  it.each(SWARM_CHAINS)("%s: the old Zcash default opens the SWARM explorer, not Zcash's", (chain) => {
    Utils.openTxid("abc", chain, BlockExplorerEnum.Zcashexplorer, "");
    Utils.openAddress("addr", chain, BlockExplorerEnum.Zcashexplorer, "");
    expect(mockOpenExternal).toHaveBeenCalledTimes(2);
    for (const [url] of mockOpenExternal.mock.calls) expect(url).not.toMatch(ZCASH_HOSTS);
  });
});

describe("a custom explorer", () => {
  it("is honoured on both SWARM chains", () => {
    for (const chain of SWARM_CHAINS) {
      expect(explorerTxUrl("abc", chain, BlockExplorerEnum.Custom, "https://my.explorer/tx/")).toBe(
        "https://my.explorer/tx/abc",
      );
      expect(explorerAddressUrl("addr", chain, BlockExplorerEnum.Custom, "https://my.explorer/a/")).toBe(
        "https://my.explorer/a/addr",
      );
    }
  });

  it("with no URL falls back to the network's SWARM explorer rather than to nothing", () => {
    expect(explorerTxUrl("abc", ServerChainNameEnum.swarmMainnetChainName, BlockExplorerEnum.Custom, "")).toBe(
      `${MAINNET_EXPLORER}/transactions/abc`,
    );
  });
});

describe("upstream chains keep what they had", () => {
  it("links upstream main and test as before this change", () => {
    expect(explorerTxUrl("abc", ServerChainNameEnum.mainChainName, BlockExplorerEnum.Zcashexplorer, "")).toBe(
      "https://mainnet.zcashexplorer.app/transactions/abc",
    );
    expect(explorerTxUrl("abc", ServerChainNameEnum.testChainName, BlockExplorerEnum.Cipherscan, "")).toBe(
      "https://testnet.cipherscan.app/tx/abc",
    );
    expect(explorerAddressUrl("addr", ServerChainNameEnum.mainChainName, BlockExplorerEnum.Zexplorer, "")).toBe(
      "https://zexplorer.app/mainnet/address/addr",
    );
    // The SWARM explorer does not index upstream chains; the choice stands for
    // the old default there.
    expect(explorerTxUrl("abc", ServerChainNameEnum.mainChainName, BlockExplorerEnum.Swarm, "")).toBe(
      "https://mainnet.zcashexplorer.app/transactions/abc",
    );
    expect(explorerAddressUrl("addr", ServerChainNameEnum.testChainName, BlockExplorerEnum.Swarm, "")).toBe(
      "https://testnet.zcashexplorer.app/search?qs=addr",
    );
  });
});

describe("which Settings group a chain reads", () => {
  it("SWARM mainnet reads the mainnet group, SWARM testnet the testnet group", () => {
    expect(usesMainnetExplorerSetting(ServerChainNameEnum.swarmMainnetChainName)).toBe(true);
    expect(usesMainnetExplorerSetting(ServerChainNameEnum.swarmTestnetChainName)).toBe(false);
  });

  it("upstream chains read what they always read", () => {
    expect(usesMainnetExplorerSetting(ServerChainNameEnum.mainChainName)).toBe(true);
    expect(usesMainnetExplorerSetting(ServerChainNameEnum.testChainName)).toBe(false);
    expect(usesMainnetExplorerSetting(ServerChainNameEnum.regtestChainName)).toBe(false);
    expect(usesMainnetExplorerSetting(undefined)).toBe(false);
  });
});

describe("a stored choice read back from settings", () => {
  it("keeps Custom and turns everything else into the SWARM explorer", () => {
    expect(migrateExplorerChoice(BlockExplorerEnum.Custom)).toBe(BlockExplorerEnum.Custom);
    for (const old of [
      BlockExplorerEnum.Swarm,
      BlockExplorerEnum.Zcashexplorer,
      BlockExplorerEnum.Cipherscan,
      BlockExplorerEnum.Zexplorer,
      "Zypherscan",
      undefined,
      null,
      42,
    ]) {
      expect(migrateExplorerChoice(old)).toBe(BlockExplorerEnum.Swarm);
    }
  });
});
