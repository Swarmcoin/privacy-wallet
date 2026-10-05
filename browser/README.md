# SWARM Wallet in the browser

Phase 1 of `docs/SWARM-BROWSER-PLAN.md`: the SWARM wallet, running inside any
Chromium-based browser on Windows, before the branded SWARM Browser exists.

Two pieces:

- **`extension/`** — an MV3 extension called **SWARM Wallet**: a toolbar popup
  (balance, SWM price, receive, send), a side panel (history), onboarding and
  settings. It holds no keys and asks for no access to any web page. Its one
  network request of its own is the SWM price, from the SWARM price service,
  and it can be switched off (see *The SWM price* below).
- **`host/`** — **swarm-wallet-host**, a small Node program outside the
  browser. It loads the same compiled wallet core (`native.node`) the desktop
  SWARM Wallet runs, keeps the wallet file in its own folder, and asks Windows
  Hello before unlocking and again before every payment.

They speak Chromium's native-messaging protocol over a pipe: UTF-8 JSON with a
32-bit native-endian length prefix.

```
  browser                          │  outside the browser
  ─────────────────────────────────┼──────────────────────────────────────────
  popup / side panel / settings    │
        │  chrome.runtime.sendMessage
        ▼                          │
  background.js  ──connectNative──►│  swarm-wallet-host.cmd → node src/main.js
                                   │        │
                                   │        ├── native.node  (zingolib-native)
                                   │        ├── %LOCALAPPDATA%\Swarm\
                                   │        │     SWARM Browser Wallet\
                                   │        │       swarm-mainnet\…
                                   │        └── Windows Hello
                                   │                │
                                   │                ▼
                                   │   lwd-main.swarm.green:443 (gRPC/TLS)
```

## Test it in five double-clicks

1. Double-click **`install/Install SWARM Browser Wallet (dev).cmd`**.
   It prints where it found Node and the wallet core, writes the host manifest,
   and registers it for Chrome, Edge, Chromium, Brave and the future SWARM
   Browser — under `HKEY_CURRENT_USER` only. If it cannot find the wallet core,
   run it again as
   `Install SWARM Browser Wallet (dev).cmd --native "C:\…\native.node"`.
