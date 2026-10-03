"use strict";

/**
 * The SWARM network restart of 2 October 2026: the genesis the host pins, and
 * the one-time move of a wallet made on the abandoned chain.
 *
 * Every test runs against a mocked core and an in-memory record store, except
 * the record-store test at the end, which uses a throwaway temp folder.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createRouter, CHAIN_RESTART_NOTICE, HOST_VERSION } = require("../src/router");
const { createSession } = require("../src/auth");
const { MAINNET, TESTNET, chainHintFor, explorerTxUrl } = require("../src/networks");
const { createRecordStore, createMemoryRecordStore } = require("../src/records");

const NEW_GENESIS = "01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2";
const OLD_GENESIS = "01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd";

function mockAddon(overrides = {}) {
  const calls = [];
  const order = [];
  const base = {
    calls,
    order,
    _exists: true,
    set_wallet_base_dir: () => true,
    set_crypto_default_provider_to_ring: () => undefined,
    wallet_exists: (...args) => {
      calls.push({ name: "wallet_exists", args });
      return base._exists;
    },
    move_wallet_to_restarted_chain: (...args) => {
      calls.push({ name: "move_wallet_to_restarted_chain", args });
      order.push("move");
      return JSON.stringify({
        backup_path: "C:\\\\w\\\\swarm-mainnet\\\\swarm-browser-wallet.dat.before-network-restart-1791000000.bak",
        previous_birthday: 3100,
        birthday: 1,
        key_kind: "seed",
        unified_addresses: 1,
        transparent_addresses: 1,
        transparent_other_scopes: 0,
      });
    },
    init_from_b64: async (...args) => {
      calls.push({ name: "init_from_b64", args });
      order.push("open");
      return JSON.stringify({ result: "success" });
    },
    init_new: async (...args) => {
      calls.push({ name: "init_new", args });
      base._exists = true;
      return JSON.stringify({ result: "success" });
    },
    init_from_seed: async (...args) => {
      calls.push({ name: "init_from_seed", args });
      base._exists = true;
      return JSON.stringify({ result: "success" });
    },
    get_seed: async () => JSON.stringify({ seed_phrase: "word ".repeat(23) + "word", birthday: 830 }),
    save_wallet_file: async () => "Wallet saved successfully.",
    deinitialize: () => undefined,
    get_latest_block_server: async () => "929",
    get_latest_block_wallet: async () => JSON.stringify({ height: 929 }),
  };
  return Object.assign(base, overrides);
}

const okAuth = { check: async () => "available", verify: async () => ({ success: true, deviceAuth: "verified" }) };

function build({ addon = mockAddon(), records = createMemoryRecordStore(), auth = okAuth, networkId } = {}) {
  const logged = [];
  const router = createRouter({
    addon,
    auth,
    session: createSession({ idleTimeoutMs: 60000 }),
    walletBaseDir: "C:\\w",
    networkId: networkId || "swarm-mainnet",
    records,
    log: (line) => logged.push(line),
  });
  return { router, addon, records, logged };
}

const call = (router, command, params) => router.handle({ id: 1, command, params });

/* ── the genesis pin ─────────────────────────────────────────────────────── */

test("SWARM Mainnet is pinned to the restarted chain's genesis and its 443 indexer", () => {
  assert.strictEqual(MAINNET.genesis, NEW_GENESIS);
  assert.strictEqual(MAINNET.defaultServer, "https://lwd-main.swarm.green:443");
  assert.ok(MAINNET.retiredGenesis.includes(OLD_GENESIS));
  assert.notStrictEqual(MAINNET.genesis, OLD_GENESIS);
  assert.strictEqual(chainHintFor(MAINNET), `swarm-mainnet:${NEW_GENESIS}`);
  assert.ok(!/8443/.test(JSON.stringify(MAINNET)), "port 8443 is no longer served");
  assert.strictEqual(MAINNET.explorer, "https://explore.swarm.green");
  assert.strictEqual(TESTNET.explorer, "https://testnet.explore.swarm.green");
});

test("every core call that names a chain carries the new genesis", async () => {
  const { router, addon } = build();
  await call(router, "status");
  await call(router, "wallet.unlock");
  const named = addon.calls.filter((c) =>
    ["wallet_exists", "init_from_b64", "move_wallet_to_restarted_chain"].includes(c.name),
  );
  assert.ok(named.length >= 3);
  for (const c of named) {
    const hint = c.name === "move_wallet_to_restarted_chain" ? c.args[0] : c.args[1];
    assert.strictEqual(hint, `swarm-mainnet:${NEW_GENESIS}`, c.name);
  }
  const open = addon.calls.find((c) => c.name === "init_from_b64");
  assert.strictEqual(open.args[0], "https://lwd-main.swarm.green:443");
});

