import { TREASURY_NETWORK_FOR_PROFILE, treasuryIsVisible } from "./treasuryVisibility";
import { SwarmProfileIdEnum } from "../utils/networkProfiles";

describe("where the Treasury page appears", () => {
  it("is always there on a mainnet build: that is the network the funds are on", () => {
    expect(treasuryIsVisible(SwarmProfileIdEnum.mainnet)).toBe(true);
    expect(treasuryIsVisible(SwarmProfileIdEnum.mainnet, [])).toBe(true);
  });

  it("is hidden on a testnet build that has been given no testnet policy", () => {
    expect(treasuryIsVisible(SwarmProfileIdEnum.testnet, [])).toBe(false);
    expect(treasuryIsVisible(SwarmProfileIdEnum.testnet, ["swarmmain"])).toBe(false);
  });

  it("appears on a testnet build once a testnet policy is loaded", () => {
    expect(treasuryIsVisible(SwarmProfileIdEnum.testnet, ["testnet"])).toBe(true);
  });

  it("is hidden for a profile nothing knows the treasury network name of", () => {
    expect(treasuryIsVisible("swarm-someday", ["testnet"])).toBe(false);
  });

  it("knows the network name the custody tool writes, not this app's chain label", () => {
    // `swarmmain` is swarm-treasury's own name for the network. The app's
    // chain label is a different string, and confusing the two is how a
    // policy for the right network gets refused.
    expect(TREASURY_NETWORK_FOR_PROFILE[SwarmProfileIdEnum.mainnet]).toBe("swarmmain");
    expect(TREASURY_NETWORK_FOR_PROFILE[SwarmProfileIdEnum.testnet]).toBe("testnet");
  });
});
