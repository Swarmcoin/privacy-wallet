"use strict";

/**
 * Where the host keeps its wallet, and where it finds the wallet core.
 *
 * The browser wallet stores its files somewhere the desktop wallet never
 * looks, and the reverse. Two applications sharing one wallet file would have
 * two processes holding the same sled database, and the second one loses.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

/** `%LOCALAPPDATA%/Swarm/SWARM Browser Wallet`, or the platform's equivalent. */
function walletBaseDir() {
  if (process.env.SWARM_BROWSER_WALLET_DIR) return process.env.SWARM_BROWSER_WALLET_DIR;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "Swarm", "SWARM Browser Wallet");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "SWARM Browser Wallet");
  }
  return path.join(os.homedir(), ".local", "share", "swarm-browser-wallet");
}

/** The wallet file name inside the chain's folder. One wallet, one name. */
const WALLET_FILE_NAME = "swarm-browser-wallet.dat";

/**
 * The places the compiled wallet core may be, in the order they are tried.
 *
 * The addon is a 78 MB binary produced by the wallet's own CI. It is not
 * copied into this repository and not committed: the host is told where it is.
 *  1. `SWARM_WALLET_NATIVE` — a full path, for a test run or a developer.
 *  2. `native.path` next to the host — one line, written by the installer.
 *  3. `vendor/native.node` next to the host — a copy placed there by hand.
 *  4. the installed desktop SWARM Wallet, whose addon is the same file.
 */
function addonCandidates(hostRoot) {
  const out = [];
  if (process.env.SWARM_WALLET_NATIVE) out.push(process.env.SWARM_WALLET_NATIVE);
  const pointer = path.join(hostRoot, "native.path");
  try {
    const line = fs.readFileSync(pointer, "utf8").split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("#"));
    if (line) out.push(line.trim());
  } catch (_) {
    /* no pointer file: the next candidates still apply */
  }
  out.push(path.join(hostRoot, "vendor", "native.node"));
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    for (const dir of [
      path.join(local, "Programs", "swarm-wallet-mainnet"),
      path.join(local, "Programs", "SWARM Wallet"),
      path.join(programFiles, "SWARM Wallet"),
    ]) {
      out.push(path.join(dir, "resources", "app.asar.unpacked", "build", "native.node"));
    }
  }
  return out;
}

/** The first candidate that exists, or null. */
function findAddon(hostRoot) {
  for (const candidate of addonCandidates(hostRoot)) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {
      /* an unreadable candidate is simply not the one */
    }
  }
  return null;
}

/**
 * Creates the wallet folder if it is missing, and on Windows takes the
 * inherited ACL off it so only this user (and administrators) can read it.
 *
 * This is the same protection the desktop wallet has and no more: the wallet
 * FILE ITSELF IS NOT ENCRYPTED. `browser/README.md` says so plainly, because a
 * folder permission is not a passphrase and must not be sold as one.
 */
function ensureWalletDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { walletBaseDir, WALLET_FILE_NAME, addonCandidates, findAddon, ensureWalletDir };
