# SWARM Wallet release notes

Newest first. Each entry says what changed for the person using the wallet.

## 0.1.0-mainnet.11 (5 October 2026)

- **The SWM price.** On SWARM mainnet wallets the Overview shows the SWM
  price in US dollars beside your balance: the price, the change over 24
  hours, a line of the last two days, where the price comes from and how
  old it is. Your balance is shown in dollars under the total, and Send
  shows the amount in dollars as you type it.
- **A page for the price.** Click the price, or Price in the sidebar: the
  price in dollars and ETH, the change over 1, 6 and 24 hours, a chart over
  24 hours, 48 hours or 30 days that reads out any point you point at, the
  pool's 24-hour volume, fully diluted value, buys and sells and fee, what
  GeckoTerminal and DexScreener each read, the pool and token addresses to copy, and buttons that open the pool
  on DexScreener or GeckoTerminal in your browser.
- **Where the price comes from.** The SWARM price service at
  wallet.swarm.green, which reads the SWM/ETH pool on Base from
  GeckoTerminal and DexScreener. The wallet never asks those sites itself.
  Your addresses and balances are never sent: the wallet makes one plain
  request a minute, and only while it is open and on screen.
- **It is an indicative price.** The pool is small, so small trades move
  it. It is not a quote, and it is never used in a payment.
- **When the price is old.** After five minutes without a new reading the
  price is greyed and says "as of" the time it was read; after an hour it
  says "Price unavailable".
- **You can switch it off.** Settings → Price → "Show SWM price (USD)". Off
  means no price requests at all. "Hide balances" hides the dollar values
  too.
- Test-coin builds and testnet wallets show no price and make no price
  requests.
- **The source moved.** The wallet's source code and its issue tracker are
  now at github.com/Swarmcoin (the Swarm-Official account is gone). The
  menu's Source and Issues links and the "please report this" sentences
  point there, and the build fetches the SWARM wallet SDK from there, at
  exactly the same revisions as before.

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
