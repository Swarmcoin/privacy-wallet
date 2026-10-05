# SWARM Wallet (Testnet)

This fork keeps Zingo PC's desktop application and Zingolib's wallet and cryptographic implementation unchanged. What it adds is a network profile: `swarm-testnet`, the SwarmTestnet chain, which uses standard Zcash testnet address encodings and an explicitly pinned genesis. It is not the public Zcash testnet, and its coins — shown as `SWM` — have no market value and no fiat price. The testnet build shows no price anywhere and makes no price requests. The SWARM mainnet build shows the SWM price, read from the SWARM price service at `wallet.swarm.green` (see `docs/swap-privacy.md`, "The SWM price"); a testnet wallet opened in a mainnet build shows none either.

## Which network this build talks to, and how it proves it

The genesis hash lives in one constant in the pinned SDK. `sdk/swarm-sdk-pin.json` records which SDK revision this repository compiles, which genesis that revision targets, and a copy of the fields of `network/swarm-testnet/manifest.json` that decide which chain a wallet is on.

`scripts/check-swarm-sdk-pin.js` runs before anything is compiled and refuses the build unless the manifest declaration, `native/Cargo.toml`, `native/Cargo.lock`, the checked-out SDK revision and that SDK's own `config.rs` all name the same network and the same genesis. It enforces the network name, the chain label, the genesis hash, the genesis block's SHA-256 and the light-wallet gRPC port; it reports, without failing, when the generator's own bookkeeping (its commit, its reproduction count) has moved on, because none of that changes which chain the build talks to.

Two gates sit on top of it. `--require-real-genesis`, which the workflow passes when its `release` input is set, refuses a build still carrying `SWARM_TESTNET_GENESIS_PLACEHOLDER`. And `--manifest <path>`, given the network's own definition, refuses a genesis **stamped in the future**: the chain produces no block 1 until that moment arrives, so a wallet pinned to it would sync nothing while reporting nothing wrong. The first generated genesis had that fault — seven hours ahead — and this check is what caught it before an hour of compilation was spent on it.

Re-pointing at a new genesis means: set `SWARM_TESTNET_GENESIS` in the SDK, push that commit, then update the `rev` in `native/Cargo.toml`, the seven `source =` lines in `native/Cargo.lock`, the `ref:` in the workflow and `sdk/swarm-sdk-pin.json`. Nothing else holds the hash.

## Servers

The public lightwalletd registry has nothing for this chain and never will: `servers:fetchList` answers an empty list for it and `fetchServerList` does not ask. "Automatic" is therefore not offered on this network — it could only ever fail — and the server selection is `custom` with an endpoint prefilled, from the moment the Add a New Wallet screen opens and after every change of network, in all four creation types and on the change-server screen.

Two presets, plus a free-text field:

| Preset | Endpoint | State |
| --- | --- | --- |
| SWARM public server (default) | `https://lwd.swarm.green:443` | not deployed yet |
| My own node | `http://127.0.0.1:9067` | a SwarmTestnet indexer running on this computer |

The default does not answer yet, so creating a wallet asks the chosen server whether it is there first and says what is wrong in words rather than failing at the transport.

All of this lives in `src/utils/swarmNetwork.ts`. `public/electron.js` keeps its own copy of the chain label and default endpoint, because the main process runs before any renderer module is loaded.

## Where the data goes

Nothing is shared with the retired Privacy Testnet wallet.

- Electron profile: whatever `--user-data-dir` the launcher passes; the project launcher uses `.runtime\apps\wallet-swarm\profile-swarm`.
- Wallet files: `SWARM_WALLET_DIR` if set, otherwise the SDK's own `swarm-testnet` directory. The launcher sets it to `.runtime\apps\wallet-swarm\keys\swarm-testnet`.
- Wallet-file chain tag: 5. A wallet file written by the Privacy Testnet build (tag 3) is refused by name rather than opened against the wrong chain.
- Keychain entry: `SWARM Wallet (Testnet)`.

## Suppressed for this chain

