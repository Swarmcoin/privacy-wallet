"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { createRouter } = require("../src/router");
const { createSession } = require("../src/auth");
const { chainHintFor, MAINNET, TESTNET } = require("../src/networks");
const { createMemoryRecordStore } = require("../src/records");

const MAINNET_ADDRESS =
  "swm1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

/**
 * A stand-in for the wallet core.
 *
 * Every call is recorded, so a test can assert what the router asked the core
 * to do — which is the only way to prove, without a chain, that the chain hint
 * carries the genesis and that `send` never reaches the core unless Hello said
 * yes.
 */
function mockAddon(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
    return undefined;
  };
  const base = {
    calls,
    set_wallet_base_dir: (dir) => {
      calls.push({ name: "set_wallet_base_dir", args: [dir] });
      return true;
    },
    set_crypto_default_provider_to_ring: record("set_crypto_default_provider_to_ring"),
    wallet_exists: (...args) => {
      calls.push({ name: "wallet_exists", args });
      return base._exists;
    },
    _exists: false,
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
    init_from_b64: async (...args) => {
      calls.push({ name: "init_from_b64", args });
      return JSON.stringify({ result: "success" });
    },
    // `seed_phrase` is the field the real core's `recovery_info` serialises.
    get_seed: async () => JSON.stringify({ seed_phrase: "word ".repeat(23) + "word", birthday: 42 }),
    save_wallet_file: async () => JSON.stringify({ result: "success" }),
    deinitialize: record("deinitialize"),
    get_balance: async () =>
      JSON.stringify({
        confirmed_orchard_balance: 150000000,
        total_orchard_balance: 250000000,
        confirmed_sapling_balance: 0,
        total_sapling_balance: 0,
        confirmed_ironwood_balance: 0,
        total_ironwood_balance: 0,
        confirmed_transparent_balance: 100000000,
        total_transparent_balance: 100000000,
      }),
    get_spendable_balance_total: async () => JSON.stringify({ spendable_balance: 150000000 }),
    get_unified_addresses: async () =>
      JSON.stringify([{ encoded_address: MAINNET_ADDRESS, has_orchard: true, has_sapling: true }]),
    get_transparent_addresses: async () => JSON.stringify([{ encoded_address: "s1abcdefghijklmnop" }]),
    get_value_transfers: async () =>
      JSON.stringify({
        value_transfers: [
          { kind: "received", txid: "abcd", value: 100000000, blockheight: 10, confirmations: 3, memos: [] },
        ],
      }),
    send: async (json) => {
      calls.push({ name: "send", args: [json] });
      return JSON.stringify({ result: "success" });
    },
    confirm: async () => {
      calls.push({ name: "confirm", args: [] });
      return JSON.stringify({ txids: ["deadbeef"] });
    },
    run_sync: async () => "Launching sync task...",
    status_sync: async () =>
      JSON.stringify({
        sync_start_height: 1,
        total_blocks_scanned: 5,
        percentage_total_blocks_scanned: 50,
        total_outputs_scanned: 0,
      }),
    poll_sync: async () => "Sync task is not complete.",
    // The real core answers a JSON object here and a bare number below.
    get_latest_block_wallet: async () => JSON.stringify({ height: 1234 }),
    get_latest_block_server: async () => "1240",
  };
  return Object.assign(base, overrides);
}

function mockAuth(result = { success: true, deviceAuth: "verified" }) {
  const seen = [];
  return {
    seen,
    check: async () => "available",
    verify: async (reason) => {
      seen.push(reason);
      return typeof result === "function" ? result(reason) : result;
    },
  };
}

function build(options = {}) {
  const addon = options.addon || mockAddon();
  const auth = options.auth || mockAuth();
  const session = options.session || createSession({ idleTimeoutMs: options.idleTimeoutMs || 60000 });
  const router = createRouter({
    addon,
    auth,
    session,
    walletBaseDir: "C:\\test\\SWARM Browser Wallet",
    networkId: options.networkId || "swarm-mainnet",
    loadFailure: options.loadFailure,
    // Never the disk: the wallet records live in memory in every unit test.
    // These tests are about a wallet made on the current chain, so its record
    // names the current genesis; the restart move is tested in restart.test.js.
    records:
      options.records ||
      createMemoryRecordStore({ "swarm-mainnet/swarm-browser-wallet.dat": { genesis: MAINNET.genesis } }),
    log: options.log,
  });
  return { router, addon, auth, session };
}

