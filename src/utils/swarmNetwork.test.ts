import {
  ACTIVE_SWARM_PROFILE,
  MASK_CELL,
  SWARM_APP_NAME,
  SWARM_CHAIN,
  SWARM_DEFAULT_SERVER,
  SWARM_MAINNET_SERVER_URI,
  SWARM_SERVER_PRESETS,
  SWARM_TICKER,
  isSwarmChain,
  maskAmount,
  resolveActiveProfile,
  swarmDefaultServerFor,
  swarmPresetFor,
  swarmPresetsForChain,
  swarmUnreachableMessage,
} from "./swarmNetwork";
import { BUILD_IDENTITIES, BUILD_PROFILE_ID } from "./buildIdentity";
import {
  SWARM_MAINNET_PROFILE,
  SWARM_TESTNET_PROFILE,
  SwarmProfileIdEnum,
  isProfileSelectable,
  withoutGenesis,
} from "./networkProfiles";
import { ServerChainNameEnum } from "../components/appstate";

describe("the network this build is for", () => {
  it("is the chain label the indexer reports", () => {
    expect(SWARM_CHAIN).toBe(ACTIVE_SWARM_PROFILE.chainLabel);
    expect(isSwarmChain(SWARM_CHAIN)).toBe(true);
    expect(isSwarmChain(ServerChainNameEnum.swarmTestnetChainName)).toBe(true);
    expect(isSwarmChain(ServerChainNameEnum.swarmMainnetChainName)).toBe(true);
  });

  // Upstream Zcash is not a SWARM network and no screen may treat it as one.
  // Before 2026-09-26 `isSwarmChain` meant SwarmTestnet alone, so on every
  // other chain the create-a-wallet screen fell through to upstream's server
  // list — which is how an owner ended up with a `u1…` Zcash wallet.
  it("is not upstream Zcash, on any of its three chains", () => {
    expect(isSwarmChain(ServerChainNameEnum.mainChainName)).toBe(false);
    expect(isSwarmChain(ServerChainNameEnum.testChainName)).toBe(false);
    expect(isSwarmChain(ServerChainNameEnum.regtestChainName)).toBe(false);
    expect(isSwarmChain("")).toBe(false);
    expect(isSwarmChain(undefined)).toBe(false);
  });

  // SWARM is the project; SWM is what a balance is counted in.
  it("counts balances in SWM and names itself from the build profile", () => {
    expect(SWARM_TICKER).toBe("SWM");
    expect(SWARM_APP_NAME).toBe(BUILD_IDENTITIES[BUILD_PROFILE_ID].productName);
  });

  // The two identities this repository can be packaged under. Stated here, not
  // derived, because the whole point is that a mainnet build must not be able
  // to call itself the testnet one.
  it("has one identity per network, and they are different applications", () => {
    expect(BUILD_IDENTITIES["swarm-mainnet"]).toMatchObject({
      productName: "SWARM Wallet",
      appId: "green.swarm.wallet",
      packageName: "swarm-wallet-mainnet",
    });
    expect(BUILD_IDENTITIES["swarm-testnet"]).toMatchObject({
      productName: "SWARM Wallet (Testnet)",
      appId: "green.swarm.wallet.testnet",
      packageName: "swarm-wallet-testnet",
    });
    expect(BUILD_IDENTITIES["swarm-mainnet"].appId).not.toBe(BUILD_IDENTITIES["swarm-testnet"].appId);
  });

  // The exact version is not asserted above, and deliberately so: it changes
  // on every release, and a test that has to be edited to ship is a test
  // people edit without reading. It had gone stale exactly that way — the
  // build moved to 0.1.0-mainnet.3 and the assertion still said mainnet.2.
  // What matters here is the property that cannot go stale: each version
  // names its own network, so a mainnet build cannot be taken for the
  // testnet one by its version string any more than by its appId.
  it("gives each network a version that names that network", () => {
    expect(BUILD_IDENTITIES["swarm-mainnet"].version).toMatch(/-mainnet\.\d+$/);
    expect(BUILD_IDENTITIES["swarm-testnet"].version).toMatch(/-testnet\.\d+$/);
    expect(BUILD_IDENTITIES["swarm-mainnet"].version).not.toBe(
      BUILD_IDENTITIES["swarm-testnet"].version,
    );
  });

  // A build branded for a network it cannot reach would be a build nobody can
  // use, so the branding follows what is actually selectable.
  it("brands itself for the network it selects, and falls back when that network has not launched", () => {
    expect(resolveActiveProfile("swarm-mainnet")).toBe(SWARM_MAINNET_PROFILE);
    expect(resolveActiveProfile("swarm-testnet")).toBe(SWARM_TESTNET_PROFILE);
    expect(resolveActiveProfile("main")).toBe(SWARM_TESTNET_PROFILE);
    expect(isProfileSelectable(withoutGenesis(SWARM_MAINNET_PROFILE))).toBe(false);
  });
});

