"use strict";

/**
 * End-to-end: the real host, the real wallet core, the real SWARM mainnet.
 *
 * Drives `swarm-wallet-host` exactly as Chromium does — a child process, framed
 * JSON on stdin and stdout — with no browser involved. It creates a DISPOSABLE
 * wallet in a throwaway folder, asks for its address, syncs for a bounded time
 * and reports the height it reached.
 *
 * What it will not do:
 *  - print, store or pass on the seed phrase. It counts the words and throws
 *    the phrase away; the wallet folder it creates is deleted at the end unless
 *    --keep is given.
 *  - touch the owner's wallet. The folder comes from SWARM_BROWSER_WALLET_DIR,
 *    which is set here to a fresh directory under the work area.
 *  - call `wallet.unlock` or `send`. Both ask Windows Hello, and a test must
 *    not put a consent dialog in front of someone who is not there.
 *
 * Usage:  node browser/e2e/e2e-mainnet.js [--seconds 90] [--keep] [--testnet]
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { FrameReader, encodeMessage } = require("../host/src/framing");

const HOST_ENTRY = path.join(__dirname, "..", "host", "src", "main.js");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SYNC_SECONDS = Number(value("--seconds", "90"));
const KEEP = flag("--keep");
const NETWORK = flag("--testnet") ? "swarm-testnet" : "swarm-mainnet";

class HostClient {
  constructor(env) {
    this.child = spawn(process.execPath, [HOST_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, env),
    });
    this.reader = new FrameReader();
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = [];
    this.child.stdout.on("data", (chunk) => {
      this.reader.push(chunk);
      for (const frame of this.reader.read()) {
        if (!frame.ok) continue;
        const answer = frame.value;
        const resolve = this.pending.get(answer.id);
        if (resolve) {
          this.pending.delete(answer.id);
          resolve(answer);
        }
      }
    });
    this.child.stderr.on("data", (c) => this.stderr.push(String(c)));
    this.exited = new Promise((resolve) => this.child.on("exit", (code) => resolve(code)));
  }

  ask(command, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(encodeMessage({ id, command, params: params || {} }), (e) => {
        if (e) reject(e);
      });
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${command} did not answer within 120s`));
      }, 120000);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  closeStdin() {
    this.child.stdin.end();
  }
}

const ok = (answer, what) => {
  if (!answer.ok) throw new Error(`${what} failed: ${answer.error.code} — ${answer.error.message}`);
  return answer.result;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const walletDir = path.join(process.env.SWARM_E2E_ROOT || path.join("D:", "swarm-work", "e2e"), `wallet-${stamp}`);
  fs.mkdirSync(walletDir, { recursive: true });

  const report = { network: NETWORK, walletDir, steps: [], startedAt: new Date().toISOString() };
  const step = (name, detail) => {
    report.steps.push({ name, detail });
    process.stdout.write(`  ${name}: ${detail}\n`);
  };

  process.stdout.write(`SWARM browser wallet host — end-to-end against ${NETWORK}\n`);
  process.stdout.write(`  disposable wallet folder: ${walletDir}\n`);

  const client = new HostClient({
    SWARM_BROWSER_WALLET_DIR: walletDir,
    SWARM_HOST_NETWORK: NETWORK,
  });

  let failure = null;
  try {
    const status = ok(await client.ask("status"), "status");
    if (status.core !== "loaded") throw new Error(`the wallet core did not load: ${status.coreError}`);
    step("host", `version ${status.hostVersion} on Node ${status.node}`);
    step("network", `${status.network.displayName} via ${status.network.server}, genesis ${String(status.network.genesis).slice(0, 12)}…`);
    report.genesis = status.network.genesis;
    step("indexer height", status.serverHeight === null ? `unreachable: ${status.serverError}` : String(status.serverHeight));
    report.serverHeight = status.serverHeight;
    report.deviceAuth = status.deviceAuth;
    step("device auth", String(status.deviceAuth));

    const exists = ok(await client.ask("wallet.exists"), "wallet.exists");
    if (exists.exists) throw new Error("the disposable folder already holds a wallet; refusing to continue");
    step("wallet.exists", "false, as it must be in a fresh folder");

    const created = ok(await client.ask("wallet.create"), "wallet.create");
    // The seed is counted and dropped here. It is never printed and never stored.
    const words = String(created.seed).trim().split(/\s+/).length;
    if (words !== 24) throw new Error(`expected a 24-word seed, got ${words} words`);
    step("wallet.create", `a new wallet, seed of ${words} words (not shown), birthday ${created.birthday}`);
    report.birthday = created.birthday;
    if (NETWORK === "swarm-mainnet") {
      // Host 0.2.0: a new wallet is recorded with the genesis it was made on,
      // so it is never mistaken for one made before the network restart.
      const recordFile = path.join(walletDir, "swarm-mainnet", "swarm-browser-wallet.dat.record.json");
      const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
      if (record.genesis !== status.network.genesis) {
        throw new Error(`the wallet record names genesis ${record.genesis}, not ${status.network.genesis}`);
      }
      report.recordGenesis = record.genesis;
      step("wallet record", `genesis ${record.genesis.slice(0, 12)}… written beside the wallet file`);
      const after = ok(await client.ask("status"), "status");
      if (after.chainRestartPending) throw new Error("a wallet made now is reported as needing the restart move");
    }

    const addresses = ok(await client.ask("addresses"), "addresses");
    const unified = String(addresses.unified || "");
    report.addressPrefix = unified.slice(0, 4);
    report.transparentPrefix = String(addresses.transparent || "").slice(0, 2);
    step("addresses", `unified starts ${report.addressPrefix}…, transparent starts ${report.transparentPrefix}…`);
    const expectedHrp = NETWORK === "swarm-mainnet" ? "swm1" : "swarm";
    if (!unified.toLowerCase().startsWith(expectedHrp)) {
      throw new Error(`unified address does not start with ${expectedHrp}: it starts ${report.addressPrefix}`);
    }
    if (!addresses.unifiedMatchesNetwork) throw new Error("the address does not belong to the selected network");

    const balance = ok(await client.ask("balance"), "balance");
    step("balance", `${balance.total} ${balance.ticker} (a new wallet holds nothing)`);

    ok(await client.ask("sync.start"), "sync.start");
    step("sync.start", "accepted");
    const deadline = Date.now() + SYNC_SECONDS * 1000;
    let last = null;
    while (Date.now() < deadline) {
      await sleep(3000);
      last = ok(await client.ask("sync.status"), "sync.status");
      process.stdout.write(
        `    sync: ${last.syncedBlocks ?? "?"} blocks scanned (${last.percentage ?? "?"}%), wallet height ${last.walletHeight ?? "?"}${last.inProgress ? "" : " — finished"}\n`,
      );
      if (!last.inProgress && last.walletHeight) break;
    }
    report.syncedHeight = last && last.walletHeight;
    report.syncInProgress = !!(last && last.inProgress);
    report.syncLastError = last && last.lastError;
    step("sync", `wallet height ${report.syncedHeight ?? "unknown"} after ${SYNC_SECONDS}s${report.syncInProgress ? " (still running)" : ""}`);

    const history = ok(await client.ask("history"), "history");
    step("history", `${history.transfers.length} value transfers`);
    report.transfers = history.transfers.length;

    ok(await client.ask("wallet.lock"), "wallet.lock");
    step("wallet.lock", "session closed and the core deinitialised");

    const locked = await client.ask("balance");
    if (locked.ok || locked.error.code !== "locked") throw new Error("balance answered while locked");
    step("locked check", "balance is refused with 'locked' after locking");
  } catch (e) {
    failure = e;
  }

  client.closeStdin();
  const exitCode = await Promise.race([client.exited, sleep(15000).then(() => "timeout")]);
  report.hostExit = exitCode;
  process.stdout.write(`  host exit after stdin closed: ${exitCode}\n`);
  if (exitCode === "timeout") {
    client.child.kill();
    if (!failure) failure = new Error("the host did not exit when stdin closed");
  }

  report.finishedAt = new Date().toISOString();
  report.ok = !failure;
  if (failure) report.error = failure.message;

  const reportPath = path.join(walletDir, "..", `e2e-report-${stamp}.json`);
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(`  report: ${reportPath}\n`);
  } catch (_) {
    /* the report on screen is the one that matters */
  }

  if (!KEEP) {
    try {
      fs.rmSync(walletDir, { recursive: true, force: true });
      process.stdout.write("  disposable wallet folder removed\n");
    } catch (e) {
      process.stdout.write(`  could not remove ${walletDir}: ${e.message}\n`);
    }
  }

  if (failure) {
    process.stdout.write(`FAILED: ${failure.message}\n`);
    if (client.stderr.length) process.stdout.write(client.stderr.join(""));
    process.exit(1);
  }
  process.stdout.write("PASSED\n");
}

main().catch((e) => {
  process.stdout.write(`FAILED: ${e && e.stack}\n`);
  process.exit(1);
});
