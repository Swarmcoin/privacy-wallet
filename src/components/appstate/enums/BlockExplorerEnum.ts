export enum BlockExplorerEnum {
  // The network's own SWARM explorer: mainnet.explore.swarm.green for SWARM
  // mainnet, testnet.explore.swarm.green for SWARM testnet. The default, and
  // the only predefined choice Settings offers. See src/utils/explorerLinks.ts.
  Swarm = "Swarm",
  // Upstream Zcash explorers. They do not index either SWARM chain, so a SWARM
  // wallet never links to them; they remain only for upstream chains and so a
  // stored choice from an older version can still be read and migrated.
  Zcashexplorer = "Zcashexplorer",
  Cipherscan = "Cipherscan",
  Zexplorer = "Zexplorer",
  // user custom
  Custom = "Custom",
}