2. Open **`edge://extensions`** (or `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the **`extension`** folder.
5. Click the **SWARM Wallet** icon in the toolbar.

The extension id is fixed by the public key in `extension/manifest.json`, so it
is the same every time and the same one the bundled SWARM Browser will use:
**`gmmgmodmgnigcgboccjelpgedejejfap`**.

To undo step 1, double-click **`install/Uninstall SWARM Browser Wallet
(dev).cmd`**. It removes those registry values and nothing else — in
particular it never deletes your wallet.

## The security model

**Keys never enter the browser.** The extension has no seed, no spending key
and no viewing key. It asks the host for a balance, an address, a history, or
for a payment to be made; the host answers. A compromised browser profile, a
malicious extension or a hostile web page has nothing to steal from the
extension, because there is nothing in it.

**Only this extension can reach the host.** The host manifest's
`allowed_origins` names exactly one extension id. Chromium refuses a connection
from any other extension, and a web page cannot open one at all.

**The host is one process per connection.** It is started by the browser, it
talks to one port, and when the port closes its stdin ends and it exits — with
the wallet saved and the core deinitialised, so the keys leave memory with it.

**Windows Hello twice.** Unlocking asks Hello. Every payment asks Hello again,
in the host, after the amount and the address are known. An unlocked session
is not permission to spend. If Windows Hello is not set up on the machine, the
host says so (`deviceAuth: "unavailable"`) and the screens tell the user
plainly rather than implying a protection that is not there.

**The session locks itself.** Five minutes of no commands and the wallet locks:
`deinitialize()` runs, so locking drops the keys, it does not merely hide a
screen.

**The command set is fixed.** The host implements `status`, `wallet.exists`,
`wallet.create`, `wallet.restore`, `wallet.unlock`, `wallet.lock`, `balance`,
`addresses`, `history`, `send`, `sync.start`, `sync.status` and
`settings.network`. Nothing else the wallet core exports is reachable from the
browser — not `get_seed`, not `get_ufvk`, not `delete_wallet`.

**Frames are bounded.** Chromium allows 64 MiB from the extension; this host
refuses anything over 256 KiB, because nothing it understands is larger, and a
length prefix is the one number an attacker controls before any parsing
happens. Replies over Chromium's 1 MB limit are refused rather than written.

**One network request in the browser, and it is switchable.** The extension's
only host permission is `https://wallet.swarm.green/api/price/swm` and its
content-security policy sets `connect-src https://wallet.swarm.green`, for the
SWM price and nothing else. Fonts and the QR encoder are bundled files, not a
CDN. Everything that reaches the SWARM network goes through the host.

## The SWM price

Extension 0.2.1 (the host stays 0.2.0; nothing in it changed) shows the SWM
price, as `specs/PRICE-DISPLAY.md` in the project repository describes:

- **Where it comes from.** One unauthenticated `GET
  https://wallet.swarm.green/api/price/swm` a minute, from the popup itself
  (`extension/lib/price.js`), not through the host. The relay reads the SWM/ETH
  pool on Base from GeckoTerminal and DexScreener. The URL is fixed in code.
  No cookies, no referrer, no redirects, an 8 s deadline, at most 64 KiB, and
  only a `swarm-price/1` answer with a positive decimal-string price is
  accepted. No address, balance or identifier is sent.
- **When.** Only while a wallet screen of the popup is open, only when the
  host reports SWARM Mainnet (`network.id == "swarm-mainnet"`, not test
  coins), and only while **Settings → SWM price → Show SWM price (USD)** is on
  (the default). Off means no request at all; switching it off also forgets the
  last reading. The side panel, settings, onboarding and the service worker
  never ask.
- **What it shows.** `≈ $… USD` under the shielded balance (masked as
  `≈ •••••• USD` while the balance is hidden), a price card (price, 24 h
  change, 48 h sparkline, source and age), and `≈ $… USD` under the send
  amount and on the confirmation screen. The card opens the **price page**
  (spec §6): price in USD and ETH, 1h/6h/24h change, a chart with
  24h/48h/30d ranges and a hover readout, your balance (masked with it),
  pool statistics, both aggregators' readings, the pool id and token contract
  with copy buttons, links to DexScreener and GeckoTerminal (fixed URLs, never
  taken from the relay), the note and the same on/off switch as Settings. The value is shielded balance × price in BigInt arithmetic on the
  zatoshi amount, rounded half-up to the cent: a display, not a quote.
- **Freshness.** Fresh under 5 minutes; 5–30 minutes "as of hh:mm"; over 30
  minutes, or when the relay says `stale`, greyed; over 60 minutes "Price
  unavailable". The last good reading is kept in `chrome.storage.local`
  (`swmPriceLast`) and shown greyed at the next opening until a new one
  arrives.

### What is *not* protected

**The wallet file is not encrypted with a passphrase.** This is the same
position the desktop SWARM Wallet is in, and it is stated here rather than
glossed over: the file under `%LOCALAPPDATA%\Swarm\SWARM Browser Wallet\` is
protected by the Windows account it belongs to and by Windows Hello gating
access through this host — not by a key derived from something the user knows.
Anyone who can read that folder as that user, with the machine unlocked, can
copy the wallet. (`public/electron.js` in the desktop app says the same about
its own lock: "It locks the session, it does not encrypt the wallet file".)

**The browser is still the browser.** Nothing here protects against a person
being tricked into sending to the wrong address. The send screen checks that
the address belongs to the selected network and shows the whole address on the
confirmation step; it cannot know who owns it.

## The wallet folder

`%LOCALAPPDATA%\Swarm\SWARM Browser Wallet\swarm-mainnet\swarm-browser-wallet.dat`

Deliberately not the desktop wallet's folder. Two processes holding the same
wallet database is a corrupted wallet, so the browser wallet is a separate
wallet with its own recovery phrase. Override it for a test with
`SWARM_BROWSER_WALLET_DIR`.

## Environment

| Variable | What it does |
| --- | --- |
| `SWARM_WALLET_NATIVE` | Full path to `native.node`. Beats every other way of finding it. |
| `SWARM_BROWSER_WALLET_DIR` | Where the wallet lives. Used by the end-to-end test for a disposable wallet. |
| `SWARM_HOST_NETWORK` | `swarm-mainnet` (default) or `swarm-testnet`. |
| `SWARM_HOST_IDLE_MINUTES` | Minutes of inactivity before the session locks. Default 5. |
| `SWARM_HOST_LOG` | A file to append the host's log to. It never contains seeds, keys or amounts. |

## Tests

```
cd browser/host       && npm test    # framing codec + command router, mocked core
cd browser/extension  && npm test    # QR encoder, sender and Rewards checks, the price module
node browser/extension/test/screenshots.mjs   # price display screenshots, headless Edge, no host, no network
                                              # (--live adds two shots that read the real relay once each)
node browser/e2e/launcher-check.js   # the .cmd launcher, exactly as Chromium starts it
node browser/e2e/e2e-mainnet.js      # a disposable wallet against live SWARM mainnet
```

`e2e-mainnet.js` creates a throwaway wallet in a fresh folder, checks that the
address is a `swm1…` one, syncs for a bounded time, reports the height and
deletes the folder again. It never prints the seed and never calls a command
that would raise a Windows Hello dialog.

## Known limits

- **Windows only.** The host runs anywhere Node and the core run, but the
  installer writes Windows registry keys and device authentication is Windows
  Hello. macOS would use `checkMacAuth` / `verifyMacUser`, which the core
  already exports, and a manifest in
  `~/Library/Application Support/<browser>/NativeMessagingHosts/`.
- **The wallet core is not shipped here.** `native.node` is 78 MB of compiled
  Rust from the wallet's own CI. The installer points the host at the copy the
  desktop SWARM Wallet installed, or at a path given with `--native`.
- **The service worker can be suspended** by the browser. When it is, the port
  closes and the host exits, which locks the wallet. That is safe but it means
  a long sync does not continue in the background; the popup restarts it.
- **One wallet.** The host opens one wallet file; there is no wallet switcher
  yet.
- **No swaps, no Ironwood migration, no mixnet.** The core exports them; this
  host does not.
- **The SWARM Browser registry key is a guess.** `HKCU\Software\Swarm\SWARM
  Browser\NativeMessagingHosts` follows the shape Chromium derives from a
  build's BRANDING file, but the browser does not exist yet, so nothing has
  confirmed it. Chrome, Edge and Chromium are confirmed against Chromium 153's
  own source.
