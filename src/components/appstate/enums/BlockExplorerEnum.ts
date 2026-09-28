export enum BlockExplorerEnum {
  // SWARM's own explorer for the wallet's network: mainnet.explore.swarm.green
  // on SWARM Mainnet, explore.swarm.green on SWARM Testnet. The default, and
  // with Custom the only choice the settings offer (0.1.0-mainnet.8).
  Swarm = "Swarm",
  // Upstream Zcash's explorers. Never used on a SWARM chain, whatever a
  // settings file says; kept so an upstream-chain wallet's stored choice and
  // an older settings file still parse.
  Zcashexplorer = "Zcashexplorer",
  Cipherscan = "Cipherscan",
  Zexplorer = "Zexplorer",
  // user custom
  Custom = "Custom",
}
