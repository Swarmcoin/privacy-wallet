import { BlockExplorerEnum } from "../components/appstate/enums/BlockExplorerEnum";

export const swarmExplorerSettings = () => ({
  blockExplorerMainnetTransaction: BlockExplorerEnum.Swarm,
  blockExplorerTestnetTransaction: BlockExplorerEnum.Swarm,
  blockExplorerMainnetAddress: BlockExplorerEnum.Swarm,
  blockExplorerTestnetAddress: BlockExplorerEnum.Swarm,
  blockExplorerMainnetTransactionCustom: "",
  blockExplorerTestnetTransactionCustom: "",
  blockExplorerMainnetAddressCustom: "",
  blockExplorerTestnetAddressCustom: "",
});
