# SWARM Wallet release notes

Newest first. Each entry says what changed for the person using the wallet.

## 0.1.0-mainnet.10 (2 October 2026)

The SWARM network was restarted on 2 October 2026 from a new first block.
Earlier mainnet builds are tied to the old chain and can no longer connect.
This release is for the restarted network.

- **Connects to the restarted network.** The wallet talks to
  `lwd-main.swarm.green` on the standard port 443 and checks that the server
  is on the restarted chain (first block `01b76d8a…eff2`). A server on any
  other chain, including the old one, is refused.
- **Your existing wallet moves over by itself.** The first time you open a
  wallet made with an earlier mainnet build, the wallet keeps its recovery
  phrase and every address it has handed out, and starts again from the first
  block of the new chain. Balances, history and pending payments from the old
  chain are not carried over, because that chain no longer exists. You will
  see this once: "The SWARM network was restarted on 2 October 2026. Your
  addresses and recovery phrase are unchanged; balances start again from the
  new chain."
- **Nothing is deleted.** Before the move, a copy of the old wallet file is
  kept next to it, named `…dat.before-network-restart-<number>.bak`. If the
  move cannot be completed, the wallet file is left exactly as it was and the
  wallet is not opened.
- **New wallets start at today's height.** A wallet created now begins at the
  current height of the restarted chain, so it is ready as soon as it has
  read the newest blocks.
- **Explorer links** go to explore.swarm.green only.
- Watch-only wallets (made from a viewing key) are moved the same way and keep
  their viewing key.
