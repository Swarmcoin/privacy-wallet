import { CreationTypeEnum } from "../enums/CreationTypeEnum";
import { PerformanceLevelEnum } from "../enums/PerformanceLevelEnum";
import { ServerChainNameEnum } from "../enums/ServerChainNameEnum";
import { ServerSelectionEnum } from "../enums/ServerSelectionEnum";

export interface WalletType {
  id: number;
  fileName: string;
  alias: string;
  chain_name: ServerChainNameEnum;
  creationType: CreationTypeEnum;
  // new fields
  uri: string;
  selection: ServerSelectionEnum;
  performanceLevel: PerformanceLevelEnum;
  /**
   * The genesis block of the chain this wallet's state belongs to. Written
   * for SWARM Mainnet wallets from 0.1.0-mainnet.10 on; a SWARM Mainnet record
   * without it was made on the chain abandoned on 2 October 2026 and is moved
   * onto the restarted one before it is opened (src/utils/chainRestart.ts).
   */
  genesis?: string;
}
