"use strict";

/**
 * Loading the wallet core.
 *
 * The core is the same N-API addon the desktop SWARM Wallet runs
 * (`zingolib-native`, Neon, `crate-type = cdylib`). Because it is N-API and not
 * a NODE_MODULE_VERSION-bound binding, system Node loads the very file Electron
 * loads — no rebuild, no second toolchain, and no second wallet implementation
 * to keep in step with the first.
 *
 * The load error is kept rather than discarded, for the reason electron.js
 * gives: when the addon fails to load, every caller fails separately with a
 * message that does not name the cause, and the wallet looks frozen instead of
 * broken.
 */

const path = require("path");
const { createRequire } = require("module");
const { findAddon } = require("./paths");

/**
 * The addon is loaded with an explicit `createRequire`, not with the bare
 * `require` above.
 *
 * Running from source the two are the same thing. In the single-file build
 * (`sea/`) they are not: inside a Node single executable the injected script's
 * `require` resolves BUILT-IN MODULES ONLY, and the wallet core is never
 * anything but a file path, so it would fail before the addon was ever opened.
 * `createRequire(__filename)` gives back a file-based require. In the
 * executable `__filename` is `process.execPath` — an absolute path — so it
 * resolves next to the executable, which is exactly where native.node ships.
 */
const requireNative = createRequire(__filename);

let cached = null;
let cachedPath = null;
let loadError = null;

/** The addon, or null. `loadFailure()` says why when it is null. */
function loadAddon(hostRoot) {
  if (cached || loadError) return cached;
  const root = hostRoot || path.join(__dirname, "..");
  const found = findAddon(root);
  if (!found) {
    loadError = new Error(
      "The SWARM wallet core (native.node) was not found. Run the installer, or set SWARM_WALLET_NATIVE to its full path.",
    );
    return null;
  }
  try {
    cached = requireNative(found);
    cachedPath = found;
  } catch (e) {
    loadError = new Error(`The SWARM wallet core at ${found} could not be loaded: ${e && e.message}`);
  }
  return cached;
}

const loadFailure = () => loadError;
const addonPath = () => cachedPath;

/** Resets the module for a test. Never called by the host itself. */
function resetForTest() {
  cached = null;
  cachedPath = null;
  loadError = null;
}

module.exports = { loadAddon, loadFailure, addonPath, resetForTest };
