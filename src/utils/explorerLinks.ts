// Straight from the enums' own files rather than the appstate barrel: utils
// imports this module, and the barrel's own members import utils.
import { BlockExplorerEnum } from "../components/appstate/enums/BlockExplorerEnum";
import { ServerChainNameEnum } from "../components/appstate/enums/ServerChainNameEnum";
import { swarmProfileFor } from "./networkProfiles";

/**
 * Block explorer links, per chain.
 *
 * SWARM has two explorers on two hosts, mainnet.explore.swarm.green and
 * testnet.explore.swarm.green, and neither SWARM chain exists on any Zcash
 * explorer. Until this module the link builders knew only upstream Zcash's
 * `main` and `test`: a SWARM mainnet transaction fell through to
 * `https://mainnet.zcashexplorer.app/transactions/<txid>`, a SWARM testnet one
 * got no link at all, and Settings put SWARM mainnet under its "Testnet"
 * heading because the choice between the two groups asked only whether the
 * chain was upstream `main`.
 *
 * The rule now: a SWARM chain links to its own SWARM explorer, or to the
 * user's custom explorer when they chose one. It never reaches a Zcash
 * explorer, whatever an older version stored in the settings file.
 *
 * Paths verified on both explorers on 2026-09-27: `/transactions/<txid>` and
 * `/address/<address>` (transparent and unified addresses).
 */

/** The explorer of a SWARM chain, or `undefined` for any other chain. */
export const swarmExplorerFor = (chainName: string | undefined | null): string | undefined =>
  swarmProfileFor(chainName)?.explorerUrl;

/**
 * Whether a chain reads its explorer choice from the mainnet group of settings
 * (`blockExplorerMainnet*`, headed "SWARM Mainnet") rather than the testnet
 * group (`blockExplorerTestnet*`, headed "SWARM Testnet").
 *
 * SWARM mainnet reads the mainnet group. It did not: the question was "is this
 * upstream `main`?", so SWARM mainnet read the testnet group. Upstream `main`
 * keeps the mainnet group and every other chain the testnet group, as before.
 */
export const usesMainnetExplorerSetting = (chainName: string | undefined | null): boolean =>
  chainName === ServerChainNameEnum.swarmMainnetChainName || chainName === ServerChainNameEnum.mainChainName;

/**
 * A stored explorer choice, read back from the settings file.
 *
 * A custom explorer stays custom. Anything else - the old default
 * `Zcashexplorer`, another Zcash explorer, the removed `Zypherscan`, a missing
 * value - becomes the SWARM explorer, which is the only predefined choice
 * Settings offers now.
 */
export const migrateExplorerChoice = (value: unknown): BlockExplorerEnum =>
  value === BlockExplorerEnum.Custom ? BlockExplorerEnum.Custom : BlockExplorerEnum.Swarm;

type LinkKind = "transaction" | "address";

/** The SWARM explorer's page for a transaction or an address. */
const swarmLink = (base: string, kind: LinkKind, id: string): string =>
  `${base}/${kind === "transaction" ? "transactions" : "address"}/${encodeURIComponent(id)}`;

/**
 * Upstream Zcash's chains, exactly as before this module. A SWARM build cannot
 * create a wallet on them; a leftover one still gets the link it always had,
 * and `Swarm`, meaningless there, stands for the old default.
 */
const upstreamLink = (kind: LinkKind, id: string, testnet: boolean, explorer: BlockExplorerEnum): string => {
  const choice = explorer === BlockExplorerEnum.Swarm ? BlockExplorerEnum.Zcashexplorer : explorer;
  if (choice === BlockExplorerEnum.Zcashexplorer) {
    const host = testnet ? "https://testnet.zcashexplorer.app" : "https://mainnet.zcashexplorer.app";
    return kind === "transaction" ? `${host}/transactions/${id}` : `${host}/search?qs=${id}`;
  }
  if (choice === BlockExplorerEnum.Cipherscan) {
    const host = testnet ? "https://testnet.cipherscan.app" : "https://cipherscan.app";
    return kind === "transaction" ? `${host}/tx/${id}` : `${host}/address/${id}`;
  }
  if (choice === BlockExplorerEnum.Zexplorer) {
    const net = testnet ? "testnet" : "mainnet";
    return kind === "transaction"
      ? `https://zexplorer.app/${net}/tx/${id}`
      : `https://zexplorer.app/${net}/address/${id}`;
  }
  return "";
};

const explorerLink = (
  kind: LinkKind,
  id: string,
  chainName: string | undefined | null,
  blockExplorer: BlockExplorerEnum,
  blockExplorerCustom: string,
): string => {
  const swarm = swarmExplorerFor(chainName);
  if (swarm) {
    // The user's own explorer when they set one; otherwise this network's.
    if (blockExplorer === BlockExplorerEnum.Custom && blockExplorerCustom) return `${blockExplorerCustom}${id}`;
    return swarmLink(swarm, kind, id);
  }
  if (blockExplorer === BlockExplorerEnum.Custom) return `${blockExplorerCustom}${id}`;
  return upstreamLink(kind, id, chainName === ServerChainNameEnum.testChainName, blockExplorer);
};

/**
 * The URL of a transaction on the chosen explorer, or "" when there is none.
 * For a SWARM chain it is never "" and never a Zcash explorer.
 */
export const explorerTxUrl = (
  txid: string,
  chainName: string | undefined | null,
  blockExplorer: BlockExplorerEnum,
  blockExplorerCustom: string,
): string => explorerLink("transaction", txid, chainName, blockExplorer, blockExplorerCustom);

/**
 * The URL of an address on the chosen explorer, or "" when there is none.
 * For a SWARM chain it is never "" and never a Zcash explorer.
 */
export const explorerAddressUrl = (
  address: string,
  chainName: string | undefined | null,
  blockExplorer: BlockExplorerEnum,
  blockExplorerCustom: string,
): string => explorerLink("address", address, chainName, blockExplorer, blockExplorerCustom);
