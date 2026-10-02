import { ServerChainNameEnum } from "../components/appstate/enums/ServerChainNameEnum";

/**
 * The SWARM networks this application can be pointed at, as data.
 *
 * Until now "which network am I on" was three separate facts scattered across
 * the tree — a chain label in electron-settings, a handful of constants in
 * `swarmNetwork.ts`, and a string the native addon turns into a `ChainType`.
 * Adding a second SWARM network to that arrangement is how a wallet ends up on
 * the wrong chain, so the facts are collected here instead, one record per
 * network, and every screen that needs one of them asks this file.
 *
 * Two rules this file exists to enforce, and which its tests hold it to:
 *
 *  1. The generic word "mainnet" never reaches a SWARM profile. Upstream's
 *     `main` chain is Zcash and stays Zcash — in the SDK, in the vendored
 *     address crates, and in the addon, where `"main" => ChainType::Mainnet`
 *     still decodes `u1…`/`zs1…`/`t1…`/`t3…`. SWARM production is a separate
 *     profile with its own label, `swarm-mainnet`, and is reachable only by
 *     that label.
 *
 *  2. A profile with no genesis hash is not selectable. SWARM production has
 *     no genesis until the launch ceremony generates one, and a wallet that
 *     synced against the wrong chain would write its state back over the right
 *     one. So the field is required, it has no default and no placeholder, and
 *     `swarm-mainnet` stays unselectable until a release ships the hash.
 */

/** Which SWARM network a profile describes. */
export enum SwarmProfileIdEnum {
  testnet = "swarm-testnet",
  mainnet = "swarm-mainnet",
}

/**
 * The genesis block hash of the SWARM production network, in the display order
 * a node prints.
 *
 * Deliberately `null`. SWARM production has no genesis: it is generated at the
 * launch ceremony from a public unpredictable input, and until then there is no
 * honest value to put here. A placeholder would make the profile selectable and
 * let a build sync against whatever chain happened to answer, which is the one
 * failure this whole file is arranged to prevent.
 *
 * A release fills this in, from the network manifest, in the same commit that
 * fills in `SWARM_MAINNET_SERVER` below.
 */
export const SWARM_MAINNET_GENESIS: string | null = "01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2";

/**
 * The genesis SWARM Mainnet launched from on 2026-09-26 and abandoned when the
 * network was restarted on 2 October 2026.
 *
 * Kept, never served: a wallet record that names it, or that names no genesis
 * at all (every record written before 0.1.0-mainnet.10), holds that chain's
 * balances and history, and is moved onto the restarted chain once
 * (`src/utils/chainRestart.ts`). A server reporting it is refused like any
 * other foreign genesis.
 */
export const SWARM_MAINNET_ABANDONED_GENESIS = "01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd";

/**
 * Where a SWARM production wallet would look for its indexer.
 *
 * A placeholder host, marked not live: the name is reserved and the service is
 * not deployed. It is written down so the shape of the release change is
 * visible, not so anything dials it — nothing does while the profile is
 * unselectable.
 */
export const SWARM_MAINNET_SERVER = "lwd-main.swarm.green:443";

/** Everything one SWARM network is, in the terms the app needs. */
export type SwarmNetworkProfile = {
  /** Which network this is. */
  readonly id: SwarmProfileIdEnum;
  /**
   * The light-wallet chain label. What the indexer reports in `GetLightdInfo`,
   * what electron-settings stores as `all.serverchain_name`, and what the
   * addon's chain hint is built from. The single string that decides the chain.
   */
  readonly chainLabel: ServerChainNameEnum;
  /** What the network is called on screen. */
  readonly displayName: string;
  /** The coin balances are counted in. */
  readonly ticker: string;
  /**
   * The bech32m human-readable part of a unified address on this network.
   * `swarm1…` on testnet, `swm1…` on production. Disjoint by construction:
   * a bech32m string cannot satisfy two HRPs at once.
   */
  readonly unifiedHrp: string;
  /**
   * Older unified HRPs this network still accepts as payment destinations.
   * SwarmTestnet accepts `utest1…` because wallets created before the prefix
   * change hold those addresses. Production has no history and accepts none.
   */
  readonly legacyUnifiedHrps: readonly string[];
  /** The bech32m HRP of a ZIP 320 TEX address on this network. */
  readonly texHrp: string;
  /**
   * The leading characters of a Base58Check transparent address, from the
   * version bytes: testnet `tm…` (0x1d25) and `t2…` (0x1cba), production
   * `s1…` (0x1c28) and `s3…` (0x1c2d).
   */
  readonly transparentPrefixes: readonly string[];
  /** The indexer this network's wallets start on. */
  readonly defaultServer: string;
  /** Whether that indexer exists yet. */
  readonly serverIsLive: boolean;
  /** The light-wallet gRPC port this network's indexer serves. */
  readonly grpcPort: number;
  /**
   * The genesis this profile holds its indexer to, or `null` when the network
   * has not launched. `null` makes the profile unselectable.
   */
  readonly genesis: string | null;
  /**
   * The `zingolib::config::ChainType` variant this profile means, named so a
   * reader can check it against the SDK without leaving this file. Never
   * `Mainnet`: that variant is upstream Zcash.
   */
  readonly sdkChainType: "CustomTestnet" | "SwarmMainnet";
  /** The first block, and so the earliest birthday a wallet here can have. */
  readonly activationHeight: number;
  /**
   * This network's block explorer, with no trailing slash. Its paths, checked
   * against both live explorers on 2026-09-28 with real ids:
   * `/transactions/<txid>`, `/address/<transparent address>` and
   * `/blocks/<height>` answer 200; `/tx/<txid>` is 404, and so is `/address/`
   * for a shielded address, which an explorer cannot show.
   */
  readonly explorer: string;
  /**
   * The leading strings that belong to this network and to no other chain this
   * application knows of.
   *
   * SwarmTestnet's `tm…`, `t2…` and `utest1…` are not here: they are upstream
   * testnet's encodings too, because the vendored protocol crate renamed only
   * the unified HRP. So an address carrying one of those names two chains, and
   * anything that has to pick one from the string alone must not pick from it.
   */
  readonly distinctivePrefixes: readonly string[];
};

