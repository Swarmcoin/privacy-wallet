import { ServerChainNameEnum } from "../components/appstate/enums/ServerChainNameEnum";
import { WalletType } from "../components/appstate/types/WalletType";
import { SWARM_MAINNET_GENESIS, SWARM_MAINNET_PROFILE } from "./networkProfiles";
import { SWARM_MAINNET_SERVER_URI } from "./swarmNetwork";

/**
 * The SWARM network restart of 2 October 2026, as the wallet sees it.
 *
 * SWARM Mainnet launched on 2026-09-26 from genesis `01c34428…afdd` and was
 * restarted on 2026-10-02 from genesis `01b76d8a…eff2`. Everything else about
 * the network stayed the same — its name, its label `swarm-mainnet`, its
 * addresses, its rules — so a wallet made before the restart still opens. What
 * it must not do is carry the abandoned chain's balances, history and pending
 * items onto the new one, or keep a birthday the new chain has not reached.
 *
 * The wallet file cannot say which chain it was synced against: it records the
 * network, not the genesis. The wallet RECORD can, so from 0.1.0-mainnet.10 on
 * every SWARM Mainnet record carries the genesis it belongs to. A record
 * without one, or with another one, is moved once, before it is opened
 * (`native.move_wallet_to_restarted_chain`): same keys, same addresses, a
 * fresh view from the new chain's first block, and a backup copy of the old
 * file kept beside it.
 */

/** The one sentence a moved wallet's owner is shown. */
export const CHAIN_RESTART_NOTICE =
  "The SWARM network was restarted on 2 October 2026. Your addresses and recovery phrase are unchanged; balances start again from the new chain.";

/** The title the sentence is shown under. */
export const CHAIN_RESTART_NOTICE_TITLE = "SWARM network restarted";

/**
 * The address the abandoned chain's indexer was served on. Port 8443 is no
 * longer served; the restarted chain's indexer is on 443.
 */
const RETIRED_MAINNET_SERVER = /^(https:\/\/)?lwd-main\.swarm\.green:8443\/?$/i;

/**
 * A stored server address, with the abandoned chain's indexer replaced by the
 * restarted chain's. Anything else is returned unchanged.
 */
export const replaceRetiredServer = (uri: string): string =>
  RETIRED_MAINNET_SERVER.test((uri ?? "").trim()) ? SWARM_MAINNET_SERVER_URI : uri;

/**
 * Whether this wallet record has to be moved onto the restarted chain before
 * it is opened: a SWARM Mainnet wallet whose record does not name this
 * build's genesis. Records written before 0.1.0-mainnet.10 name none, and
 * every one of them was made on the abandoned chain — no earlier build could
 * reach any other.
 */
export const needsMoveToRestartedChain = (wallet: Pick<WalletType, "chain_name" | "genesis"> | null): boolean =>
  !!wallet &&
  wallet.chain_name === SWARM_MAINNET_PROFILE.chainLabel &&
  !!SWARM_MAINNET_GENESIS &&
  wallet.genesis !== SWARM_MAINNET_GENESIS;

/**
 * The genesis a record made now is written with: this build's, for a SWARM
 * Mainnet wallet built from keys against the live server. `undefined` for
 * other networks, and for a wallet FILE brought in from elsewhere — that file
 * may hold the abandoned chain's state, so it is left to be moved when it is
 * first opened.
 */
export const genesisForNewRecord = (
  chain: ServerChainNameEnum | string | undefined,
  fromFile: boolean,
): string | undefined =>
  chain === SWARM_MAINNET_PROFILE.chainLabel && !fromFile && SWARM_MAINNET_GENESIS ? SWARM_MAINNET_GENESIS : undefined;

/** The record after a successful move: this build's genesis, the live server. */
export const recordAfterMove = (wallet: WalletType): WalletType => ({
  ...wallet,
  genesis: SWARM_MAINNET_GENESIS ?? undefined,
  uri: replaceRetiredServer(wallet.uri),
});
