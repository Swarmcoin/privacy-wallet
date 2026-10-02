import { ServerClass } from "../components/appstate";
import { SWARM_SERVER_PRESETS, SwarmServerPreset } from "./swarmNetwork";
import { SWARM_MAINNET_PROFILE, SWARM_NETWORK_PROFILES, SWARM_TESTNET_PROFILE } from "./networkProfiles";

/**
 * Every server this application will offer, ever.
 *
 * Upstream shipped twenty lightwalletd endpoints here — `zec.rocks`,
 * `lightwalletd.com`, `zcash-infra.com` and the rest — because upstream is a
 * wallet for the public Zcash network. This is not. On 2026-09-26 an owner
 * installed the first SWARM mainnet build, was offered that list on the
 * create-a-wallet screen, and ended up looking at a `u1…` receive address: a
 * real Zcash mainnet wallet, created by a SWARM wallet, reachable only by the
 * seed he had just written down for what he thought was a different chain.
 *
 * So the list is SWARM's, and only SWARM's. There is no code path left that can
 * hand an upstream Zcash endpoint to `init_new`, `init_from_seed`,
 * `init_from_ufvk` or `init_from_b64`, because no such endpoint exists in the
 * build. It is derived from `SWARM_SERVER_PRESETS` rather than restated, so the
 * two cannot drift apart.
 *
 * `default: true` marks where a fresh profile starts: the mainnet indexer.
 */
const chainOf = (preset: SwarmServerPreset) =>
  SWARM_NETWORK_PROFILES.find((profile) => profile.id === preset.profileId)!.chainLabel;

/**
 * Endpoints this project has retired.
 *
 * Kept, and marked, because a wallet parked on one has to be moved off it: the
 * boot path rewrites an obsolete choice rather than dialling a host that is not
 * there. Port 19767 was the Privacy Testnet's indexer, the network SwarmTestnet
 * replaced; it serves a different genesis and a wallet pointed at it would sync
 * another chain's blocks.
 */
const RETIRED: ServerClass[] = [
  {
    uri: "https://lwd.swarm.green:19767",
    chain_name: SWARM_TESTNET_PROFILE.chainLabel,
    default: false,
    latency: null,
    obsolete: true,
  },
  // SWARM Mainnet's indexer port before the network restart of 2 October
  // 2026. It served the abandoned chain; the restarted chain's indexer is on
  // 443. A stored choice of it is rewritten on boot (src/utils/chainRestart.ts).
  {
    uri: "https://lwd-main.swarm.green:8443",
    chain_name: SWARM_MAINNET_PROFILE.chainLabel,
    default: false,
    latency: null,
    obsolete: true,
  },
];

const serverUrisList = (): ServerClass[] => [
  ...SWARM_SERVER_PRESETS.map((preset, index) => ({
    uri: preset.uri,
    chain_name: chainOf(preset),
    default: index === 0,
    latency: null,
    obsolete: false,
  })),
  ...RETIRED,
];

export default serverUrisList;