const call = (router, command, params) => router.handle({ id: 1, command, params });

test("an unknown command is refused by name", async () => {
  const { router } = build();
  const answer = await call(router, "get_seed");
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "unknown_command");
});

test("the core's own exports are not reachable as commands", async () => {
  const { router } = build();
  for (const forbidden of ["get_ufvk", "delete_wallet", "set_wallet_base_dir", "constructor", "__proto__"]) {
    const answer = await call(router, forbidden);
    assert.strictEqual(answer.ok, false, `${forbidden} must not be a command`);
    assert.strictEqual(answer.error.code, "unknown_command");
  }
});

test("status works with no wallet and names the network", async () => {
  const { router } = build();
  const answer = await call(router, "status");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.network.id, "swarm-mainnet");
  assert.strictEqual(answer.result.network.server, "https://lwd-main.swarm.green:443");
  assert.strictEqual(answer.result.walletExists, false);
  assert.strictEqual(answer.result.unlocked, false);
});

test("the chain hint sent to the core carries the mainnet genesis, never the bare label", async () => {
  const { router, addon } = build();
  await call(router, "wallet.exists");
  const hint = addon.calls.find((c) => c.name === "wallet_exists").args[1];
  assert.strictEqual(hint, `swarm-mainnet:${MAINNET.genesis}`);
  assert.notStrictEqual(hint, "swarm-mainnet");
  assert.strictEqual(hint, chainHintFor(MAINNET));
});

test("the testnet hint is the bare label, which is what the core takes there", () => {
  assert.strictEqual(chainHintFor(TESTNET), "swarm-testnet");
});

test("the wallet folder handed to the core is this host's own, not the desktop wallet's", async () => {
  const { router, addon } = build();
  await call(router, "wallet.exists");
  assert.strictEqual(addon.calls[0].name, "set_wallet_base_dir");
  assert.strictEqual(addon.calls[0].args[0], "C:\\test\\SWARM Browser Wallet");
});

test("creating a wallet returns the seed once and never logs it", async () => {
  const logged = [];
  const addon = mockAddon();
  const session = createSession({ idleTimeoutMs: 60000 });
  const router = createRouter({
    addon,
    auth: mockAuth(),
    session,
    log: (line) => logged.push(line),
    walletBaseDir: "C:\\test",
    records: createMemoryRecordStore(),
  });
  const answer = await call(router, "wallet.create");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.seed.split(" ").length, 24);
  assert.strictEqual(answer.result.birthday, 42);
  assert.ok(logged.every((line) => !line.includes("word")));
  assert.strictEqual(answer.result.network, "swarm-mainnet");
  // A second wallet on top of the first is refused.
  const again = await call(router, "wallet.create");
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.error.code, "wallet_exists");
});

test("a wallet whose recovery phrase cannot be read is reported, not returned empty", async () => {
  const addon = mockAddon();
  addon.get_seed = async () => JSON.stringify({});
  const { router } = build({ addon });
  const answer = await call(router, "wallet.create");
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "no_seed");
});

test("restore refuses a phrase that is not 12 or 24 words, before touching the core", async () => {
  const { router, addon } = build();
  const answer = await call(router, "wallet.restore", { seed: "one two three" });
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "bad_seed");
  assert.ok(!addon.calls.some((c) => c.name === "init_from_seed"));
});

test("restore floors the birthday at the network's activation height", async () => {
  const { router, addon } = build();
  const seed = Array.from({ length: 24 }, () => "abandon").join(" ");
  const answer = await call(router, "wallet.restore", { seed, birthday: -5 });
  assert.ok(answer.ok);
  assert.strictEqual(addon.calls.find((c) => c.name === "init_from_seed").args[1], MAINNET.activationHeight);
});

test("balance, addresses, history, send and sync are all refused while locked", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  for (const command of ["balance", "addresses", "history", "sync.start", "sync.status"]) {
    const answer = await call(router, command);
    assert.strictEqual(answer.ok, false, command);
    assert.strictEqual(answer.error.code, "locked", command);
  }
  const send = await call(router, "send", { to: MAINNET_ADDRESS, amount: 1 });
  assert.strictEqual(send.error.code, "locked");
});

