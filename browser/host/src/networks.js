"use strict";

/**
 * The SWARM networks, as the host needs them.
 *
 * A deliberate copy of the facts in `src/utils/networkProfiles.ts`, not an
 * import of it: that file is TypeScript compiled by the desktop app's build,
 * and this host runs on plain Node with no build step. The copy is small, it
 * is tested against the same values, and the rule it exists to enforce is the
 * same one:
 *
 *   The bare label `swarm-mainnet` is NOT a chain hint. The addon refuses it,
 *   because `ChainType::SwarmMainnet` carries the genesis and the SDK gives it
 *   no default. Production is opened as `swarm-mainnet:<64 lowercase hex>`.
 *
 * Everything that builds a hint goes through `chainHintFor` below.
 */

const MAINNET = {
  id: "swarm-mainnet",
  chainLabel: "swarm-mainnet",
  displayName: "SWARM Mainnet",
  ticker: "SWM",
  unifiedHrp: "swm",
  transparentPrefixes: ["s1", "s3"],
  // The restarted chain (2 October 2026). Its indexer is served on 443; port
  // 8443 belonged to the abandoned chain and is no longer served.
  defaultServer: "https://lwd-main.swarm.green:443",
  genesis: "01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2",
  /**
   * The genesis SWARM Mainnet launched from on 2026-09-26 and abandoned at the
   * restart of 2026-10-02. Every browser wallet made before host 0.2.0 was
   * made on it; see `chainRestart` in router.js.
   */
  retiredGenesis: ["01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd"],
  activationHeight: 1,
  coinsAreTestCoins: false,
  /** The block explorer, no trailing slash. Transactions are at /transactions/<txid>. */
  explorer: "https://explore.swarm.green",
  /** The folder the addon appends to the wallet base directory for this chain. */
  walletSubdir: "swarm-mainnet",
};

const TESTNET = {
  id: "swarm-testnet",
  chainLabel: "swarm-testnet",
  displayName: "SWARM Testnet",
  ticker: "SWM",
  unifiedHrp: "swarm",
  transparentPrefixes: ["tm", "t2"],
  defaultServer: "https://lwd.swarm.green:443",
  genesis: "045993f5c91ea160c7ebda573dd97b0016816bca68d395bfff202779b88e2a28",
  activationHeight: 1,
  coinsAreTestCoins: true,
  explorer: "https://testnet.explore.swarm.green",
  walletSubdir: "swarm-testnet",
};

const NETWORKS = { "swarm-mainnet": MAINNET, "swarm-testnet": TESTNET };

/** The network a label names, or undefined. Never falls back to a guess. */
const networkFor = (id) => NETWORKS[String(id || "")];

/**
 * The string the addon's `init_*`, `wallet_exists` and `delete_wallet` take as
 * their chain argument.
 *
 * Testnet's hint is its bare label; production's carries the genesis. Throws
 * for a network with no genesis rather than returning a hint a caller might
 * send anyway.
 */
function chainHintFor(network) {
  if (!network) throw new Error("no network");
  if (network.id === "swarm-testnet") return network.chainLabel;
  if (!network.genesis || !/^[0-9a-f]{64}$/.test(network.genesis)) {
    throw new Error(`${network.displayName} has no genesis hash, so it cannot be opened.`);
  }
  return `${network.chainLabel}:${network.genesis}`;
}

/** The explorer page of a transaction on `network`, or "" for a txid that is not one. */
function explorerTxUrl(network, txid) {
  const id = String(txid || "").trim();
  if (!network || !network.explorer || !/^[0-9a-f]{64}$/i.test(id)) return "";
  return `${network.explorer}/transactions/${id}`;
}

/** Whether `address` looks like one of `network`'s own encodings. */
function looksLikeAddressOf(network, address) {
  const a = String(address || "").trim();
  if (!a) return false;
  if (a.toLowerCase().startsWith(`${network.unifiedHrp}1`)) return true;
  return network.transparentPrefixes.some((p) => a.startsWith(p));
}

module.exports = {
  MAINNET,
  TESTNET,
  NETWORKS,
  networkFor,
  chainHintFor,
  explorerTxUrl,
  looksLikeAddressOf,
  DEFAULT_NETWORK_ID: "swarm-mainnet",
};
