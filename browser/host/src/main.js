"use strict";

/**
 * swarm-wallet-host — the SWARM wallet, outside the browser.
 *
 * Chromium starts this process, hands it one pipe for stdin and one for
 * stdout, and connects them to a single extension port. There is no socket, no
 * listening service and no second client: when the browser closes the port,
 * stdin ends and this process exits, taking the opened wallet with it.
 *
 * Nothing here writes to stdout except framed messages. A stray `console.log`
 * would be read by Chromium as a length prefix and kill the port, so the log
 * goes to stderr, which Chromium discards, and to a file only when
 * SWARM_HOST_LOG is set.
 */

const fs = require("fs");
const path = require("path");

const { FrameReader, encodeMessage, MAX_INBOUND_BYTES } = require("./framing");
const { loadAddon, loadFailure, addonPath } = require("./addon");
const { createAuth, createSession } = require("./auth");
const { createRouter, HOST_VERSION } = require("./router");
const { walletBaseDir, WALLET_FILE_NAME, ensureWalletDir } = require("./paths");
const { DEFAULT_NETWORK_ID } = require("./networks");

const HOST_ROOT = path.join(__dirname, "..");

/**
 * The log.
 *
 * Never a seed, never a key, never a memo, never an address the user has not
 * already published — the router hands this function command names and error
 * codes and nothing else, and everything here is a line, not an object, so a
 * future caller cannot pass a payload by accident.
 */
function createLog() {
  const file = process.env.SWARM_HOST_LOG;
  return (line) => {
    const text = `${new Date().toISOString()} swarm-wallet-host ${String(line)}\n`;
    try {
      process.stderr.write(text);
    } catch (_) {
      /* stderr can be closed; the host keeps running */
    }
    if (file) {
      try {
        fs.appendFileSync(file, text);
      } catch (_) {
        /* a log that cannot be written is not a reason to fail a payment */
      }
    }
  };
}

function main() {
  const log = createLog();
  log(`start version=${HOST_VERSION} node=${process.versions.node} pid=${process.pid}`);

  const dir = ensureWalletDir(walletBaseDir());
  const addon = loadAddon(HOST_ROOT);
  log(addon ? `core loaded from ${addonPath()}` : `core NOT loaded: ${loadFailure() && loadFailure().message}`);

  const idleMinutes = Number(process.env.SWARM_HOST_IDLE_MINUTES);
  const session = createSession({
    idleTimeoutMs: Number.isFinite(idleMinutes) && idleMinutes > 0 ? idleMinutes * 60 * 1000 : 5 * 60 * 1000,
  });
  const router = createRouter({
    addon,
    auth: createAuth(addon),
    session,
    log,
    loadFailure,
    walletBaseDir: dir,
    walletFileName: WALLET_FILE_NAME,
    networkId: process.env.SWARM_HOST_NETWORK || DEFAULT_NETWORK_ID,
  });

  const reader = new FrameReader({ maxBytes: MAX_INBOUND_BYTES });

  const write = (message) => {
    try {
      process.stdout.write(encodeMessage(message));
    } catch (e) {
      // The only way a reply can be too large is a history longer than 1 MB.
      // Answering with the refusal keeps the port alive; writing the oversized
      // frame would not.
      if (e && e.code === "message_too_large") {
        log(`reply too large for id=${message && message.id}`);
        try {
          process.stdout.write(
            encodeMessage({
              id: message && message.id,
              ok: false,
              error: { code: "reply_too_large", message: "That answer is too large to send to the browser." },
            }),
          );
        } catch (_) {
          /* nothing more can be done on this port */
        }
      } else {
        log(`write failed: ${e && e.message}`);
      }
    }
  };

  /**
   * Requests are answered in the order they arrive.
   *
   * The wallet core takes a global lock, so two commands in flight would queue
   * inside the addon anyway — but a `send` overtaking the `wallet.lock` that
   * was meant to precede it is not a race worth having.
   */
  let queue = Promise.resolve();
  const enqueue = (request) => {
    queue = queue.then(async () => {
      const answer = await router.handle(request);
      write(answer);
    });
    queue.catch((e) => log(`dispatch failed: ${e && e.message}`));
  };

  process.stdin.on("data", (chunk) => {
    reader.push(chunk);
    for (const frame of reader.read()) {
      if (frame.ok) enqueue(frame.value);
      else write({ id: null, ok: false, error: { code: frame.code, message: frame.message } });
    }
    if (reader.fatal) {
      log(`fatal framing error: ${reader.fatal.code}`);
      write({ id: null, ok: false, error: reader.fatal });
      shutdown(2);
    }
  });

  let shuttingDown = false;
  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutdown code=${code}`);
    // The wallet is saved and the keys dropped before the process goes, so a
    // closed browser window is not a wallet left open in memory.
    queue
      .then(() => router.shutdown())
      .catch(() => {})
      .then(() => process.exit(code));
    // A core that hangs on save must not keep the process alive for ever.
    const bail = setTimeout(() => process.exit(code), 10000);
    if (typeof bail.unref === "function") bail.unref();
  }

  process.stdin.on("end", () => shutdown(0));
  process.stdin.on("close", () => shutdown(0));
  process.stdin.on("error", (e) => {
    log(`stdin error: ${e && e.message}`);
    shutdown(1);
  });
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  process.on("uncaughtException", (e) => {
    log(`uncaught: ${e && e.message}`);
    shutdown(1);
  });

  process.stdin.resume();
}

if (require.main === module) main();

module.exports = { main };