test("unlock refuses when there is no wallet", async () => {
  const { router } = build();
  const answer = await call(router, "wallet.unlock");
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "no_wallet");
});

test("unlock refuses when Windows Hello says no, and leaves the wallet closed", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon, auth: mockAuth({ success: false, deviceAuth: "verified" }) });
  const answer = await call(router, "wallet.unlock");
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "auth_refused");
  assert.ok(!addon.calls.some((c) => c.name === "init_from_b64"));
  assert.strictEqual((await call(router, "balance")).error.code, "locked");
});

test("unlock opens the wallet and reports how the device answered", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  const answer = await call(router, "wallet.unlock");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.deviceAuth, "verified");
  assert.ok(addon.calls.some((c) => c.name === "init_from_b64"));
});

test("an unlock on a machine without Hello succeeds but says the device could not vouch", async () => {
  const addon = mockAddon({ _exists: true });
  const auth = { check: async () => "not_supported", verify: async () => ({ success: true, deviceAuth: "unavailable" }) };
  const { router } = build({ addon, auth });
  const answer = await call(router, "wallet.unlock");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.deviceAuth, "unavailable");
});

test("balance separates shielded, transparent and pending", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "balance");
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.shielded, 1.5);
  assert.strictEqual(answer.result.transparent, 1);
  assert.strictEqual(answer.result.pending, 1);
  assert.strictEqual(answer.result.ticker, "SWM");
});

test("addresses reports the unified address and whether it belongs to this network", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "addresses");
  assert.strictEqual(answer.result.unified, MAINNET_ADDRESS);
  assert.strictEqual(answer.result.unifiedMatchesNetwork, true);
  assert.strictEqual(answer.result.transparent, "s1abcdefghijklmnop");
});

test("history converts zatoshis to coins", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "history");
  assert.strictEqual(answer.result.transfers[0].amount, 1);
  assert.strictEqual(answer.result.transfers[0].txid, "abcd");
});

test("send needs its own Hello even inside an unlocked session", async () => {
  const addon = mockAddon({ _exists: true });
  const auth = mockAuth();
  const { router } = build({ addon, auth });
  await call(router, "wallet.unlock");
  const answer = await call(router, "send", { to: MAINNET_ADDRESS, amount: 0.01, memo: "hello" });
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.strictEqual(answer.result.txid, "deadbeef");
  // One prompt for the unlock, a second for this payment.
  assert.strictEqual(auth.seen.length, 2);
  assert.ok(auth.seen[1].includes("0.01"));
  const sent = JSON.parse(addon.calls.find((c) => c.name === "send").args[0]);
  assert.deepStrictEqual(sent, [{ address: MAINNET_ADDRESS, amount: 1000000, memo: "hello" }]);
});

test("a refused Hello stops the payment before the core is asked", async () => {
  const addon = mockAddon({ _exists: true });
  let first = true;
  const auth = mockAuth(() => {
    if (first) {
      first = false;
      return { success: true, deviceAuth: "verified" };
    }
    return { success: false, deviceAuth: "verified" };
  });
  const { router } = build({ addon, auth });
  await call(router, "wallet.unlock");
  const answer = await call(router, "send", { to: MAINNET_ADDRESS, amount: 1 });
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "auth_refused");
  assert.ok(!addon.calls.some((c) => c.name === "send"));
  assert.ok(!addon.calls.some((c) => c.name === "confirm"));
});

test("an address from another network is refused before any Hello prompt", async () => {
  const addon = mockAddon({ _exists: true });
  const auth = mockAuth();
  const { router } = build({ addon, auth });
  await call(router, "wallet.unlock");
  for (const wrong of ["u1abcdef", "swarm1abcdef", "t1abcdef", "zs1abcdef"]) {
    const answer = await call(router, "send", { to: wrong, amount: 1 });
    assert.strictEqual(answer.ok, false, wrong);
    assert.strictEqual(answer.error.code, "wrong_network", wrong);
  }
  assert.strictEqual(auth.seen.length, 1); // the unlock, and nothing since
});

test("a zero, negative or unreadable amount is refused", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  for (const amount of [0, -1, NaN, "abc", undefined]) {
    const answer = await call(router, "send", { to: MAINNET_ADDRESS, amount });
    assert.strictEqual(answer.error.code, "bad_amount", String(amount));
  }
});

