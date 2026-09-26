"use strict";

/**
 * Registers `swarm-wallet-host` with the Chromium-based browsers on this
 * machine, for the current user only.
 *
 * What it writes, and nothing else:
 *  - `browser/install/green.swarm.wallet_host.json`, the native-messaging host
 *    manifest, with this checkout's absolute path to the launcher.
 *  - `browser/host/bin/node.path`, one line: the Node executable to run.
 *  - `browser/host/native.path`, one line: where the wallet core is.
 *  - one HKEY_CURRENT_USER registry value per browser, whose only content is
 *    the path of that manifest.
 *
 * It installs nothing, downloads nothing, starts nothing and touches no
 * machine-wide setting. `uninstall.js` removes exactly the registry values
 * this wrote.
 *
 * The registry locations are the ones Chromium 153 actually reads
 * (chrome/browser/extensions/api/messaging/launch_context_win.cc, read
 * 2026-09-26): HKEY_CURRENT_USER is searched before HKEY_LOCAL_MACHINE, a
 * Chromium-branded build tries `SOFTWARE\Chromium\NativeMessagingHosts` and
 * then falls back to `SOFTWARE\Google\Chrome\NativeMessagingHosts`, and both
 * the 32-bit and 64-bit views are tried. Edge's own key is Microsoft's
 * documented one and is not in that file.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOST_NAME = "green.swarm.wallet_host";
const EXTENSION_ID = "gmmgmodmgnigcgboccjelpgedejejfap";

const INSTALL_DIR = __dirname;
const BROWSER_DIR = path.join(INSTALL_DIR, "..");
const HOST_DIR = path.join(BROWSER_DIR, "host");
const EXTENSION_DIR = path.join(BROWSER_DIR, "extension");
const LAUNCHER = path.join(HOST_DIR, "bin", "swarm-wallet-host.cmd");
const MANIFEST_PATH = path.join(INSTALL_DIR, `${HOST_NAME}.json`);

/**
 * Where each browser looks. The last one is this project's own browser, whose
 * key follows its BRANDING file; it does not exist yet, and registering it now
 * costs one registry value and saves an install step later.
 */
const REGISTRY_KEYS = [
  ["Google Chrome", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Microsoft Edge", `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Chromium / ungoogled-chromium", `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Brave", `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`],
  ["SWARM Browser (not built yet)", `HKCU\\Software\\Swarm\\SWARM Browser\\NativeMessagingHosts\\${HOST_NAME}`],
];

const say = (line) => process.stdout.write(`${line}\n`);

function findNativeCore(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`--native ${explicit} does not exist`);
    return explicit;
  }
  const { findAddon } = require(path.join(HOST_DIR, "src", "paths.js"));
  return findAddon(HOST_DIR);
}

function writeLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${line}\n`, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  const nativeFlag = args.indexOf("--native");
  const explicitNative = nativeFlag >= 0 ? args[nativeFlag + 1] : null;

  say("SWARM Browser Wallet — developer install");
  say("");

  if (!fs.existsSync(LAUNCHER)) {
    say(`  ERROR: the host launcher is missing: ${LAUNCHER}`);
    process.exit(1);
  }

  // 1. Which Node runs the host. `process.execPath` is the Node running this
  //    script, which is the one the person just used, so it is the one that
  //    exists.
  writeLine(path.join(HOST_DIR, "bin", "node.path"), process.execPath);
  say(`  Node:            ${process.execPath}`);

  // 2. Where the wallet core is.
  let core = null;
  try {
    core = findNativeCore(explicitNative);
  } catch (e) {
    say(`  ERROR: ${e.message}`);
    process.exit(1);
  }
  if (core) {
    writeLine(path.join(HOST_DIR, "native.path"), core);
    say(`  Wallet core:     ${core}`);
  } else {
    say("  Wallet core:     NOT FOUND");
    say("");
    say("  The host needs native.node, the wallet core the desktop SWARM Wallet ships.");
    say("  Install SWARM Wallet, or run this again with:");
    say("      --native \"<full path to native.node>\"");
    say("  The extension will install anyway; the popup will say the core is missing.");
  }

  // 3. The host manifest. `allowed_origins` names one extension and no other,
  //    so no web page and no other extension can reach the wallet.
  const manifest = {
    name: HOST_NAME,
    description: "SWARM Wallet host. Holds the wallet keys outside the browser.",
    path: LAUNCHER,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  say(`  Host manifest:   ${MANIFEST_PATH}`);
  say(`  Launcher:        ${LAUNCHER}`);
  say(`  Extension id:    ${EXTENSION_ID}`);
  say("");

  // 4. One registry value per browser, HKCU only.
  say("  Registering with the browsers (current user only):");
  for (const [label, key] of REGISTRY_KEYS) {
    try {
      execFileSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", MANIFEST_PATH, "/f"], { stdio: "pipe" });
      say(`    ok    ${label}`);
    } catch (e) {
      say(`    FAILED ${label}: ${String((e && e.message) || e).split("\n")[0]}`);
    }
  }

  say("");
  say("  Now load the extension:");
  say("    1. Open edge://extensions  (or chrome://extensions)");
  say("    2. Turn on Developer mode");
  say("    3. Click 'Load unpacked'");
  say(`    4. Choose this folder:  ${EXTENSION_DIR}`);
  say("    5. Click the SWARM Wallet icon in the toolbar");
  say("");
  say("  To remove the registry entries again, run 'Uninstall SWARM Browser Wallet (dev).cmd'.");
}

main();
