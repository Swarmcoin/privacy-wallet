import { SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE, withGenesis, withoutGenesis } from "./networkProfiles";
import { ServerRefusalEnum, checkServerIdentity, checkServerIdentityForChain } from "./serverIdentity";

const CEREMONY = "b".repeat(64);
const LAUNCHED = withGenesis(SWARM_MAINNET_PROFILE, CEREMONY);

/** A `GetLightdInfo` reply, of the shape `info_server` hands the renderer. */
const lightdInfo = (over: Record<string, unknown> = {}) => ({
  chain_name: "swarm-testnet",
  server_uri: "https://lwd.swarm.green:443/",
  ...over,
});

describe("a server serving the chain the wallet is on", () => {
  it("is accepted", () => {
    expect(checkServerIdentity(SWARM_TESTNET_PROFILE, lightdInfo())).toEqual({ ok: true });
  });

  it("is accepted on production too, once production has launched", () => {
    const info = lightdInfo({ chain_name: "swarm-mainnet", server_uri: "https://lwd-main.swarm.green:443/" });
    expect(checkServerIdentity(LAUNCHED, info)).toEqual({ ok: true });
  });

  it("is accepted when it also states the genesis and the genesis matches", () => {
    const info = lightdInfo({ chain_name: "swarm-mainnet", genesis_hash: CEREMONY });
    expect(checkServerIdentity(LAUNCHED, info)).toEqual({ ok: true });
  });
});

describe("a server serving a different chain", () => {
  it("is refused, naming both networks and the host", () => {
    const info = lightdInfo({ chain_name: "swarm-testnet", server_uri: "https://lwd.swarm.green:443/" });
    const verdict = checkServerIdentity(LAUNCHED, info);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe(ServerRefusalEnum.wrongChain);
    expect(verdict.message).toContain("lwd.swarm.green");
    expect(verdict.message).toContain("SWARM Testnet");
    expect(verdict.message).toContain("SWARM Mainnet");
  });

  it("is refused when the chain is upstream Zcash, which this wallet never syncs", () => {
    for (const chain of ["main", "test", "regtest", "mainnet"]) {
      const verdict = checkServerIdentity(SWARM_TESTNET_PROFILE, lightdInfo({ chain_name: chain }));
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.reason).toBe(ServerRefusalEnum.wrongChain);
      expect(verdict.message).toContain(chain);
    }
  });

  it("is refused when it says nothing about which chain it serves", () => {
    for (const info of [lightdInfo({ chain_name: "" }), lightdInfo({ chain_name: undefined }), null, undefined]) {
      const verdict = checkServerIdentity(SWARM_TESTNET_PROFILE, info);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.reason).toBe(ServerRefusalEnum.silent);
    }
  });
});

describe("a server with the right label but the wrong first block", () => {
  it("is refused as a different chain under the same name", () => {
    const info = lightdInfo({ chain_name: "swarm-mainnet", genesis_hash: "c".repeat(64) });
    const verdict = checkServerIdentity(LAUNCHED, info);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe(ServerRefusalEnum.wrongGenesis);
    expect(verdict.message).toContain("first block");
  });

  // A stock lightwalletd does not carry the genesis in GetLightdInfo. Its
  // absence must not be read as a mismatch, or the check would refuse every
  // server it is pointed at.
  it("is accepted when the server simply does not state a genesis", () => {
    expect(checkServerIdentity(LAUNCHED, lightdInfo({ chain_name: "swarm-mainnet" }))).toEqual({ ok: true });
  });
});

describe("a profile that has not launched", () => {
  // Explicitly unlaunched, not "whatever this build ships": the release that
  // fills the genesis in must not have to rewrite this test.
  it("refuses every server, however the server identifies itself", () => {
    const info = lightdInfo({ chain_name: "swarm-mainnet", genesis_hash: CEREMONY });
    const verdict = checkServerIdentity(withoutGenesis(SWARM_MAINNET_PROFILE), info);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe(ServerRefusalEnum.profileNotLaunched);
    expect(verdict.message).toContain("genesis");
  });
});

describe("from a chain label", () => {
  it("checks a SWARM chain", () => {
    expect(checkServerIdentityForChain("swarm-testnet", lightdInfo()).ok).toBe(true);
    expect(checkServerIdentityForChain("swarm-testnet", lightdInfo({ chain_name: "main" })).ok).toBe(false);
  });

  it("refuses to vouch for a chain that is not a SWARM network", () => {
    expect(checkServerIdentityForChain("main", lightdInfo({ chain_name: "main" })).ok).toBe(false);
    expect(checkServerIdentityForChain(undefined, lightdInfo()).ok).toBe(false);
  });
});
