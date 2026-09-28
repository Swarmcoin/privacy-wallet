# SWARM Wallet universal Mac release

## Package

- Version: `0.1.0-mainnet.8`
- App ID: `green.swarm.wallet`
- App source: `ff7c5fa141d038beae8fd4c109c234f2ba9b8348`
- Assembler source: `b9db2d91e1b401e5d8add67170421bc26fca4be1`
- SDK: `c7464d2ec40a5d619500a9ebee76ac4c39775baa`
- Architectures: Apple silicon and Intel in every native component
- Minimum macOS: 12
- Developer ID: S4FE AG, team `SAZ99S3T4C`

The two input archives came from successful
[build 36361910351](https://github.com/Swarm-Official/privacy-wallet/actions/runs/36361910351).
The assembler verified their source, checksums, mainnet profile, Cargo lockfile,
SDK pin and genesis before merging them.

The old mainnet.2 arm64 download matched its published checksum. Its outer
signature failed with `code has no resources but signature indicates they
must be present`. The replacement carries Developer ID signatures on all 18
Mach-O files, with secure timestamps and the hardened runtime on executables.

## Apple results

| Submission | ID | Result |
| --- | --- | --- |
| App | `ad2bd53b-9eff-4e26-8744-1d099093d689` | Accepted |
| DMG | `d6107d28-1878-49db-afaa-81291aa0daf4` | Accepted |

Both tickets are stapled and validated. Gatekeeper reports
`source=Notarized Developer ID`. The final disk image passes `hdiutil verify`.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| Universal DMG | 400531755 | `6148d0b93fdb6376f025e52e9940d71bb556eb553e941bef29bfda82ae4b1af9` |
| Universal ZIP | 375578415 | `21e9dc7bad24093c5975e958bcaf9dcfd540b567b2ca303851506dbd03760efd` |

## Runtime checks

The Apple silicon check used a disposable HOME and Electron profile. Wallet
creation completed against `https://lwd-main.swarm.green:8443`. The native
server check returned `swarm-mainnet` and genesis
`01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd`.

Receive showed `swm1` shielded and `s1` transparent addresses. Send accepted
both address types and displayed the transparent disclosure. The zero balance
kept payment confirmation disabled. Native scanning started. Restart reopened
the same wallet with unchanged receive addresses. Funded transfers remain a
tester check.

Source CI passed 132 suites and 1,757 tests, with three skipped tests. The 19
Mac release checks passed. All 18 native files contain `arm64` and `x86_64`.

The [Intel verification](https://github.com/Swarm-Official/privacy-wallet/actions/runs/36376255211)
passed. It downloaded the published DMG and ZIP, checked their hashes and
tickets, loaded the signed native wallet library and launched the app on
`macos-15-intel`. The app reached its device authentication screen.

A fresh public HTTPS download matched the DMG checksum. Quarantine was enabled
on the download and installed app. Gatekeeper accepted the app, and macOS
showed the normal first-launch confirmation that Apple had checked it for
malicious software. Opening it reached the mainnet welcome screen using a
disposable profile. The verified app is installed at
`/Applications/SWARM Wallet.app`.

Chrome's release navigation returned a client block. Browser policy also
blocked its internal Downloads page. The fresh public download and quarantine
test used the command line, with the launch confirmation checked through the
native macOS UI.

## Publication

The release tag is `swarm-wallet-0.1.0-mainnet.8-macos` in
`Swarm-Official/swarm-releases`. It contains one app in DMG and ZIP formats,
the checksums and the release manifest. GitHub's SHA-256 digests and sizes
match all four local files.

The release is [published](https://github.com/Swarm-Official/swarm-releases/releases/tag/swarm-wallet-0.1.0-mainnet.8-macos).
The [wallet page](https://swarm.green/ecosystem/wallet) has one primary Mac
download and an optional ZIP archive of the same app. The website commit is
`95f1ebe`, and Vercel deployment `dpl_AVjxBjyQZBo8EKD7QWiaWmvYeJvJ` is READY in
production. The live download data, home page, wallet page, ecosystem overview
and roadmap match the committed files byte for byte. All 68 download URLs
resolve. Desktop and mobile browser checks passed.
