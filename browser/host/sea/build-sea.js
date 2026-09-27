"use strict";

/**
 * Builds `swarm-wallet-host.exe` — the wallet host as one file, with no Node
 * to install and no .cmd to register.
 *
 * Why this exists: today the host manifest points at
 * `bin/swarm-wallet-host.cmd`, which reads `bin/node.path` and runs a Node the
 * user installed. That is three moving parts and one prerequisite, and the
 * SWARM Browser package can carry none of them. A Node 22 Single Executable
 * Application is Node's own answer: the runtime and the script in one .exe,
 * which Chromium then launches DIRECTLY rather than through cmd.exe
 * (`launch_context_win.cc`, `LaunchNativeExeDirectly` is used for ".exe" and
 * only for ".exe"), so there is no shell in the pipe at all.
 *
 * The result is a folder of three files that can sit anywhere:
 *
 *     swarm-wallet-host.exe          the host and the Node runtime
 *     native.node                    the wallet core, found because it is here
 *     green.swarm.wallet_host.json   the manifest, path pointing at the exe
 *
 * Two facts about a SEA that the host source has to respect, and does:
 *
 *  - **The script must be one CommonJS file.** ESM is not supported, and
 *    `require()` inside the injected script resolves built-in modules only.
 *    esbuild bundles `sea/entry.js` and everything it reaches into one CJS
 *    file; `src/addon.js` loads the wallet core through
 *    `createRequire(__filename)`, which is file-based and therefore works.
 *  - **`__dirname` is the executable's folder**, because `__filename` is
 *    `process.execPath`. `src/paths.js` looks for `native.node` next to the
 *    program, so the exe finds the core with nothing configured.
 *
 *     node browser/host/sea/build-sea.js [--native <native.node>]
 *                                        [--out <dir>] [--work <dir>]
 *
 * It downloads nothing and installs nothing: esbuild and postject must already
 * be in `--work`. It never signs the result; `signtool` is used only to strip
 * the signature Node's own build carries, and is skipped when absent (postject
 * warns and injects anyway).
 */

const { createHash } = require("crypto");
const { createRequire } = require("module");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOST_DIR = path.resolve(__dirname, "..");
const HOST_NAME = "green.swarm.wallet_host";
const EXTENSION_ID = "gmmgmodmgnigcgboccjelpgedejejfap";
const EXE_NAME = "swarm-wallet-host.exe";

// The sentinel postject rewrites to mark the blob as injected. It is a
// constant of the Node SEA format, not a choice.
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const DEFAULTS = {
  native: "D:/swarm-work/native-mainnet2/native.node",
  out: "D:/swarm-work/host-dist",
  work: "D:/swarm-work/host-build",
};

const say = (line) => process.stdout.write(`${line}\n`);

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in DEFAULTS)) throw new Error(`unknown option ${argv[i]}`);
    if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`);
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** esbuild and postject, from --work. Absent is an instruction, not a stack trace. */
function loadTools(work) {
  const workRequire = createRequire(path.join(work, "package.json"));
  try {
    return { esbuild: workRequire("esbuild"), postject: path.join(work, "node_modules", ".bin", "postject.cmd") };
  } catch (e) {
    throw new Error(
      `esbuild is not in ${work}: ${e && e.message}\n` +
        `Install the two build tools there first (nothing is installed globally):\n` +
        `    cd ${work} && npm install esbuild postject`,
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const work = path.resolve(args.work);
  const out = path.resolve(args.out);
  const native = path.resolve(args.native);

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node 22 or newer is required to build a SEA; this is ${process.versions.node}`);
  if (process.platform !== "win32") throw new Error("this script builds the Windows host");
  if (!fs.existsSync(native)) throw new Error(`the wallet core is not at ${native} — pass --native`);

  const { esbuild, postject } = loadTools(work);
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  // 1. One CommonJS file. `platform: "node"` keeps the built-ins external,
  //    which is what a SEA can still require.
  const bundle = path.join(work, "swarm-wallet-host.bundle.js");
  say("bundling the host into one CommonJS file");
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "entry.js")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: bundle,
    legalComments: "none",
  });
  say(`  ${bundle}  (${fs.statSync(bundle).size} bytes)`);

  // 2. The blob. `useCodeCache` would forbid dynamic import(), which the host
  //    does not use, but it also ties the blob to this exact Node build for no
  //    gain worth the coupling on a program that runs for seconds.
  const config = path.join(work, "sea-config.json");
  const blob = path.join(work, "swarm-wallet-host.blob");
  fs.writeFileSync(
    config,
    `${JSON.stringify(
      {
        main: bundle,
        output: blob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  say("generating the SEA blob");
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });

  // 3. A copy of this Node, with the blob injected into it.
  const exe = path.join(out, EXE_NAME);
  say(`copying ${process.execPath}`);
  fs.copyFileSync(process.execPath, exe);
  try {
    execFileSync("signtool", ["remove", "/s", exe], { stdio: "pipe" });
    say("  signtool removed Node's signature");
  } catch (_) {
    // The Windows SDK is not a build dependency of this project. postject
    // warns about the signature and injects regardless; the result is
    // unsigned either way, which is what the release signing step is for.
    say("  signtool not available — the copy keeps Node's now-invalid signature");
  }
  say("injecting the blob");
  execFileSync(postject, [exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SENTINEL_FUSE], {
    stdio: "inherit",
    shell: true,
  });

  // 4. The two files that travel with it.
  const core = path.join(out, "native.node");
  fs.copyFileSync(native, core);
  const manifestPath = path.join(out, `${HOST_NAME}.json`);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        name: HOST_NAME,
        description: "SWARM Wallet host. Holds the wallet keys outside the browser.",
        path: exe,
        type: "stdio",
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  // 5. What was built, so a later copy can be checked against it.
  const sums = [exe, core, manifestPath]
    .map((file) => `${sha256(file)}  ${path.basename(file)}`)
    .join("\n");
  fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), `${sums}\n`, "utf8");

  say("");
  say(`built in ${out}`);
  say(sums.replace(/^/gm, "  "));
  say("");
  say("check it the way Chromium starts it:");
  say(`    node ${path.join(HOST_DIR, "..", "e2e", "launcher-check.js")} --manifest "${manifestPath}"`);
}

try {
  main();
} catch (e) {
  process.stderr.write(`${(e && e.message) || e}\n`);
  process.exit(1);
}
