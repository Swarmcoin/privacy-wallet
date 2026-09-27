// Straight from the enum's own file rather than the appstate barrel: this
// module is imported by utils, which the barrel's own members import, and the
// barrel would close that loop.
import { ServerChainNameEnum } from "../components/appstate/enums/ServerChainNameEnum";
import { BUILD_IDENTITY, BUILD_PROFILE_ID } from "./buildIdentity";
import {
  SWARM_MAINNET_PROFILE,
  SWARM_NETWORK_PROFILES,
  SWARM_TESTNET_PROFILE,
  SwarmNetworkProfile,
  SwarmProfileIdEnum,
  isProfileSelectable,
  swarmProfileFor,
} from "./networkProfiles";

/**
 * Everything about the SWARM networks that more than one screen needs, in one
 * place.
 *
 * Neither SWARM chain is the public Zcash network and neither has a public
 * server registry: `servers:fetchList` answers an empty list for them on
 * purpose, and `fetchServerList` never asks. That is the whole reason this file
 * exists — every screen that offers a server has to know that "let the wallet
 * pick one" cannot work here, and has to offer the endpoints the project
 * actually runs instead.
 *
 * Since 2026-09-26 there are two of those networks, and the endpoints are no
 * longer a single list. On 2026-09-26 an owner installed the first mainnet
 * build, was offered upstream Zcash's server list by the wallet-creation
 * screen, and ended up with a `u1…` address: an upstream Zcash MAINNET wallet,
 * in a wallet that has no business creating one. So the lists here are the
 * only server lists this application has, they are SWARM's alone, and the
 * network a preset belongs to travels with it.
 */

/**
 * What this application is called, everywhere it names itself.
 *
 * Per build, not per wallet: the mainnet and the testnet package are two
 * applications on a machine (different app ids, installed side by side), and
 * each has to say which of them it is. Upstream's authorship stays where it
 * belongs, in the licences the build ships and in the repository.
 */
export const SWARM_APP_NAME = BUILD_IDENTITY.productName;

/**
 * The SWARM network THIS BUILD is branded for and starts on.
 *
 * Not simply "whatever `src/buildProfile.json` says": a profile that has not
 * launched has no genesis, so the wallet could not tell its indexer from any
 * other, and a build branded for it would be a build that cannot be used. Such
 * a build falls back to the network it can actually serve, and says so in the
 * log rather than silently.
 */
export const resolveActiveProfile = (profileId: string): SwarmNetworkProfile => {
  const wanted = SWARM_NETWORK_PROFILES.find((p) => p.id === profileId);
  if (wanted && isProfileSelectable(wanted)) return wanted;
  return SWARM_TESTNET_PROFILE;
};

export const ACTIVE_SWARM_PROFILE: SwarmNetworkProfile = resolveActiveProfile(BUILD_PROFILE_ID);

/**
 * The profile of the network a wallet is on, or this build's own when the
 * wallet's chain is not a SWARM one (or there is no wallet yet).
 *
 * A mainnet build can hold a wallet made on SWARM Testnet, and an address
 * typed into that wallet is judged by that wallet's network, not the build's.
 */
export const swarmProfileOrActive = (chain: string | undefined | null): SwarmNetworkProfile =>
  swarmProfileFor(chain) ?? ACTIVE_SWARM_PROFILE;

/** The light-wallet chain label this build's network reports. */
export const SWARM_CHAIN: ServerChainNameEnum = ACTIVE_SWARM_PROFILE.chainLabel;

/** What this build's network is called on screen. */
export const SWARM_NETWORK_LABEL = ACTIVE_SWARM_PROFILE.displayName;

/**
 * The coin these balances are counted in — the ticker, not the project name.
 * The same on both networks; what differs is whether it is worth anything,
 * which is `SWARM_COINS_ARE_TEST_COINS` below and not something to infer from
 * the ticker.
 */
export const SWARM_TICKER = ACTIVE_SWARM_PROFILE.ticker;

/**
 * Whether the coins on this build's network are test coins.
 *
 * A screen that tells a mainnet user their money "has no market and no value"
 * is worse than one that says nothing, so the sentence is behind this rather
 * than written into the copy.
 */
export const SWARM_COINS_ARE_TEST_COINS = ACTIVE_SWARM_PROFILE.id === SwarmProfileIdEnum.testnet;

export type SwarmServerPreset = {
  /** Which SWARM network this endpoint serves. */
  readonly profileId: SwarmProfileIdEnum;
  readonly label: string;
  readonly uri: string;
  readonly note: string;
  /**
   * True for an indexer the user runs themselves. It changes only what the
   * wallet says when the server does not answer: "check your internet
   * connection" is wrong advice about a process on the same machine.
   */
  readonly selfHosted?: boolean;
};

