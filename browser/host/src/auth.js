"use strict";

/**
 * Device authentication, and the session it opens.
 *
 * The same mechanism the desktop wallet uses, called the same way: the addon
 * exports `checkWindowsHello` (a non-interactive availability probe) and
 * `verifyWindowsUser(reason)` (the Windows Hello consent dialog — face,
 * fingerprint or PIN), with `checkMacAuth` / `verifyMacUser` on macOS. Both are
 * raced against a timeout for the reason public/electron.js gives: a native
 * prompt that never returns used to strand the caller with no way forward.
 *
 * One difference from the desktop app, and it is deliberate. The desktop app
 * treats "device authentication is not available on this machine" as success,
 * so that a user without Hello enrolled still has a working Send button. This
 * host does the same for the SESSION unlock but says so in the answer
 * (`deviceAuth: "unavailable"`), so the extension can tell the user that the
 * only thing standing between an attacker at their keyboard and their coins is
 * the lock button. A wallet that silently claims a protection it does not have
 * is worse than one that admits it.
 */

const PROBE_TIMEOUT_MS = 3000;
const VERIFY_TIMEOUT_MS = 60000;

const withTimeout = (probe, fallback, ms) =>
  Promise.race([
    Promise.resolve().then(() => probe()),
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(fallback), ms);
      if (typeof t.unref === "function") t.unref();
    }),
  ]).catch(() => fallback);

/**
 * `check()` -> "available" | "not_supported" | some platform reason.
 * `verify(reason)` -> { success, deviceAuth: "verified" | "unavailable" }.
 */
function createAuth(addon, options = {}) {
  const probeMs = options.probeTimeoutMs || PROBE_TIMEOUT_MS;
  const verifyMs = options.verifyTimeoutMs || VERIFY_TIMEOUT_MS;

  const check = async () => {
    if (!addon) return "not_supported";
    if (process.platform === "win32" && typeof addon.checkWindowsHello === "function") {
      return withTimeout(() => addon.checkWindowsHello(), "not_supported", probeMs);
    }
    if (process.platform === "darwin" && typeof addon.checkMacAuth === "function") {
      return withTimeout(() => addon.checkMacAuth(), "not_supported", probeMs);
    }
    return "not_supported";
  };

  const verify = async (reason) => {
    const availability = await check();
    if (availability !== "available") {
      return { success: true, deviceAuth: "unavailable", availability };
    }
    const verifyFn =
      process.platform === "win32"
        ? () => addon.verifyWindowsUser(String(reason))
        : () => addon.verifyMacUser(String(reason));
    const result = await withTimeout(verifyFn, { success: false }, verifyMs);
    return { success: !!(result && result.success), deviceAuth: "verified", availability };
  };

  return { check, verify };
}

/**
 * The unlocked session: a deadline, pushed forward by use, never by the clock.
 *
 * Locking is not a formality here. While the session is locked the wallet is
 * not merely hidden — `deinitialize()` drops the LightClient, so the spending
 * keys are out of this process's memory until the next Hello.
 */
function createSession(options = {}) {
  const idleMs = options.idleTimeoutMs != null ? options.idleTimeoutMs : 5 * 60 * 1000;
  const now = options.now || (() => Date.now());
  let deadline = 0;

  return {
    idleMs,
    open() {
      deadline = now() + idleMs;
    },
    close() {
      deadline = 0;
    },
    isOpen() {
      return deadline > now();
    },
    /** Pushes the deadline out, but only for a session that is still open. */
    touch() {
      if (deadline > now()) deadline = now() + idleMs;
    },
    /** Whole seconds left, for the popup's "locks in 4:12". */
    secondsLeft() {
      const left = deadline - now();
      return left > 0 ? Math.ceil(left / 1000) : 0;
    },
  };
}

module.exports = { createAuth, createSession, PROBE_TIMEOUT_MS, VERIFY_TIMEOUT_MS };
