import { ServerChainNameEnum } from "../components/appstate";
import {
  SWARM_MAINNET_ABANDONED_GENESIS,
  SWARM_MAINNET_GENESIS,
  SWARM_MAINNET_PROFILE,
  SWARM_NETWORK_PROFILES,
  SWARM_TESTNET_PROFILE,
  SwarmProfileIdEnum,
  chainHintFor,
  isProfileSelectable,
  selectableChainOrFallback,
  selectableSwarmProfiles,
  swarmProfileFor,
  unselectableReason,
  withGenesis,
  withoutGenesis,
} from "./networkProfiles";
import { SWARM_ACTIVATION_HEIGHT, SWARM_TICKER } from "./swarmNetwork";

const CEREMONY = "a".repeat(64);

describe("the SWARM testnet profile is exactly what this build already ships", () => {
  // The whole point of collecting these into a profile was that not one of
  // them may change in the process. This test is the promise that they did not.
  it("keeps every value the wallet used before the profiles existed", () => {
    expect(SWARM_TESTNET_PROFILE.chainLabel).toBe("swarm-testnet");
    // Not `SWARM_CHAIN` / `SWARM_DEFAULT_SERVER` any more: those two follow the
    // network the build is packaged for, and on a mainnet build they are the
    // mainnet's. What this test is about is that the testnet profile still says
    // exactly what the wallet said before profiles existed.
    expect(SWARM_TESTNET_PROFILE.defaultServer).toBe("https://lwd.swarm.green:443");
    expect(SWARM_TESTNET_PROFILE.ticker).toBe(SWARM_TICKER);
    expect(SWARM_TESTNET_PROFILE.activationHeight).toBe(SWARM_ACTIVATION_HEIGHT);
    expect(SWARM_TESTNET_PROFILE.unifiedHrp).toBe("swarm");
    expect(SWARM_TESTNET_PROFILE.legacyUnifiedHrps).toEqual(["utest"]);
    expect(SWARM_TESTNET_PROFILE.transparentPrefixes).toEqual(["tm", "t2"]);
    expect(SWARM_TESTNET_PROFILE.grpcPort).toBe(9067);
    expect(SWARM_TESTNET_PROFILE.sdkChainType).toBe("CustomTestnet");
  });

  it("is the genesis the SDK pin and the network manifest both record", () => {
    expect(SWARM_TESTNET_PROFILE.genesis).toBe(
      "045993f5c91ea160c7ebda573dd97b0016816bca68d395bfff202779b88e2a28",
    );
  });

  it("sends the addon the bare label it has always been sent", () => {
    expect(chainHintFor(SWARM_TESTNET_PROFILE)).toBe("swarm-testnet");
  });
});

describe("the SWARM mainnet profile", () => {
  it("is the identity the owner confirmed", () => {
    expect(SWARM_MAINNET_PROFILE.chainLabel).toBe("swarm-mainnet");
    expect(SWARM_MAINNET_PROFILE.displayName).toBe("SWARM Mainnet");
    expect(SWARM_MAINNET_PROFILE.unifiedHrp).toBe("swm");
    expect(SWARM_MAINNET_PROFILE.transparentPrefixes).toEqual(["s1", "s3"]);
    expect(SWARM_MAINNET_PROFILE.grpcPort).toBe(9068);
    expect(SWARM_MAINNET_PROFILE.ticker).toBe("SWM");
  });

  it("names the SDK variant that is not upstream Zcash", () => {
    expect(SWARM_MAINNET_PROFILE.sdkChainType).toBe("SwarmMainnet");
    // Neither profile may name `Mainnet`. That variant decodes u1/zs1/t1/t3.
    for (const profile of SWARM_NETWORK_PROFILES) {
      expect(profile.sdkChainType).not.toBe("Mainnet");
    }
  });

  // The host name is reserved and is the only one the launch step will write;
  // whether it is LIVE depends on whether this build has launched, which is
  // asserted once, below, in "what this build ships for SWARM production".
  it("names the reserved production indexer", () => {
    expect(SWARM_MAINNET_PROFILE.defaultServer).toBe("lwd-main.swarm.green:443");
  });

  it("accepts no legacy address encodings, having no history", () => {
    expect(SWARM_MAINNET_PROFILE.legacyUnifiedHrps).toEqual([]);
  });
});

// The unlaunched BEHAVIOUR, asserted against a profile that is explicitly
// unlaunched rather than against whatever this build happens to ship. These
// hold before the launch ceremony and after it.
describe("a mainnet with no genesis is not selectable", () => {
  const unlaunched = withoutGenesis(SWARM_MAINNET_PROFILE);

  it("carries no genesis and no placeholder", () => {
    expect(unlaunched.genesis).toBeNull();
  });

  it("is not offered", () => {
    expect(isProfileSelectable(unlaunched)).toBe(false);
    expect(isProfileSelectable(SWARM_TESTNET_PROFILE)).toBe(true);
  });

  it("says why, naming the ceremony rather than reading as a bug", () => {
    const why = unselectableReason(unlaunched);
    expect(why).toContain("SWARM Mainnet");
    expect(why).toContain("genesis");
    expect(unselectableReason(SWARM_TESTNET_PROFILE)).toBe("");
  });

  it("refuses to produce a chain hint the addon could act on", () => {
    expect(() => chainHintFor(unlaunched)).toThrow(/genesis/);
  });
});

// What THIS build ships, in one place. The launch commit — one run of
// `node scripts/set-swarm-mainnet-launch.js <manifest>` — swaps which of these
// two runs, and changes no test anywhere else. Whichever is not this build's
// state is skipped rather than asserted the other way round, because
// "skipped: this build has not launched" is the honest reading.
const BUILD_HAS_LAUNCHED = SWARM_MAINNET_GENESIS !== null;
const whileUnlaunched = BUILD_HAS_LAUNCHED ? it.skip : it;
const onceLaunched = BUILD_HAS_LAUNCHED ? it : it.skip;

