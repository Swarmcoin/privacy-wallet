# The host as one file

`swarm-wallet-host.exe` is the same host as `../src/main.js`, with Node inside
it. It exists so that the wallet can be *shipped* rather than installed.

The `.cmd` launcher in `../bin` needs three things the SWARM Browser package
cannot carry: a Node the user installed, a `node.path` written by an installer,
and a registry value pointing at a manifest. The single-file host needs none of
them. Three files in one folder, anywhere:

```
swarm-wallet-host.exe          the host and the Node 22 runtime
native.node                    the wallet core, found because it is right here
green.swarm.wallet_host.json   the manifest, "path" naming the exe
```

Chromium also treats it better. `launch_context_win.cc` decides how to start a
native messaging host by the file extension and nothing else: `.exe` goes
through `LaunchNativeExeDirectly`, everything else through
`LaunchNativeHostViaCmd`. So the bundled host runs with no shell anywhere in
the pipe, and the class of failure the `.cmd` has to be careful about — a shell
printing one character onto the wire — cannot happen.

## Building it

Node 22 or newer, on Windows. esbuild and postject live outside this
repository, in the build folder, and nothing is installed globally:

```
cd D:/swarm-work/host-build
npm install esbuild postject

node browser/host/sea/build-sea.js
```

Options, all with sensible defaults: `--native <native.node>` (the wallet core
to ship), `--out <dir>` (default `D:/swarm-work/host-dist`), `--work <dir>`
(where esbuild and postject are, default `D:/swarm-work/host-build`).

It writes the three files above plus `SHA256SUMS.txt`, and prints the digests.
**The binary is not committed.** It is 80 MB of Node plus 78 MB of wallet core;
it is built here or by CI, and the hashes are how a copy is checked.

## What it does, in order

1. **esbuild** bundles `sea/entry.js` and everything it reaches into one
   CommonJS file. A SEA supports CommonJS only.
2. `node --experimental-sea-config` turns that file into a blob.
3. The running `node.exe` is copied to `swarm-wallet-host.exe`.
4. **postject** injects the blob under the resource name `NODE_SEA_BLOB` with
   the sentinel fuse `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`.
5. `native.node` and the manifest are written beside it, and everything is
   hashed.

`signtool remove /s` would strip the Node signature the copy has just
invalidated. The Windows SDK is not a build dependency here, so when it is
missing the step is skipped and postject says `the signature seems corrupted`.
The result is unsigned either way. Signing the release is a separate decision
(`docs/CODE-SIGNING-OPTIONS.md`).

## The two things a SEA changes, and where they are handled

**`require()` inside the executable resolves built-in modules only.** A file
path fails, and the wallet core is never anything but a file path. So
`../src/addon.js` loads it through `createRequire(__filename)`, which is
file-based. Running from source that is the same require it always was.

**`__filename` is `process.execPath`**, so `__dirname` is the executable's own
folder. `../src/paths.js` looks for `native.node` next to
`process.execPath` — second in its list, after `SWARM_WALLET_NATIVE`, which
`../README.md` promises beats everything and the end-to-end test relies on.
Running from source that candidate is Node's own installation folder, where the
core never is, so it costs one `existsSync` and changes no behaviour.

`sea/entry.js` exists for a third, duller reason: `src/main.js` starts itself
with `require.main === module`, which is false once a bundler has wrapped it,
so somebody has to call `main()`.

## Checking it

```
node browser/e2e/launcher-check.js --manifest D:/swarm-work/host-dist/green.swarm.wallet_host.json
```

`launcher-check.js` takes the same branch Chromium would for the path in the
manifest — directly for an `.exe`, through `cmd.exe` otherwise — sends one
framed `status` and reads the framed answer. It fails if anything that is not a
frame reaches stdout, and it fails if one request draws more than one answer,
which is what a bundle that started `main()` twice would do.

Verified on 2026-09-26 with Node 22.12.0: the host answered `core loaded`,
`SWARM Mainnet`, `device auth: available`, exit 0. Copied to a folder that had
never been installed or registered, with only `native.node` beside it, the log
said `core loaded from …\native.node` in that same folder.

## Where it goes

`swarm-browser`'s `swarm/install_swarm_assets.py` copies these three files to
`swarm/hosts/` in the build output, and `package.py` puts them in the portable
zip. `swarm/patches/swarm/swarm-native-host-lookup.patch` makes Chromium look
in `<directory of chrome.exe>\swarm\hosts\<host name>.json` when the registry
has no entry — which is why the packaged browser needs no install step at all.
The manifest is rewritten there to a relative `"path": "swarm-wallet-host.exe"`;
on Windows Chromium resolves a relative host path against the manifest's own
directory, so the folder can be moved without being rewritten.
