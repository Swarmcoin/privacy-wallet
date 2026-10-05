# macOS direct-download builds

This is the only path that produces a SWARM Wallet a Mac will open after a
browser download: signed with a Developer ID Application identity, notarized,
stapled and verified on the owner's Apple-silicon Mac, for Apple silicon and
Intel. **Mainnet (`swarm-mainnet`) is the default**; testnet is a variant below.
It does not touch wallet profiles or recovery material and does not upload a
release.

The macOS packages CI produces (`.github/workflows/swarm-wallet-unix.yml`,
step "Package the unsigned test wallet") are integration builds, not releases:
CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and the base config sets
`identity: null`, so electron-builder signs nothing. The arm64 app keeps an ad
hoc signature that no longer matches the renamed, re-plisted bundle, and the
Intel app carries no usable signature. swarm-node PR #3 found exactly that on
the node's CI packages. Gatekeeper reports either download as "damaged and
can't be opened". The published `0.1.0-mainnet.2` Mac assets are such builds.

What is and is not proven: the decisions the release scripts make (which tree
may be signed, the release file names, what counts as a Developer ID signature,
the packaged identity) are unit-tested on any machine
(`node --test scripts/mac-release-checks.test.cjs`, also a step of the unix
workflow). The macOS steps themselves — codesign, notarytool, stapler, spctl —
run only on the owner's Mac; the last signed wallet was `0.1.0-testnet.7`
(2026-09-24), before the mainnet profile existed.

## Pins

The same as `.github/workflows/swarm-wallet-unix.yml`:

| | |
| --- | --- |
| Node.js | 24, native arm64 (`node -p process.arch` says `arm64`) |
| Yarn | 1.22.22, `yarn install --frozen-lockfile` |
| Rust | 1.96.0 via `RUSTUP_TOOLCHAIN`, targets `aarch64-apple-darwin` and `x86_64-apple-darwin` |
| `RUSTFLAGS` | `--cfg zcash_unstable="nu6.3"` |
| Cargo | `CARGO_PROFILE_RELEASE_DEBUG=0`, `CARGO_PROFILE_RELEASE_LTO=false`, `CARGO_INCREMENTAL=0`, `CARGO_NET_GIT_FETCH_WITH_CLI=true` |
| SDK | `Swarmcoin/privacy-zingolib` at `c7464d2ec40a5d619500a9ebee76ac4c39775baa` (tag `swarm-sdk-mainnet-1`), checked out into `sdk-source`; the revision `native/Cargo.lock` and `sdk/swarm-sdk-pin.json` name |
| Other | `protoc` (`brew install protobuf`), Xcode command-line tools, Rosetta 2 for the Intel smoke test |

## Prerequisites on the Mac

- A **Developer ID Application** identity, including its private key, in the
  login Keychain. `security find-identity -v -p codesigning` must list exactly
  one, or set `SWARM_MAC_SIGN_IDENTITY` to the exact name of the one to use.
  Apple Development and iOS distribution identities are not direct-download
  Mac identities.
- A `notarytool` Keychain profile, created locally with
  `xcrun notarytool store-credentials SWARM-notary`; enter credentials only in
  its secure prompt. `APPLE_KEYCHAIN_PROFILE=SWARM-notary` names it to the build.
