import { ServerChainNameEnum } from "../../components/appstate";

export type RPCInfoType = {
  version: string;
  git_commit: string;
  server_uri: string;
  vendor: string;
  taddr_support: boolean;
  chain_name: ServerChainNameEnum;
  sapling_activation_height: number;
  consensus_branch_id: string;
  latest_block_height: number;
  /**
   * The chain's height-zero block hash as the server states it (SDK
   * swarm-sdk-mainnet-1, `LightdInfo.genesisHash` field 19), or "" when the
   * server did not say. Optional: an addon built against an older SDK omits it,
   * and `src/utils/serverIdentity.ts` reads it only when present.
   */
  genesis_hash?: string;
};