test("status reports host 0.2.0, the genesis and the explorer", async () => {
  const { router } = build({ addon: mockAddon({ _exists: false }) });
  const s = (await call(router, "status")).result;
  assert.strictEqual(HOST_VERSION, "0.2.0");
  assert.strictEqual(s.hostVersion, "0.2.0");
  assert.strictEqual(s.network.genesis, NEW_GENESIS);
  assert.strictEqual(s.network.explorer, "https://explore.swarm.green");
  assert.strictEqual(s.serverHeight, 929);
  assert.strictEqual(s.chainRestartPending, false);
});

test("explorer links go to explore.swarm.green/transactions/<txid> and nowhere for a non-txid", () => {
  const txid = "ab".repeat(32);
  assert.strictEqual(explorerTxUrl(MAINNET, txid), `https://explore.swarm.green/transactions/${txid}`);
  assert.strictEqual(explorerTxUrl(TESTNET, txid), `https://testnet.explore.swarm.green/transactions/${txid}`);
  assert.strictEqual(explorerTxUrl(MAINNET, "javascript:alert(1)"), "");
  assert.strictEqual(explorerTxUrl(MAINNET, ""), "");
});

/* ── the move ────────────────────────────────────────────────────────────── */

test("an existing wallet with no record is reported as pending, and moved once, before it is opened", async () => {
  const { router, addon, records } = build();
  const before = (await call(router, "status")).result;
  assert.strictEqual(before.walletExists, true);
  assert.strictEqual(before.chainRestartPending, true);
  assert.strictEqual(before.chainRestartNotice, null);

  const unlocked = await call(router, "wallet.unlock");
  assert.ok(unlocked.ok, JSON.stringify(unlocked.error));
  assert.deepStrictEqual(addon.order, ["move", "open"], "moved first, then opened");
  const move = addon.calls.find((c) => c.name === "move_wallet_to_restarted_chain");
  assert.deepStrictEqual(move.args, [`swarm-mainnet:${NEW_GENESIS}`, "High", 3, "swarm-browser-wallet.dat"]);

  const cr = unlocked.result.chainRestart;
  assert.strictEqual(cr.moved, true);
  assert.strictEqual(cr.notice, CHAIN_RESTART_NOTICE);
  assert.strictEqual(
    cr.notice,
    "The SWARM network was restarted on 2 October 2026. Your addresses and recovery phrase are unchanged; balances start again from the new chain.",
  );
  assert.strictEqual(cr.backupFile, "swarm-browser-wallet.dat.before-network-restart-1791000000.bak");
  assert.ok(!String(cr.backupFile).includes("\\"), "the file name only, no folder");
  assert.strictEqual(cr.birthday, 1);

  assert.strictEqual(records.read(MAINNET, "swarm-browser-wallet.dat").genesis, NEW_GENESIS);
  const after = (await call(router, "status")).result;
  assert.strictEqual(after.chainRestartPending, false);
  assert.strictEqual(after.chainRestartNotice, CHAIN_RESTART_NOTICE);
});

test("the move happens once: lock and unlock again does not move it a second time", async () => {
  const { router, addon } = build();
  assert.ok((await call(router, "wallet.unlock")).ok);
  await call(router, "wallet.lock");
  const again = await call(router, "wallet.unlock");
  assert.ok(again.ok);
  assert.strictEqual(again.result.chainRestart, null);
  assert.strictEqual(addon.calls.filter((c) => c.name === "move_wallet_to_restarted_chain").length, 1);
  assert.deepStrictEqual(addon.order, ["move", "open", "open"]);
});

test("a wallet recorded with the old genesis is moved too", async () => {
  const records = createMemoryRecordStore({ "swarm-mainnet/swarm-browser-wallet.dat": { genesis: OLD_GENESIS } });
  const { router, addon } = build({ records });
  assert.ok((await call(router, "wallet.unlock")).ok);
  assert.strictEqual(addon.calls.filter((c) => c.name === "move_wallet_to_restarted_chain").length, 1);
});

test("a wallet already recorded on the new chain is opened without a move", async () => {
  const records = createMemoryRecordStore({ "swarm-mainnet/swarm-browser-wallet.dat": { genesis: NEW_GENESIS } });
  const { router, addon } = build({ records });
  assert.strictEqual((await call(router, "status")).result.chainRestartPending, false);
  const answer = await call(router, "wallet.unlock");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.chainRestart, null);
  assert.deepStrictEqual(addon.order, ["open"]);
});