- No credentials in the environment. The build refuses `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, `CSC_LINK` and `CSC_KEY_PASSWORD`. Never put a key,
  password, recovery phrase or certificate export in Git or a build log.

## Build: mainnet (default)

From a fresh clone at the release commit:

```sh
git clone https://github.com/Swarmcoin/privacy-wallet.git swarm-wallet
cd swarm-wallet
git checkout --detach <release commit>
git clone https://github.com/Swarmcoin/privacy-zingolib.git sdk-source
git -C sdk-source checkout --detach c7464d2ec40a5d619500a9ebee76ac4c39775baa
export RUSTUP_TOOLCHAIN=1.96.0
export RUSTFLAGS='--cfg zcash_unstable="nu6.3"'
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_INCREMENTAL=0
export CARGO_NET_GIT_FETCH_WITH_CLI=true
export SWARM_NETWORK_PROFILE=swarm-mainnet
export APPLE_KEYCHAIN_PROFILE=SWARM-notary
rustup toolchain install 1.96.0 --profile minimal
rustup target add --toolchain 1.96.0 aarch64-apple-darwin x86_64-apple-darwin
yarn install --frozen-lockfile
git status --porcelain
node scripts/set-build-profile.js
node scripts/check-swarm-package-config.js
node scripts/check-swarm-sdk-pin.js sdk-source --require-real-genesis
cargo fetch --locked --manifest-path native/Cargo.toml
node scripts/generate-swapkit-secrets.js
yarn tsc --noEmit
```

`git status --porcelain` must print nothing after the install. `set-build-profile.js`
reads `SWARM_NETWORK_PROFILE` and writes the selection into
`src/buildProfile.json`; it must run before the frontend is built, because the
renderer carries the file from then on.

Apple silicon:

```sh
yarn neon-mac-arm64
node scripts/check-swarm-prefix-native.js
git diff --exit-code -- native/Cargo.lock
node scripts/stage-nym-proxy.js --strict-rev --target aarch64-apple-darwin
yarn script:build
node scripts/check-swarm-bundle-strings.js --renderer build/static/js
node scripts/build-mac-distribution.js
```

Intel, from the same checkout and profile (nothing to restore in between):

```sh
yarn neon-mac-x64
git diff --exit-code -- native/Cargo.lock
node scripts/stage-nym-proxy.js --strict-rev --target x86_64-apple-darwin
yarn script:build
node scripts/check-swarm-bundle-strings.js --renderer build/static/js
node scripts/build-mac-distribution.js --arch x64
```

`check-swarm-prefix-native.js` is not run for Intel: arm64 Node cannot load the
x64 addon (CI skips it for the same reason). The Intel runner job below runs it
against the signed app. `yarn script:build` must follow each `neon-mac-*`: it
copies the addon just built into `build/`, and the build refuses a
`build/native.node` or `resources/nym-proxy` of the other architecture.

## Build: testnet (variant)

```sh
export SWARM_NETWORK_PROFILE=swarm-testnet
node scripts/set-build-profile.js
```

then the same native, helper, frontend and `build-mac-distribution.js` steps.
The result is `SWARM Wallet Testnet.app`, app id `green.swarm.wallet.testnet`,
version from the `swarm-testnet` profile, named
`SWARM-Wallet-<version>-mac-<arch>.*`; it installs beside the mainnet wallet,
never over it. Use a separate checkout, or move the previous
`dist-mac-signed*` output aside first: the build refuses to overwrite it.

## The network profile and a clean tree

`build-mac-distribution.js` writes `git rev-parse HEAD` into the release
manifest, so it signs only a tree HEAD describes. The one change a build makes
to tracked files is its own: `scripts/set-build-profile.js` selecting the
network. The script (with `scripts/mac-release-checks.cjs`) therefore:

- accepts `src/buildProfile.json` only if it is byte-for-byte what
  `set-build-profile.js` writes from HEAD's copy for the selected profile
  (or HEAD's copy itself), and `SWARM_NETWORK_PROFILE` or `--profile`, when
  given, names that same profile;
- refuses every other modified, staged, renamed or untracked path, and any
  path hidden from `git status` with skip-worktree or assume-unchanged;
- refuses a frontend in `build/` older than `src/buildProfile.json`, since it
  would carry the other network's name;
- checks the tree again before writing `out/`, and records `network_profile`,
  `source_commit`, `source_tree` and `build_profile_sha256` in the manifest.

`node scripts/mac-release-checks.cjs source [--profile swarm-mainnet]` answers
the same question before a long build. The unix workflow asks it as its last
step, after the same install and profile steps, so a regression shows in CI
rather than on the Mac. The macOS install hook (`set-resolutions-macos.js`)
restores `package.json` byte-for-byte; before 2026-09-27 it dropped the final
newline and left every Mac checkout dirty after `yarn install`
(`git checkout -- package.json` repairs a checkout made by an older commit).

## What `build-mac-distribution.js` does

1. Refuses to start unless it runs on an Apple-silicon Mac under native arm64
   Node 24, the notary profile works, no credentials are in the environment,
   exactly one Developer ID identity is selected, the tree passes the gate
   above, no previous output exists (unless `--resume`), the prerequisites exist
   (`build/electron.js`, `build/index.html`, `build/native.node`,
   `resources/nym-proxy`, `sdk-source/LICENSE`), the frontend is current, the
   addon and helper are the target architecture, and
   `check-swarm-sdk-pin.js --require-real-genesis` passes.
2. Runs electron-builder with `configs/swarm-mac-developer-id.cjs`: the identity,
   version, artwork and licences of `configs/swarm-builder.cjs`; hardened
   runtime and `configs/entitlements.swarm-mac.plist`; `forceCodeSigning`, so
   an identity electron-builder cannot find stops the build instead of falling
   back to an ad hoc signature (its default on arm64). `@electron/osx-sign`
   signs every binary in the bundle with a secure timestamp: `native.node`,
   `keytar.node`, the `nym-proxy` helper, the Electron frameworks, dylibs and
   helper apps. electron-builder then notarizes and staples the app.
3. The afterSign hook `scripts/verify-mac-signed-app.cjs` checks the notarized
   app before any DMG exists: Info.plist and the packaged `package.json` name
   the selected profile's app id, version and executable; the Rust addon and the
   Nym helper are present; **every Mach-O file** carries a Developer ID
   Application signature of the outer app's team with a secure timestamp, and
   every executable has the hardened runtime. `codesign --verify --deep` alone
   would pass an ad hoc signature.
4. Checks every Mach-O slice (`check-swarm-macho-arch.js`), then
   `codesign --verify --deep --strict`, `xcrun stapler validate` and
   `spctl --assess --type execute` on the app, and starts it once
   (`swarm-smoke.js`) unless `--skip-smoke`.
5. Submits the final DMG to notarytool, waits for Accepted, staples and
   validates it, and rebuilds the ZIP from the stapled app.

## Output

`dist-mac-signed/out/` (Apple silicon) and `dist-mac-signed-x64/out/` (Intel):

- `SWARM-Wallet-<version>-mac-<arch>.dmg` and `.zip`
- `SHA256SUMS-mac-<arch>`
- `release-manifest-mac-<arch>.json`: product, version, app id, network profile,
  platform, notary submission id, source commit and tree, build-profile hash,
  SDK commit, the Nym helper and addon hashes, and every file's size and hash.

The names say `mac`, because the plain `SWARM-Wallet-<version>-x64.zip` is the
Windows portable zip and both go on the same release. Upload them under exactly
these names; `SHA256SUMS-mac-<arch>` lists them.

If signing and packaging completed but a later check or DMG notarization
failed, fix the cause and rerun the same command with `--resume`. Resume
requires the generated app, DMG and ZIP, rechecks signatures and stapling, and
refuses output that already contains finalized release files. If the Mac has
no Rosetta, `--skip-smoke` skips only the local launch of the Intel app; say so
when handing the packages over, because the Intel runner job is then the only
launch.

## Before release

Install a **fresh browser download** of each DMG with default Gatekeeper
settings (the download must carry `com.apple.quarantine`) and verify
`codesign --verify --deep --strict`, `spctl --assess --type execute` and
`xcrun stapler validate` on the installed app, and `xcrun stapler validate` on
the DMG. The first launch must offer only "downloaded from the Internet …
Open". Then launch on a **disposable** wallet: the onboarding screen names the
network (SWARM Mainnet), a new wallet shows `swm1…` and `s1…` addresses
(testnet: `swarm1…`, and legacy `utest1…` is accepted), sync runs against
`lwd-main.swarm.green:443` (testnet: `lwd.swarm.green:443`), Send accepts an
`s1…` address, an existing profile is preserved, and no process remains after
quitting. Never fund the disposable wallet. Keep the unsigned `dist/` packages
as development artifacts only. Coordinate publication with the release owner.

## Intel verification on an Intel runner

Neither the owner's Mac nor CI's arm64 runners are Intel. Once the signed Intel
packages are on a **published** release in `Swarm-Official/swarm-releases`
(the job downloads with this repository's workflow token, which cannot see
another repository's drafts), dispatch:

```sh
gh workflow run swarm-wallet-unix.yml --repo Swarm-Official/privacy-wallet \
  --ref codex/mainnet-wallet-mainnet-20260925 \
  -f verify_signed_intel=true -f network_profile=swarm-mainnet \
  -f signed_intel_tag=swarm-wallet-<version>
```

The `verify-signed-intel` job runs on `macos-15-intel`. It selects the profile,
refuses a tag that is not `swarm-wallet-<the branch's version for that profile>`,
downloads `SWARM-Wallet-<version>-mac-x64.dmg` and `.zip`,
`SHA256SUMS-mac-x64` and `release-manifest-mac-x64.json`, and checks the
hashes and the manifest's version, app id and platform. It then runs
`hdiutil verify` and `xcrun stapler validate` on the DMG and mounts it
read-only. Against the app, it checks the Info.plist identifier and version,
runs `check-swarm-macho-arch.js mac-x64`, `codesign --verify --deep --strict`,
`spctl --assess --type execute` and `xcrun stapler validate`, loads the signed
`native.node` with `check-swarm-prefix-native.js`, and starts the exact signed
app from the image with `swarm-smoke.js`. Finally it unpacks the ZIP and
verifies that app's signature.
