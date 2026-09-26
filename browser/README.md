# SWARM Wallet in the browser

Phase 1 of `docs/SWARM-BROWSER-PLAN.md`: the SWARM wallet, running inside any
Chromium-based browser on Windows, before the branded SWARM Browser exists.

Two pieces:

- **`extension/`** — an MV3 extension called **SWARM Wallet**: a toolbar popup
  (balance, receive, send), a side panel (history), onboarding and settings.
  It holds no keys, makes no network requests, and asks for no access to any
  web page.
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
                                   │   lwd-main.swarm.green:8443 (gRPC/TLS)
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

**No network in the browser.** The extension requests no host permissions and
its content-security policy sets `connect-src 'none'`. Fonts and the QR
encoder are bundled files, not a CDN. Everything that reaches the SWARM
network goes through the host.

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
cd browser/extension  && npm test    # the QR encoder, two independent ways
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