test("a failed move leaves the wallet unopened, unrecorded and says why", async () => {
  const addon = mockAddon({
    move_wallet_to_restarted_chain: () => {
      throw new Error("Error: initializing wallet: disk full");
    },
  });
  const { router, records } = build({ addon });
  const answer = await call(router, "wallet.unlock");
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "chain_restart_failed");
  assert.ok(answer.error.message.includes("was not opened"));
  assert.ok(answer.error.message.includes("disk full"));
  assert.ok(!addon.calls.some((c) => c.name === "init_from_b64"), "never opened");
  assert.strictEqual(records.read(MAINNET, "swarm-browser-wallet.dat"), null);
  // Balance stays refused: the session never opened.
  assert.strictEqual((await call(router, "balance")).error.code, "locked");
  assert.strictEqual((await call(router, "status")).result.chainRestartPending, true);
});

test("a core without the move function refuses to open an old wallet", async () => {
  const addon = mockAddon();
  delete addon.move_wallet_to_restarted_chain;
  const { router } = build({ addon });
  const answer = await call(router, "wallet.unlock");
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "chain_restart_unsupported");
  assert.ok(!addon.calls.some((c) => c.name === "init_from_b64"));
});

test("a refused Windows Hello moves nothing", async () => {
  const { router, addon } = build({
    auth: { check: async () => "available", verify: async () => ({ success: false }) },
  });
  const answer = await call(router, "wallet.unlock");
  assert.strictEqual(answer.error.code, "auth_refused");
  assert.strictEqual(addon.order.length, 0);
});

test("a record that cannot be written after a move is logged; the wallet still opens", async () => {
  const records = createMemoryRecordStore();
  records.failWrites = true;
  const { router, logged } = build({ records });
  const answer = await call(router, "wallet.unlock");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.chainRestart.moved, true);
  assert.ok(logged.some((l) => l.startsWith("wallet record not written after the move")));
});

test("a new wallet is recorded with the new genesis and never moved", async () => {
  const { router, addon, records } = build({ addon: mockAddon({ _exists: false }) });
  const created = await call(router, "wallet.create");
  assert.ok(created.ok);
  assert.strictEqual(created.result.birthday, 830, "the birthday the core chose is passed through");
  assert.strictEqual(records.read(MAINNET, "swarm-browser-wallet.dat").genesis, NEW_GENESIS);
  await call(router, "wallet.lock");
  const unlocked = await call(router, "wallet.unlock");
  assert.ok(unlocked.ok);
  assert.strictEqual(unlocked.result.chainRestart, null);
  assert.ok(!addon.calls.some((c) => c.name === "move_wallet_to_restarted_chain"));
});

test("a restored wallet is recorded with the new genesis", async () => {
  const { router, records } = build({ addon: mockAddon({ _exists: false }) });
  const restored = await call(router, "wallet.restore", { seed: "abandon ".repeat(23) + "art" });
  assert.ok(restored.ok);
  assert.strictEqual(records.read(MAINNET, "swarm-browser-wallet.dat").genesis, NEW_GENESIS);
});

test("a testnet wallet is never moved and never recorded", async () => {
  const { router, addon, records } = build({ networkId: "swarm-testnet" });
  assert.strictEqual((await call(router, "status")).result.chainRestartPending, false);
  const answer = await call(router, "wallet.unlock");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.chainRestart, null);
  assert.ok(!addon.calls.some((c) => c.name === "move_wallet_to_restarted_chain"));
  assert.strictEqual(records.writes.length, 0);
});

/* ── the record on disk ──────────────────────────────────────────────────── */

test("the record store writes beside the wallet file and reads it back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-host-records-"));
  try {
    const store = createRecordStore(dir);
    assert.strictEqual(store.read(MAINNET, "swarm-browser-wallet.dat"), null);
    const where = store.write(MAINNET, "swarm-browser-wallet.dat", { network: "swarm-mainnet", genesis: NEW_GENESIS });
    assert.strictEqual(where, path.join(dir, "swarm-mainnet", "swarm-browser-wallet.dat.record.json"));
    assert.strictEqual(store.read(MAINNET, "swarm-browser-wallet.dat").genesis, NEW_GENESIS);
    assert.ok(!fs.existsSync(`${where}.tmp`));
    fs.writeFileSync(where, "not json");
    assert.strictEqual(store.read(MAINNET, "swarm-browser-wallet.dat"), null, "an unreadable record counts as none");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