Public server discovery, the ZEC price fetch and the mixnet-price notice (the SWM price on mainnet is a separate request to a SWARM host, not this one), public block-explorer links for transactions and addresses, and the `zcash:` protocol handler — the packaged build never registers itself as the machine's handler for public Zcash payment links.

## Build

The `SWARM wallet Windows test build` workflow produces a portable, unsigned Windows x64 ZIP. It does not publish a release and does not sign the executable.

The SDK is a pinned Git revision of `Swarm-Official/privacy-zingolib` in `native/Cargo.toml` and `native/Cargo.lock`, not a patch snapshot: the previous mechanism reconstructed the SDK from a patch applied to an upstream base, and there is nothing left to reconstruct now that the fork has its own branch. Everything cheap that can refuse the build — packaging configuration, the SDK pin, the lockfile, types, the network and server-selection tests — runs before the hour of compilation, not after it.

The artifact carries the wallet source commit, `native/Cargo.lock`, the ZIP's checksum and `sdk-integration.json`, which names the exact SDK commit and the genesis that was verified at build time.

Removed with the patch mechanism: the repackage workflow and `scripts/restore-privacy-compiled.py`, which were pinned to a specific Privacy Testnet run and artifact and could not be reused here.

## Theme

The interface follows `Swarm Style Guide v2`. Every colour, radius and type role is a token in `src/components/common/Global.css`; the eight `--color-*` names the application has always used are kept and re-pointed at those tokens, so a screen picks the theme up without being restyled rule by rule.

Two rules from the guide are load-bearing rather than decorative:

- **Hive Orange `#FF8A1F` is the brand and the shielded state.** They are the same colour on purpose.
- **Clear Blue `#6FB6FF` appears only where privacy is off** — a transparent address, a revealed amount, a button that puts something on-chain in the open. Nothing else may use it. The send confirmation is the first place it lands: when the wallet's own privacy verdict is anything but `Private`, the confirm button becomes a Clear Blue outline reading "Send anyway" and a line above it says what will be visible. The verdict and the transaction itself are unchanged; what changed is that a revealing send cannot be confirmed by reflex.

Motion is decoration and a `prefers-reduced-motion` preference switches all of it off.

**Fonts are bundled, never fetched.** Sora, Manrope and JetBrains Mono come from the pinned `@fontsource/*` packages and are imported in `src/index.css` — only the weights the design uses (Sora 400/500/600/700, Manrope 400/500/600, JetBrains Mono 400/500) and only the latin subset. Webpack emits the `.woff2` files into the build and the packaged wallet serves them from its own asar; the built stylesheet contains no remote font URL. A wallet that fetched a font would tell a font host when it was opened, which is not something this application does. Each package ships the SIL Open Font License its family is published under.

Not yet done, and deliberately not faked:

- **A COINBASE state pill.** Nothing in this wallet reports whether an output is a maturing coinbase, so there is no pill for it.
- **Hiding balances.** `maskAmount` implements the guide's masking (`⬢⬢⬢⬢.⬢⬢ SWM`) and is tested, but no control switches it on yet.

The pills say the wallet's own verdicts — `Private`, `Amount Revealed`, `Deshielded` — rather than the mockup's `SHIELDED` / `REVEALED`. Those verdicts are real, computed from the pools a transaction draws on and the kind of address it pays, and they are more specific than the mockup's labels; the pill's shape and its colour carry the state.

## Icon

The mark is SWARM's chevron over the hive's two eyes — the owner's mark of 2026-09-22 16:44, which replaced the earlier hive-bee drawing. It is not drawn by this repository at all: `D:/privacy/brand/swarm-mark` holds the master SVG, and `scripts/brand/install_app_brand.py` installs every file the wallet ships from it — `resources/swarm/icon.ico`, `resources/swarm/icon.icns`, `resources/swarm/icon-1024.png`, `resources/swarm/icons/*.png`, the Windows-store logos in `public/appx/`, the favicon, `src/assets/img/swarm-mark.svg` (which the logo component renders) and `src/assets/img/swarm-mark.png`. Changing the mark means changing the brand kit and re-running that installer; the wallet no longer holds a second drawing of the logo that could drift from the icon. The former `scripts/make-swarm-icon.js` was removed for exactly that reason.