describe("the servers this application offers", () => {
  // The defect this list exists to close: upstream's twenty lightwalletd
  // endpoints used to be one dropdown away from the Create button.
  it("offers SWARM's endpoints and no upstream Zcash server", () => {
    expect(SWARM_SERVER_PRESETS.map((preset) => preset.uri)).toEqual([
      "https://lwd-main.swarm.green:8443",
      "https://lwd.swarm.green:443",
      "http://127.0.0.1:9067",
    ]);
    for (const preset of SWARM_SERVER_PRESETS) {
      expect(preset.uri).not.toMatch(/zec\.rocks|lightwalletd\.com|zcash-infra\.com|zcash/i);
    }
  });

  // The preset the release of 2026-09-26 did not have. Without it the only way
  // onto the live network was to type the address under "Another server", and
  // switching the dropdown back to a preset silently returned the wallet to the
  // testnet.
  it("offers SWARM Mainnet first, and makes it the default once mainnet has launched", () => {
    const mainnet = SWARM_SERVER_PRESETS[0];
    expect(mainnet.label).toBe("SWARM Mainnet");
    expect(mainnet.profileId).toBe(SwarmProfileIdEnum.mainnet);
    expect(mainnet.uri).toBe(SWARM_MAINNET_SERVER_URI);
    expect(SWARM_MAINNET_SERVER_URI).toBe("https://lwd-main.swarm.green:8443");

    // Launched: genesis present and the indexer deployed. Both are facts of
    // this build, and they are what make the preset selectable at all.
    expect(isProfileSelectable(SWARM_MAINNET_PROFILE)).toBe(true);
    expect(SWARM_MAINNET_PROFILE.serverIsLive).toBe(true);

    expect(swarmDefaultServerFor(ServerChainNameEnum.swarmMainnetChainName)).toBe(SWARM_MAINNET_SERVER_URI);
    expect(resolveActiveProfile("swarm-mainnet").chainLabel).toBe(ServerChainNameEnum.swarmMainnetChainName);
  });

  it("keeps the testnet selectable and says on the label that its coins are worthless", () => {
    const testnet = SWARM_SERVER_PRESETS[1];
    expect(testnet.label).toBe("SWARM Testnet (coins have no value)");
    expect(testnet.profileId).toBe(SwarmProfileIdEnum.testnet);
    expect(testnet.uri).toBe("https://lwd.swarm.green:443");
    expect(swarmDefaultServerFor(ServerChainNameEnum.swarmTestnetChainName)).toBe("https://lwd.swarm.green:443");
  });

  // A preset belongs to one network, and a wallet on one network must never be
  // offered the other's indexer as if it were interchangeable.
  it("keeps each network's endpoints to itself", () => {
    expect(swarmPresetsForChain(ServerChainNameEnum.swarmMainnetChainName).map((p) => p.uri)).toEqual([
      "https://lwd-main.swarm.green:8443",
    ]);
    expect(swarmPresetsForChain(ServerChainNameEnum.swarmTestnetChainName).map((p) => p.uri)).toEqual([
      "https://lwd.swarm.green:443",
      "http://127.0.0.1:9067",
    ]);
    expect(swarmPresetsForChain(ServerChainNameEnum.mainChainName)).toEqual([]);
  });

  it("starts this build on its own network's indexer", () => {
    expect(SWARM_DEFAULT_SERVER).toBe(swarmDefaultServerFor(SWARM_CHAIN));
    expect(swarmPresetFor(SWARM_DEFAULT_SERVER)?.profileId).toBe(ACTIVE_SWARM_PROFILE.id);
  });

  it("recognises a preset and does not claim a typed address is one", () => {
    expect(swarmPresetFor("https://lwd-main.swarm.green:8443")?.label).toBe("SWARM Mainnet");
    expect(swarmPresetFor("https://somewhere.example:443")).toBeUndefined();
  });

  // It names the host and says what the wallet is doing, and nothing else.
  // It used to announce that the public server "is not running yet" — true
  // when written, false from 2026-09-21, and by then it was telling people the
  // network was down while it was live.
  it("names the host and says the wallet keeps trying", () => {
    const said = swarmUnreachableMessage(SWARM_DEFAULT_SERVER);
    expect(said).toContain(ACTIVE_SWARM_PROFILE.id === SwarmProfileIdEnum.mainnet ? "lwd-main" : "lwd.swarm.green");
    expect(said).toContain("keeps retrying");
    expect(said).not.toMatch(/not running|not deployed|not live/i);
  });

  it("points someone on their own node at their own indexer", () => {
    const said = swarmUnreachableMessage("http://127.0.0.1:9067");
    expect(said).toContain("127.0.0.1");
    expect(said).toContain("indexer is running");
  });

  it("names a typed server rather than a preset that does not exist", () => {
    expect(swarmUnreachableMessage("http://127.0.0.1:1234")).toContain("127.0.0.1");
  });

  // Every preset's note has to stay true as the network changes around it.
  it("promises nothing about a server being absent", () => {
    for (const preset of SWARM_SERVER_PRESETS) {
      expect(preset.note).not.toMatch(/not running|not deployed|not live/i);
    }
  });
});

describe("masked amounts", () => {
  it("hides every digit and keeps the shape of the number", () => {
    expect(maskAmount("1240.50")).toBe(`${MASK_CELL.repeat(4)}.${MASK_CELL.repeat(2)} SWM`);
    expect(maskAmount("0.00000001")).toBe(`${MASK_CELL}.${MASK_CELL.repeat(8)} SWM`);
  });

  it("leaves no digit behind", () => {
    expect(maskAmount("1,240.50")).not.toMatch(/\d/);
  });
});
