# Manual smoke test, for the owner

Everything below was left ready on this machine on 2026-09-26. The registry
entries are already written and the wallet core is already found, so step 1 of
the README can be skipped unless the worktree moves.

Microsoft Edge **154.0.4258.37** is installed at
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. No browser was
driven automatically for this: X and the browsers are yours to click, and a
script that pretends to be you inside a wallet is not something to build.

## 1. Load the extension (about a minute)

1. Open Edge, go to **`edge://extensions`**.
2. Turn **Developer mode** on (bottom left).
3. Click **Load unpacked**.
4. Choose the `browser\extension` folder of the checkout you are testing
   (for the price round: `D:\swarm-work\wallet-price-browser\browser\extension`).
5. The card should say **SWARM Wallet 0.2.2** and the ID should read
   `gmmgmodmgnigcgboccjelpgedejejfap`. If the ID differs, the manifest key was
   changed and the host will refuse the connection.
6. Pin it: puzzle-piece icon in the toolbar → pin **SWARM Wallet**.

## 2. What you should see

Click the SWARM Wallet icon.

- The badge at the top right should read **SWARM Mainnet**.
- The footer should read **Block <number>** or **Network at block <number>**,
  matching what `lwd-main.swarm.green` reports.
- Because there is no browser wallet yet, the popup should offer **Create a
  wallet** / **Restore**.

If it instead says *The wallet host is not running*, the registry entry is
missing or the path moved: run
`browser\install\Install SWARM Browser Wallet (dev).cmd` again.

## 2a. The SWM price (extension 0.2.2)

Unlock first; the price lives on the wallet screen.

- Under the balance: `≈ •••••• USD` while hidden, `≈ $… USD` after **Show**.
- Below it a **SWM PRICE** card: an orange dot, the price (`$0.8411` style),
  a green `▲ … % 24h` or red `▼ … % 24h` chip, a small orange line chart and
  `GeckoTerminal · updated … s ago`.
- **ⓘ** shows: "Indicative price from the SWM/ETH pool on Base. The pool is
  small; small trades move it. Not a quote."
- Clicking the card opens the **SWM price** page inside the popup (it
  scrolls): price in USD and ETH, 1h / 6h / 24h chips, a chart with
  **24h / 48h / 30d** (a range without data is greyed out; move the mouse
  over the chart for value and time), your balance (hidden until **Show**),
  pool statistics, both sources with ✓ or —, pool and token with **Copy**,
  **Open on DexScreener** / **Open on GeckoTerminal** (each opens a tab on
  that site), the note and the switch. **Back** returns to the wallet.
- Switching the price off on that page leaves only the note and the switch.
- **Send**: typing an amount shows `≈ $… USD` under it, and the confirmation
  screen repeats it.
- **Settings → SWM price**: switch **Show SWM price (USD)** off, reopen the
  popup: no card and no `≈ … USD` lines. Switch it back on.
- If the SWARM price service at `https://wallet.swarm.green/api/price/swm`
  does not answer, the card reads **Price unavailable** after an hour (greyed
  "as of hh:mm" before that); nothing else is affected.

The same states are in `extension\test\screenshots\` (made with
`node test\screenshots.mjs`, fake data, no wallet).

## 3. Create a wallet (this is a real mainnet wallet)

1. **Create a wallet** opens a full page.
2. Read the warning, click **I have paper ready**.
3. **Write the 24 words on paper.** They are shown once. This wallet is a
   separate wallet from your desktop SWARM Wallet and has its own phrase.
4. **I have written them down** → it asks for one word back at random → type it
   → **Check**.
5. You land on a page showing your new `swm1…` address.

## 4. Receive

1. Open the popup. Right after creating the wallet it is still unlocked
   (you just saw the recovery phrase). After five idle minutes, or after
   closing and reopening Edge, it says **Locked**.
2. **Unlock with Windows Hello** → Windows should raise its own consent dialog.
3. The balance shows as `⬢⬢⬢.⬢⬢ SWM` until you press **Show**.
4. **Receive** shows the address and a QR code. Check the address starts
   `swm1`. **Transparent** flips to the `s1…` address.
5. Send yourself a small amount (0.01 SWM) from the desktop SWARM Wallet or
   from a mining payout.
6. Watch the footer: it should move from **Syncing…** to **Block N**, and the
   balance should appear. A shielded payment needs the wallet to scan the block
   that carries it, so give it a minute.

## 5. History

**History** in the popup opens Edge's side panel with the value transfers:
direction, amount, time, address and transaction id.

## 6. Send

1. **Send**, paste an address, type an amount, optionally a memo.
2. **Review** shows the whole address and the amount.
3. **Send** → **Windows Hello asks again**, for this payment. This is the one
   to check deliberately: the session was already unlocked and it asks anyway.
4. Cancelling the Hello prompt must leave "Windows Hello did not confirm this
   payment. Nothing was sent." and no transaction.
5. Confirming gives a transaction id you can look up in the explorer.

## 7. The things worth trying to break

- **Wrong network address.** Paste a `u1…` or `swarm1…` address into Send. It
  should refuse before Windows Hello is raised at all.
- **Lock.** Press **Lock**, then reopen. Balance and history should both be
  refused until you unlock again.
- **Walk away.** Leave it five minutes; it locks itself.
- **Close the browser.** The host process exits with it. Check Task Manager:
  no `node.exe` left holding the wallet.
- **Another extension.** Nothing else can reach the host: the host manifest
  allows one extension id.

## 8. Undo

`browser\install\Uninstall SWARM Browser Wallet (dev).cmd` removes the registry
entries. Remove the extension from `edge://extensions`. **The wallet folder is
left alone** — `%LOCALAPPDATA%\Swarm\SWARM Browser Wallet` — delete it yourself
only once the recovery phrase is on paper.
