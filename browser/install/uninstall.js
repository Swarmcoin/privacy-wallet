"use strict";

/**
 * Removes exactly what `install.js` added: one HKEY_CURRENT_USER registry key
 * per browser, and the two path files the host reads.
 *
 * It does not remove the wallet. Deleting somebody's wallet folder from an
 * uninstall script is how people lose coins; the folder is named here so they
 * can decide for themselves.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOST_NAME = "green.swarm.wallet_host";
const HOST_DIR = path.join(__dirname, "..", "host");

const KEYS = [
  ["Google Chrome", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Microsoft Edge", `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Chromium / ungoogled-chromium", `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`],
  ["Brave", `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`],
  ["SWARM Browser", `HKCU\\Software\\Swarm\\SWARM Browser\\NativeMessagingHosts\\${HOST_NAME}`],
];

const say = (line) => process.stdout.write(`${line}\n`);

say("SWARM Browser Wallet — removing the developer install");
say("");
for (const [label, key] of KEYS) {
  try {
    execFileSync("reg", ["delete", key, "/f"], { stdio: "pipe" });
    say(`    removed   ${label}`);
  } catch (_) {
    say(`    not there ${label}`);
  }
}

for (const file of [path.join(HOST_DIR, "bin", "node.path"), path.join(HOST_DIR, "native.path")]) {
  try {
    fs.unlinkSync(file);
    say(`    removed   ${file}`);
  } catch (_) {
    /* already gone */
  }
}

let walletDir = "%LOCALAPPDATA%\\Swarm\\SWARM Browser Wallet";
try {
  walletDir = require(path.join(HOST_DIR, "src", "paths.js")).walletBaseDir();
} catch (_) {
  /* the default name above is close enough to point at */
}

say("");
say("  The extension itself is removed from the browser's Extensions page.");
say("  Your wallet was NOT deleted. It is in:");
say(`      ${walletDir}`);
say("  Delete that folder yourself only if you have your recovery phrase written down.");