/** A bare `host:port` from a network manifest, as a URI a client can dial. */
const asUri = (server: string): string => (/^[a-z][a-z0-9+.-]*:\/\//i.test(server) ? server : `https://${server}`);

/** The mainnet indexer, as the wallet dials it. */
export const SWARM_MAINNET_SERVER_URI = asUri(SWARM_MAINNET_PROFILE.defaultServer);

/**
 * Every endpoint this application offers, in the order they are shown.
 *
 * Mainnet first, because it is where a person's money is and because a list
 * whose first entry is the testnet is a list that quietly makes the testnet the
 * default. The testnet entry says in its own label that its coins are worth
 * nothing — the one place a user reads before choosing.
 *
 * There is deliberately no upstream Zcash entry here and none anywhere else in
 * this build (see `src/utils/serverUrisList.ts`). This is not a wallet for the
 * public Zcash network, and the one time it offered Zcash's servers it created
 * a Zcash wallet.
 */
export const SWARM_SERVER_PRESETS: readonly SwarmServerPreset[] = [
  {
    profileId: SwarmProfileIdEnum.mainnet,
    label: "SWARM Mainnet",
    uri: SWARM_MAINNET_SERVER_URI,
    note: "The SWARM network's hosted indexer. Real coins.",
  },
  {
    profileId: SwarmProfileIdEnum.testnet,
    label: "SWARM Testnet (coins have no value)",
    uri: SWARM_TESTNET_PROFILE.defaultServer,
    note: "The project's test network. Coins here have no market and no value.",
  },
  {
    // 9067 is the light-wallet gRPC port in network/swarm-testnet/manifest.json,
    // which is Zaino's conventional one. Not 19767: that belongs to the
    // retired Privacy Testnet's indexer, and pointing this build at it would
    // dial a node serving a different genesis.
    profileId: SwarmProfileIdEnum.testnet,
    label: "My own testnet node",
    selfHosted: true,
    uri: "http://127.0.0.1:9067",
    note: "Needs a SwarmTestnet indexer running on this computer. The SWARM Node mining app does not include one yet.",
  },
];

/**
 * The networks a new or restored wallet may be made on, in this build.
 *
 * A mainnet build offers SWARM Mainnet and nothing else. The testnet has its
 * own build, installed beside this one under its own name, and both networks
 * count in SWM: a testnet wallet made inside the mainnet application is a
 * wallet whose coins look exactly like real ones and are worth nothing. A
 * testnet build offers both, as it always has. Wallets already on this
 * computer are not affected — this is only what the create and restore
 * screens offer.
 */
export const profilesForNewWallets = (
  active: SwarmNetworkProfile = ACTIVE_SWARM_PROFILE,
): readonly SwarmNetworkProfile[] =>
  active.id === SwarmProfileIdEnum.mainnet ? [SWARM_MAINNET_PROFILE] : [SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE];

/** The server presets the create and restore screens offer, in this build. */
export const serverPresetsForNewWallets = (
  active: SwarmNetworkProfile = ACTIVE_SWARM_PROFILE,
): readonly SwarmServerPreset[] => {
  const offered = profilesForNewWallets(active).map((profile) => profile.id);
  return SWARM_SERVER_PRESETS.filter((preset) => offered.includes(preset.profileId));
};

/**
 * What an address field's placeholder says to paste: the shapes a payment on
 * `profile`'s network goes to. `swm1… or s1…` on SWARM Mainnet, and on SWARM
 * Testnet the sentence it always had, `swarm1…, utest1… or tm…`.
 *
 * Until 0.1.0-mainnet.6 the testnet's sentence was written into every screen,
 * so the mainnet wallet asked its user for a testnet address.
 */
export const addressPlaceholderFor = (profile: SwarmNetworkProfile): string => {
  const shapes = [
    ...[profile.unifiedHrp, ...profile.legacyUnifiedHrps].map((hrp) => `${hrp}1…`),
    `${profile.transparentPrefixes[0]}…`,
  ];
  return `${shapes.slice(0, -1).join(", ")} or ${shapes[shapes.length - 1]}`;
};

/** The presets that belong to one SWARM network. */
export const swarmPresetsForChain = (chain: ServerChainNameEnum | "" | undefined): readonly SwarmServerPreset[] => {
  const profile = swarmProfileFor(chain);
  if (!profile) return [];
  return SWARM_SERVER_PRESETS.filter((preset) => preset.profileId === profile.id);
};

/** Where a wallet on `chain` starts when nothing else has been chosen. */
export const swarmDefaultServerFor = (chain: ServerChainNameEnum | "" | undefined): string => {
  const forChain = swarmPresetsForChain(chain);
  if (forChain.length > 0) return forChain[0].uri;
  return ACTIVE_SWARM_PROFILE.id === SwarmProfileIdEnum.mainnet
    ? SWARM_MAINNET_SERVER_URI
    : SWARM_TESTNET_PROFILE.defaultServer;
};

/**
 * Where a wallet starts when nothing else has been chosen — this build's own
 * network, which on a mainnet build is the mainnet indexer and not the testnet
 * one the first mainnet build shipped.
 */
export const SWARM_DEFAULT_SERVER: string = swarmDefaultServerFor(SWARM_CHAIN);

/** The network's first block, and so the earliest birthday a wallet can have. */
export const SWARM_ACTIVATION_HEIGHT = ACTIVE_SWARM_PROFILE.activationHeight;

/**
 * Why "Automatic" is not offered on these chains. Shown where the radio would
 * have been, so the absence reads as a decision rather than a missing control.
 */
export const SWARM_NO_AUTOMATIC_REASON =
  "SWARM has no public server directory, so the wallet cannot pick a server for you. Choose one below.";

/**
 * Whether `chain` is one of the SWARM networks.
 *
 * Both of them, since 2026-09-26. It used to mean SwarmTestnet alone, which is
 * how the mainnet build came to show the upstream Zcash server list and the
 * upstream "Automatic" radio on every screen that asked this question.
 */
export const isSwarmChain = (chain: ServerChainNameEnum | "" | undefined): boolean => !!swarmProfileFor(chain);

/**
 * The host a server URI points at, with the scheme, port and path removed.
 *
 * Shown instead of the full URI because the host is the part a person can
 * recognise, and instead of a peer count because a light wallet has no peers:
 * it talks to exactly one indexer and knows nothing about the network beyond
 * what that indexer tells it.
 */
export function serverHost(serverUri: string | undefined): string {
  if (!serverUri) return "";
  const trimmed = serverUri.trim();
  if (!trimmed) return "";
  try {
    // `new URL` needs a scheme; a bare "host:port" is common in settings.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const { hostname } = new URL(withScheme);
    return hostname || trimmed;
  } catch {
    return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/:?#]/)[0] || trimmed;
  }
}

/**
 * What to call the chain on a screen that names it — the address book's
 * heading, the save-a-contact field.
 *
 * These screens have only the ticker to go on, and upstream's answer was
 * "Zcash" for anything that was not public testnet. On these networks that is
 * simply wrong: a SWM balance is not Zcash.
 */
export const chainLabelForCurrency = (currencyName: string): string => {
  if (currencyName === SWARM_TICKER) return SWARM_NETWORK_LABEL;
  return currencyName === "TAZ" ? "Testnet Zcash" : "Zcash";
};

/** The preset `uri` belongs to, or undefined when it was typed by hand. */
export const swarmPresetFor = (uri: string): SwarmServerPreset | undefined =>
  SWARM_SERVER_PRESETS.find((preset) => preset.uri === uri);

/**
 * The cell a hidden digit folds into (style guide, section 07: masked values).
 * A hexagon rather than an asterisk — the value goes back into the hive.
 */
export const MASK_CELL = "⬢";

/**
 * An amount with its digits hidden, for when balances are not to be read over
 * someone's shoulder. The shape of the number survives — separators stay where
 * they were — so a masked figure still looks like the figure it is hiding.
 */
export const maskAmount = (amount: string, ticker: string = SWARM_TICKER): string => {
  const masked = amount.replace(/\d/g, MASK_CELL);
  return ticker ? `${masked} ${ticker}` : masked;
};

/**
 * What to say when a server on one of these chains does not answer.
 *
 * One sentence, naming the host and what the wallet is doing about it. It
 * used to announce that the public server "is not running yet", which was
 * true when it was written and stopped being true on 2026-09-21 — and then
 * told the first person to try a public download that the network was down
 * when it was live. A message that explains an outage is a message that has
 * to be revisited when the outage ends.
 */
export const swarmUnreachableMessage = (uri: string): string => {
  const host = serverHost(uri) || uri;
  const preset = swarmPresetFor(uri);
  if (preset?.selfHosted) {
    const profile = SWARM_NETWORK_PROFILES.find((p) => p.id === preset.profileId);
    return `Can't reach ${host} right now — check that your ${profile?.displayName ?? "SWARM"} indexer is running.`;
  }
  if (preset) {
    // One of the project's own hosted indexers. Both have been live since the
    // networks they serve launched, and this used to say "not running yet" —
    // true when written, and by 2026-09-21 it was telling the first person to
    // try a public download that the network was down when it was not.
    return `Can't reach ${host} right now — check your internet connection. The wallet keeps retrying.`;
  }
  return `Can't reach ${host} right now — check the address, or choose one of the listed servers.`;
};