const TESTNET: SwarmNetworkProfile = {
  id: SwarmProfileIdEnum.testnet,
  chainLabel: ServerChainNameEnum.swarmTestnetChainName,
  displayName: "SWARM Testnet",
  ticker: "SWM",
  unifiedHrp: "swarm",
  legacyUnifiedHrps: ["utest"],
  texHrp: "textest",
  transparentPrefixes: ["tm", "t2"],
  defaultServer: "https://lwd.swarm.green:443",
  serverIsLive: true,
  grpcPort: 9067,
  // Published, reproduced twice, and recorded in sdk/swarm-sdk-pin.json and in
  // the network manifest. The chain is running, so this is a fact, not a plan.
  genesis: "045993f5c91ea160c7ebda573dd97b0016816bca68d395bfff202779b88e2a28",
  sdkChainType: "CustomTestnet",
  activationHeight: 1,
  explorer: "https://testnet.explore.swarm.green",
  distinctivePrefixes: ["swarm1"],
};

const MAINNET: SwarmNetworkProfile = {
  id: SwarmProfileIdEnum.mainnet,
  chainLabel: ServerChainNameEnum.swarmMainnetChainName,
  displayName: "SWARM Mainnet",
  ticker: "SWM",
  unifiedHrp: "swm",
  legacyUnifiedHrps: [],
  texHrp: "texswm",
  transparentPrefixes: ["s1", "s3"],
  defaultServer: SWARM_MAINNET_SERVER,
  serverIsLive: true,
  grpcPort: 9068,
  genesis: SWARM_MAINNET_GENESIS,
  sdkChainType: "SwarmMainnet",
  activationHeight: 1,
  // Since 2026-09-28 explore.swarm.green is SWARM Mainnet's explorer
  // (mainnet.explore.swarm.green is an alias of it); the testnet's is
  // testnet.explore.swarm.green.
  explorer: "https://explore.swarm.green",
  // Every one of SWARM production's encodings is its own: a new HRP and two
  // transparent version bytes checked against Zcash, Bitcoin, Litecoin, Dash,
  // Komodo and Horizen before they were chosen.
  distinctivePrefixes: ["swm1", "s1", "s3"],
};

/** Every SWARM profile, in the order a selector would list them. */
export const SWARM_NETWORK_PROFILES: readonly SwarmNetworkProfile[] = [TESTNET, MAINNET];

export const SWARM_TESTNET_PROFILE = TESTNET;
export const SWARM_MAINNET_PROFILE = MAINNET;

/**
 * The profile a chain label names, or `undefined`.
 *
 * `undefined` for `main`, `test` and `regtest` — those are upstream Zcash
 * chains and have no SWARM profile — and for anything unrecognised. It never
 * falls back: a caller that cannot identify the chain must not be handed one.
 */
export const swarmProfileFor = (chain: string | undefined | null): SwarmNetworkProfile | undefined =>
  SWARM_NETWORK_PROFILES.find((profile) => profile.chainLabel === chain);

/**
 * Whether this profile can be put in front of a user.
 *
 * A profile with no genesis cannot: the wallet would have nothing to hold the
 * server to, so "is this the right chain?" would be unanswerable.
 */
export const isProfileSelectable = (profile: SwarmNetworkProfile | undefined): boolean =>
  !!profile && typeof profile.genesis === "string" && profile.genesis.length > 0;

/** The profiles a selector may actually offer today. */
export const selectableSwarmProfiles = (): readonly SwarmNetworkProfile[] =>
  SWARM_NETWORK_PROFILES.filter(isProfileSelectable);

/** Why a profile is not on offer, in one sentence, or "" when it is. */
export const unselectableReason = (profile: SwarmNetworkProfile): string => {
  if (isProfileSelectable(profile)) return "";
  return (
    `${profile.displayName} has not launched yet: its genesis block is generated at the launch ` +
    `ceremony, and until this application ships that hash it cannot tell a real ` +
    `${profile.displayName} server from any other. This release cannot connect to it.`
  );
};