describe("what this build ships for SWARM production", () => {
  it("agrees with itself about whether it has a genesis at all", () => {
    expect(SWARM_MAINNET_PROFILE.genesis).toBe(SWARM_MAINNET_GENESIS);
  });

  // The network was restarted on 2 October 2026. This build is pinned to the
  // restarted chain (block 0 at 2026-10-02T15:41:37Z, as GetLightdInfo on
  // lwd-main.swarm.green:443 reports it in field 19), never to the abandoned
  // one, and dials the restarted chain's indexer port.
  it("is pinned to the restarted chain and its indexer", () => {
    expect(SWARM_MAINNET_GENESIS).toBe("01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2");
    expect(SWARM_MAINNET_GENESIS).not.toBe(SWARM_MAINNET_ABANDONED_GENESIS);
    expect(SWARM_MAINNET_ABANDONED_GENESIS).toBe("01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd");
    expect(SWARM_MAINNET_PROFILE.defaultServer).toBe("lwd-main.swarm.green:443");
    expect(SWARM_MAINNET_PROFILE.serverIsLive).toBe(true);
    expect(chainHintFor(SWARM_MAINNET_PROFILE)).toBe(
      "swarm-mainnet:01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2",
    );
    expect(SWARM_MAINNET_PROFILE.explorer).toBe("https://explore.swarm.green");
  });

  whileUnlaunched("offers no mainnet, and rewrites a stored mainnet label", () => {
    expect(isProfileSelectable(SWARM_MAINNET_PROFILE)).toBe(false);
    expect(selectableSwarmProfiles()).toEqual([SWARM_TESTNET_PROFILE]);
    // A settings file survives a downgrade, so a stored production label is
    // rewritten back to the chain this build can actually serve.
    expect(selectableChainOrFallback("swarm-mainnet")).toBe("swarm-testnet");
    expect(SWARM_MAINNET_PROFILE.serverIsLive).toBe(false);
  });

  onceLaunched("offers a mainnet that is selectable, live, and hinted with its genesis", () => {
    expect(SWARM_MAINNET_GENESIS).toMatch(/^[0-9a-f]{64}$/);
    expect(isProfileSelectable(SWARM_MAINNET_PROFILE)).toBe(true);
    expect(selectableSwarmProfiles()).toEqual([SWARM_TESTNET_PROFILE, SWARM_MAINNET_PROFILE]);
    expect(selectableChainOrFallback("swarm-mainnet")).toBe("swarm-mainnet");
    expect(chainHintFor(SWARM_MAINNET_PROFILE)).toBe(`swarm-mainnet:${SWARM_MAINNET_GENESIS}`);
    // A launched network whose indexer is not deployed would be a profile the
    // wallet can select and cannot reach.
    expect(SWARM_MAINNET_PROFILE.serverIsLive).toBe(true);
  });

  it("leaves the testnet fallback and the upstream chains alone either way", () => {
    expect(selectableChainOrFallback("swarm-testnet")).toBe("swarm-testnet");
    // Upstream chains are not this function's business.
    expect(selectableChainOrFallback("main")).toBe("main");
    expect(selectableChainOrFallback("test")).toBe("test");
    expect(selectableChainOrFallback(undefined)).toBe("");
  });
});

describe("a launched mainnet", () => {
  const launched = withGenesis(SWARM_MAINNET_PROFILE, CEREMONY);

  it("becomes selectable once a release ships the hash", () => {
    expect(isProfileSelectable(launched)).toBe(true);
    // And the shipped profile is untouched by having built one.
    expect(SWARM_MAINNET_PROFILE.genesis).toBe(SWARM_MAINNET_GENESIS);
  });

  it("puts the genesis in the addon's chain hint, because the SDK needs it", () => {
    expect(chainHintFor(launched)).toBe(`swarm-mainnet:${CEREMONY}`);
  });

  it("refuses a hash that is not a block hash", () => {
    expect(() => withGenesis(SWARM_MAINNET_PROFILE, "045993F5")).toThrow(/block hash/);
    expect(() => withGenesis(SWARM_MAINNET_PROFILE, CEREMONY.toUpperCase())).toThrow(/block hash/);
  });
});

describe("the word mainnet never reaches a SWARM profile", () => {
  it.each(["main", "mainnet", "Mainnet", "test", "testnet", "regtest", "", "swarm", undefined, null])(
    "does not resolve %s to a SWARM network",
    (chain) => {
      expect(swarmProfileFor(chain as string)).toBeUndefined();
    },
  );

  it("resolves only the two SWARM labels, to themselves", () => {
    expect(swarmProfileFor("swarm-testnet")?.id).toBe(SwarmProfileIdEnum.testnet);
    expect(swarmProfileFor("swarm-mainnet")?.id).toBe(SwarmProfileIdEnum.mainnet);
    expect(swarmProfileFor(ServerChainNameEnum.mainChainName)).toBeUndefined();
  });

  it("keeps the two SWARM networks' encodings disjoint", () => {
    const testnet = SWARM_TESTNET_PROFILE;
    const mainnet = SWARM_MAINNET_PROFILE;
    expect(testnet.unifiedHrp).not.toBe(mainnet.unifiedHrp);
    expect(testnet.chainLabel).not.toBe(mainnet.chainLabel);
    for (const prefix of mainnet.transparentPrefixes) {
      expect(testnet.transparentPrefixes).not.toContain(prefix);
    }
    for (const prefix of mainnet.distinctivePrefixes) {
      expect(testnet.distinctivePrefixes).not.toContain(prefix);
    }
  });
});
