/**
 * Whether this build shows the Treasury page at all.
 *
 * The rule the owner asked for: mainnet only, and on a testnet build only if
 * a testnet policy has actually been put in front of it. A page that offered
 * to spend from `s3fLmEHc…` on a build whose chain has no such address would
 * be a page whose every refusal is a puzzle.
 *
 * `swarmmain` is the network name the custody tool writes into a policy file
 * (`swarm-treasury`'s own `TreasuryNetwork::SwarmMain`), which is not the
 * same string as this app's chain label — the two vocabularies meet here and
 * nowhere else.
 */

import { ACTIVE_SWARM_PROFILE } from "../utils/swarmNetwork";
import { SwarmProfileIdEnum } from "../utils/networkProfiles";

/** The network name a policy file carries, per build profile. */
export const TREASURY_NETWORK_FOR_PROFILE: Record<string, string> = {
  [SwarmProfileIdEnum.mainnet]: "swarmmain",
  [SwarmProfileIdEnum.testnet]: "testnet",
};

/** The network name this build's policies must carry. */
export const TREASURY_NETWORK = TREASURY_NETWORK_FOR_PROFILE[ACTIVE_SWARM_PROFILE.id] ?? "";

/** Whether the rail shows Treasury without anything having to be loaded. */
export const TREASURY_ON_BY_DEFAULT = ACTIVE_SWARM_PROFILE.id === SwarmProfileIdEnum.mainnet;

/**
 * Whether a set of loaded policies makes the page worth showing.
 *
 * Exported separately from the constant so the decision is testable without
 * a build profile: `treasuryVisibility.test.ts` asks it about both networks.
 */
export function treasuryIsVisible(
  profileId: string,
  loadedPolicyNetworks: string[] = [],
): boolean {
  if (profileId === SwarmProfileIdEnum.mainnet) return true;
  const wanted = TREASURY_NETWORK_FOR_PROFILE[profileId];
  if (!wanted) return false;
  return loadedPolicyNetworks.includes(wanted);
}