/**
 * What a SWARM profile is called in the addon's chain hint — the first argument
 * of `init_*`, `wallet_exists` and friends.
 *
 * SwarmTestnet's hint is the bare label, which is what the addon has always
 * been sent and what it maps to `ChainType::CustomTestnet`. Production's
 * carries the genesis after a colon, because `ChainType::SwarmMainnet` holds
 * the hash and the SDK gives it no default: `ChainType::try_from("swarm-mainnet")`
 * is an error there, deliberately, so a hint without a hash cannot build one.
 *
 * Throws rather than returning a hint a caller might send anyway. The addon in
 * this build understands only `swarm-testnet`; the production hint is the
 * contract the addon implements when the SDK pin moves to a revision that has
 * `ChainType::SwarmMainnet` (see docs/SWARM-NETWORK-PROFILES.md).
 */
export const chainHintFor = (profile: SwarmNetworkProfile): string => {
  if (profile.id === SwarmProfileIdEnum.testnet) return profile.chainLabel;
  if (!isProfileSelectable(profile)) {
    throw new Error(unselectableReason(profile));
  }
  return `${profile.chainLabel}:${profile.genesis}`;
};

/**
 * The chain hint for any chain label the application can hold, SWARM or not.
 *
 * THE ONE PLACE a chain label becomes a chain hint. Every `native.*` call that
 * takes one goes through this, and `src/utils/nativeChainHint.test.ts` fails
 * the build if a call site stops doing so.
 *
 * It exists because on 2026-09-26 the owner pressed Create on the first
 * mainnet build and got
 *
 *   initializing wallet: 'swarm-mainnet' does not name a network. The SWARM
 *   production network is opened as 'swarm-mainnet:<genesis>'
 *
 * `chainHintFor` had been written, documented and tested, and nothing called
 * it: all seven `native.wallet_exists` / `init_*` / `delete_wallet` call sites
 * passed `wallet.chain_name` straight through, which is right for every chain
 * the addon knew when they were written and wrong for the only one added
 * since. A correct function nobody calls is not a fix.
 *
 * Upstream Zcash's `main`, `test` and `regtest` pass through unchanged: their
 * hint IS the bare label, the addon has always been sent it, and a legacy
 * wallet on one of them still has to be found on disk so it can be named and
 * deleted. Anything unrecognised passes through too, for the same reason — the
 * addon's own error is a better answer than a guess made here.
 */
export const nativeChainHint = (chain: string | undefined | null): string => {
  const profile = swarmProfileFor(chain);
  if (profile) return chainHintFor(profile);
  return chain ?? "";
};

/**
 * A copy of `profile` carrying `genesis`, for the release that ships the hash
 * and for the tests that have to exercise a launched production network.
 *
 * Not a mutation: the module's own `SWARM_MAINNET_PROFILE` keeps its `null`, so
 * nothing a test does here can make the shipped profile selectable.
 */
export const withGenesis = (profile: SwarmNetworkProfile, genesis: string): SwarmNetworkProfile => {
  if (!/^[0-9a-f]{64}$/.test(genesis)) {
    throw new Error(
      `'${genesis}' is not a block hash: a genesis is 64 lowercase hexadecimal characters in display order.`,
    );
  }
  return { ...profile, genesis };
};

/**
 * A copy of `profile` with no genesis, for the tests that have to exercise the
 * unlaunched state.
 *
 * The mirror of `withGenesis`, and it exists for the same reason: the state a
 * test asserts must not be the state the build happens to be in. Before this,
 * every "SWARM production is not selectable" test read the shipped constant,
 * so the release that fills `SWARM_MAINNET_GENESIS` in would have had to
 * rewrite ten tests in the same commit — and a release step that edits its own
 * tests is a release step nobody can review. The unlaunched BEHAVIOUR is now
 * tested against this, and what the build currently ships is one separate,
 * explicit assertion.
 */
export const withoutGenesis = (profile: SwarmNetworkProfile): SwarmNetworkProfile => ({
  ...profile,
  genesis: null,
});

/**
 * The chain label a build may actually store and boot on.
 *
 * A settings file can hold anything — it is a JSON file on the user's disk, it
 * survives downgrades, and a release that ships `swarm-mainnet` and is then
 * rolled back leaves that label behind in it. So the label is read through this
 * on the way in: an unlaunched SWARM network falls back to the one this build
 * can serve rather than booting a wallet onto a chain it cannot identify.
 *
 * Anything that is not a SWARM chain passes through untouched. Upstream's
 * `main`, `test` and `regtest` are not this function's business.
 */
export const selectableChainOrFallback = (chain: string | undefined | null): string => {
  const profile = swarmProfileFor(chain);
  if (!profile) return chain ?? "";
  return isProfileSelectable(profile) ? profile.chainLabel : SWARM_TESTNET_PROFILE.chainLabel;
};