test("a proposal the core refuses does not become a payment", async () => {
  const addon = mockAddon({ _exists: true });
  addon.send = async () => JSON.stringify({ error: "insufficient funds" });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "send", { to: MAINNET_ADDRESS, amount: 99 });
  assert.strictEqual(answer.ok, false);
  assert.strictEqual(answer.error.code, "send_refused");
  assert.ok(answer.error.message.includes("insufficient funds"));
  assert.ok(!addon.calls.some((c) => c.name === "confirm"));
});

test("locking drops the keys as well as the session", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "wallet.lock");
  assert.ok(answer.ok);
  assert.ok(addon.calls.some((c) => c.name === "deinitialize"));
  assert.strictEqual((await call(router, "balance")).error.code, "locked");
});

test("an idle session locks itself", async () => {
  let clock = 1000;
  const session = createSession({ idleTimeoutMs: 1000, now: () => clock });
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon, session });
  await call(router, "wallet.unlock");
  assert.ok((await call(router, "balance")).ok);
  clock += 1001;
  assert.strictEqual((await call(router, "balance")).error.code, "locked");
});

test("use pushes the idle deadline out", async () => {
  let clock = 1000;
  const session = createSession({ idleTimeoutMs: 1000, now: () => clock });
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon, session });
  await call(router, "wallet.unlock");
  clock += 800;
  assert.ok((await call(router, "balance")).ok);
  clock += 800;
  assert.ok((await call(router, "balance")).ok);
});

test("sync.status reports progress and the wallet's height", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  await call(router, "sync.start");
  const answer = await call(router, "sync.status");
  assert.strictEqual(answer.result.inProgress, true);
  assert.strictEqual(answer.result.syncedBlocks, 5);
  assert.strictEqual(answer.result.percentage, 50);
  // The core answers this one as {"height": N}, not as a number.
  assert.strictEqual(answer.result.walletHeight, 1234);
  assert.strictEqual(answer.result.started, true);
});

test("a finished sync is reported as finished", async () => {
  const addon = mockAddon({ _exists: true });
  addon.poll_sync = async () => JSON.stringify({ result: "success" });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "sync.status");
  assert.strictEqual(answer.result.inProgress, false);
});

test("status reads both height shapes the core uses", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  const answer = await call(router, "status");
  assert.strictEqual(answer.result.walletHeight, 1234);
  assert.strictEqual(answer.result.serverHeight, 1240);
});

test("the network switch is refused while the wallet is open, and taken when it is not", async () => {
  const addon = mockAddon({ _exists: true });
  const { router } = build({ addon });
  await call(router, "wallet.unlock");
  assert.strictEqual((await call(router, "settings.network", { network: "swarm-testnet" })).error.code, "wallet_open");
  await call(router, "wallet.lock");
  const answer = await call(router, "settings.network", { network: "swarm-testnet" });
  assert.ok(answer.ok);
  assert.strictEqual(answer.result.network.id, "swarm-testnet");
  assert.strictEqual(answer.result.network.coinsAreTestCoins, true);
  assert.strictEqual((await call(router, "settings.network", { network: "main" })).error.code, "unknown_network");
});

test("a missing wallet core is reported, not thrown", async () => {
  const session = createSession({ idleTimeoutMs: 1000 });
  const router = createRouter({
    addon: null,
    auth: mockAuth(),
    session,
    walletBaseDir: "C:\\test",
    records: createMemoryRecordStore(),
    loadFailure: () => new Error("native.node was not found"),
  });
  const status = await router.handle({ id: 1, command: "status" });
  assert.ok(status.ok);
  assert.strictEqual(status.result.core, "missing");
  assert.ok(status.result.coreError.includes("not found"));
  const balance = await router.handle({ id: 2, command: "balance" });
  assert.strictEqual(balance.ok, false);
});

test("every answer carries the id it was asked with", async () => {
  const { router } = build();
  const answer = await router.handle({ id: "abc-123", command: "status" });
  assert.strictEqual(answer.id, "abc-123");
  const bad = await router.handle({ id: "abc-124", command: "nope" });
  assert.strictEqual(bad.id, "abc-124");
});
