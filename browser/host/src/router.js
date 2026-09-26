"use strict";

/**
 * The command set the extension may ask for, and nothing else.
 *
 * The router is the whole security boundary of this host. The extension is a
 * page in a browser; the browser runs other people's code all day. So the
 * router takes a small vocabulary of named commands, never a path, never a
 * method name to forward, never a chain label to pass through. Anything the
 * addon exports and this file does not name is unreachable from the browser.
 *
 * It is written as a factory over injected dependencies so the unit tests can
 * run every branch against a mocked addon, with no wallet, no network and no
 * Windows Hello dialog. `test/router.test.js` does exactly that.
 */

const { networkFor, chainHintFor, looksLikeAddressOf, DEFAULT_NETWORK_ID } = require("./networks");
const { WALLET_FILE_NAME } = require("./paths");

const HOST_VERSION = "0.1.0";
const PERFORMANCE_LEVEL = "High"; // the desktop wallet's own default
const MIN_CONFIRMATIONS = 3; // what every desktop call site passes
const ZATOSHIS_PER_COIN = 100000000;

/** A refusal the extension can act on, rather than a stack trace. */
class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const coins = (zats) => (Number(zats || 0) / ZATOSHIS_PER_COIN);

/**
 * A block height out of whatever the core answered.
 *
 * `get_latest_block_server` answers a bare number as a string; the wallet's own
 * `get_latest_block_wallet` answers `{"height": 311}`. Both were read off the
 * live mainnet core on 2026-09-26, and a reader that assumes one of them is
 * what produced a wallet height of `null` in the first end-to-end run.
 */
function heightFrom(answer) {
  if (answer === undefined || answer === null || answer === "") return null;
  if (typeof answer === "number") return Number.isFinite(answer) ? answer : null;
  const text = String(answer).trim();
  const direct = Number(text);
  if (Number.isFinite(direct) && text !== "") return direct;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "number") return parsed;
    const height = Number(parsed && parsed.height);
    return Number.isFinite(height) ? height : null;
  } catch (_) {
    return null;
  }
}

/** JSON from the addon, or a refusal that names the call instead of "undefined". */
function parseAddonJson(call, text) {
  if (text === undefined || text === null || text === "") {
    throw new CommandError("core_silent", `The wallet core returned nothing for ${call}.`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CommandError("core_unreadable", `The wallet core's answer to ${call} was not JSON.`);
  }
}

function createRouter(deps) {
  const addon = deps.addon;
  const auth = deps.auth;
  const session = deps.session;
  const log = deps.log || (() => {});
  const walletBaseDir = deps.walletBaseDir;
  const walletFileName = deps.walletFileName || WALLET_FILE_NAME;
  const loadFailure = deps.loadFailure || (() => null);

  let network = networkFor(deps.networkId || DEFAULT_NETWORK_ID);
  let baseDirSet = false;
  let opened = false;
  let syncStarted = false;

  const requireAddon = () => {
    if (!addon) {
      const failure = loadFailure();
      throw new CommandError("core_missing", failure ? failure.message : "The SWARM wallet core is not available.");
    }
    return addon;
  };

  /**
   * Points the core at this host's own wallet folder.
   *
   * The core keeps it in a `OnceCell`, so it is set once per process and a
   * second call answers false. That is why the host is one process per
   * connection: a base directory cannot be changed, only chosen.
   */
  const ensureBaseDir = () => {
    if (baseDirSet) return;
    const core = requireAddon();
    if (typeof core.set_wallet_base_dir === "function") {
      core.set_wallet_base_dir(walletBaseDir);
    }
    if (typeof core.set_crypto_default_provider_to_ring === "function") {
      try {
        core.set_crypto_default_provider_to_ring();
      } catch (_) {
        /* already set by an earlier call in this process */
      }
    }
    baseDirSet = true;
  };

  const chainHint = () => chainHintFor(network);

  const walletExists = async () => {
    ensureBaseDir();
    return !!requireAddon().wallet_exists(
      network.defaultServer,
      chainHint(),
      PERFORMANCE_LEVEL,
      MIN_CONFIRMATIONS,
      walletFileName,
    );
  };

  const requireUnlocked = () => {
    if (!session.isOpen() || !opened) {
      throw new CommandError("locked", "The wallet is locked. Unlock it first.");
    }
    session.touch();
  };

  const openExisting = async () => {
    ensureBaseDir();
    const result = await requireAddon().init_from_b64(
      network.defaultServer,
      chainHint(),
      PERFORMANCE_LEVEL,
      MIN_CONFIRMATIONS,
      walletFileName,
    );
    parseAddonJson("init_from_b64", result);
    opened = true;
  };

  const closeWallet = async () => {
    if (!opened) return;
    const core = requireAddon();
    try {
      if (typeof core.save_wallet_file === "function") await core.save_wallet_file();
    } catch (e) {
      log(`save before lock failed: ${e && e.message}`);
    }
    try {
      if (typeof core.deinitialize === "function") core.deinitialize();
    } catch (e) {
      log(`deinitialize failed: ${e && e.message}`);
    }
    opened = false;
    syncStarted = false;
  };

  const commands = {
    /** Everything the popup needs before it knows whether there is a wallet. */
    async status() {
      const core = addon;
      const out = {
        hostVersion: HOST_VERSION,
        node: process.versions.node,
        core: core ? "loaded" : "missing",
        coreError: core ? null : (loadFailure() ? loadFailure().message : "not found"),
        network: {
          id: network.id,
          displayName: network.displayName,
          ticker: network.ticker,
          server: network.defaultServer,
          coinsAreTestCoins: network.coinsAreTestCoins,
        },
        walletDir: walletBaseDir,
        unlocked: session.isOpen() && opened,
        lockInSeconds: session.isOpen() ? session.secondsLeft() : 0,
        deviceAuth: await auth.check(),
        walletExists: false,
        walletHeight: null,
        serverHeight: null,
      };
      if (!core) return out;
      try {
        out.walletExists = await walletExists();
      } catch (e) {
        out.coreError = e.message;
      }
      if (opened && session.isOpen()) {
        try {
          out.walletHeight = heightFrom(await core.get_latest_block_wallet());
        } catch (e) {
          log(`get_latest_block_wallet failed: ${e && e.message}`);
        }
      }
      try {
        out.serverHeight = heightFrom(await core.get_latest_block_server(network.defaultServer));
      } catch (e) {
        // The one place the host reaches the network without a wallet. A server
        // that does not answer is reported, not thrown: the popup still has to
        // render, and "can't reach the indexer" is the useful sentence.
        out.serverError = String((e && e.message) || e);
      }
      return out;
    },

    async "wallet.exists"() {
      return { exists: await walletExists() };
    },

    /**
     * A new wallet, and its seed phrase — once.
     *
     * The seed crosses to the extension exactly one time, to be written down,
     * and is never stored by the extension, never logged here, and never
     * returned again. Asking twice is refused rather than answered, so a page
     * that gets a foothold in the popup cannot simply ask for it later.
     */
    async "wallet.create"() {
      ensureBaseDir();
      if (await walletExists()) {
        throw new CommandError("wallet_exists", "A browser wallet already exists. Lock it or remove it first.");
      }
      const core = requireAddon();
      const result = await core.init_new(
        network.defaultServer,
        chainHint(),
        PERFORMANCE_LEVEL,
        MIN_CONFIRMATIONS,
        walletFileName,
      );
      parseAddonJson("init_new", result);
      opened = true;
      session.open();
      const seedJson = parseAddonJson("get_seed", await core.get_seed());
      if (typeof core.save_wallet_file === "function") await core.save_wallet_file();
      // `seed_phrase` is what the core's `recovery_info` serialises; `seed` is
      // accepted too so a future core that renames the field does not silently
      // hand the user an empty backup screen.
      const phrase = seedJson.seed_phrase || seedJson.seed || "";
      if (!phrase) {
        throw new CommandError("no_seed", "The wallet was created but its recovery phrase could not be read.");
      }
      // The one command whose result is never logged, not even its shape.
      return {
        seed: phrase,
        birthday: Number(seedJson.birthday ?? seedJson.wallet_birthday) || network.activationHeight,
        network: network.id,
      };
    },

    async "wallet.restore"(params) {
      ensureBaseDir();
      const seed = String((params && params.seed) || "").trim().replace(/\s+/g, " ");
      const words = seed ? seed.split(" ").length : 0;
      if (words !== 24 && words !== 12) {
        throw new CommandError("bad_seed", "A seed phrase is 24 words (or 12 for an older wallet).");
      }
      if (await walletExists()) {
        throw new CommandError("wallet_exists", "A browser wallet already exists. Remove it before restoring another.");
      }
      let birthday = Number(params && params.birthday);
      if (!Number.isFinite(birthday) || birthday < network.activationHeight) birthday = network.activationHeight;
      const core = requireAddon();
      const result = await core.init_from_seed(
        seed,
        birthday,
        network.defaultServer,
        chainHint(),
        PERFORMANCE_LEVEL,
        MIN_CONFIRMATIONS,
        walletFileName,
      );
      parseAddonJson("init_from_seed", result);
      opened = true;
      session.open();
      if (typeof core.save_wallet_file === "function") await core.save_wallet_file();
      return { restored: true, birthday, network: network.id };
    },

    /** Windows Hello, then the wallet is opened and the session starts. */
    async "wallet.unlock"() {
      ensureBaseDir();
      if (!(await walletExists())) {
        throw new CommandError("no_wallet", "There is no browser wallet on this computer yet.");
      }
      const verdict = await auth.verify("Unlock your SWARM browser wallet");
      if (!verdict.success) {
        throw new CommandError("auth_refused", "Windows Hello did not confirm it was you.");
      }
      if (!opened) await openExisting();
      session.open();
      return {
        unlocked: true,
        deviceAuth: verdict.deviceAuth,
        lockInSeconds: session.secondsLeft(),
      };
    },

    /** Ends the session AND drops the keys, not just the screen. */
    async "wallet.lock"() {
      session.close();
      await closeWallet();
      return { locked: true };
    },

    async balance() {
      requireUnlocked();
      const core = requireAddon();
      const b = parseAddonJson("get_balance", await core.get_balance());
      const shielded =
        coins(b.confirmed_orchard_balance) + coins(b.confirmed_sapling_balance) + coins(b.confirmed_ironwood_balance);
      const shieldedTotal =
        coins(b.total_orchard_balance) + coins(b.total_sapling_balance) + coins(b.total_ironwood_balance);
      const transparent = coins(b.confirmed_transparent_balance);
      const transparentTotal = coins(b.total_transparent_balance);
      let spendable = null;
      try {
        const s = parseAddonJson("get_spendable_balance_total", await core.get_spendable_balance_total());
        spendable = coins(s.spendable_balance);
      } catch (e) {
        log(`spendable balance unavailable: ${e && e.message}`);
      }
      return {
        ticker: network.ticker,
        shielded,
        transparent,
        // "Pending" is the part the chain has seen but not confirmed to the
        // wallet's minimum depth. It is a subtraction, not a separate query:
        // total minus confirmed is exactly what is still in flight.
        pending: Math.max(0, shieldedTotal + transparentTotal - shielded - transparent),
        total: shieldedTotal + transparentTotal,
        spendable,
      };
    },

    async addresses() {
      requireUnlocked();
      const core = requireAddon();
      const unified = parseAddonJson("get_unified_addresses", await core.get_unified_addresses()) || [];
      const transparent = parseAddonJson("get_transparent_addresses", await core.get_transparent_addresses()) || [];
      const first = Array.isArray(unified) && unified.length > 0 ? unified[0].encoded_address : null;
      const firstT =
        Array.isArray(transparent) && transparent.length > 0 ? transparent[0].encoded_address : null;
      return {
        unified: first,
        transparent: firstT,
        // Reported so the popup can refuse to show an address that does not
        // belong to the network the settings screen claims to be on.
        unifiedMatchesNetwork: first ? looksLikeAddressOf(network, first) : false,
        allUnified: (Array.isArray(unified) ? unified : []).map((u) => u.encoded_address),
        allTransparent: (Array.isArray(transparent) ? transparent : []).map((t) => t.encoded_address),
      };
    },

    async history() {
      requireUnlocked();
      const core = requireAddon();
      const parsed = parseAddonJson("get_value_transfers", await core.get_value_transfers());
      const list = Array.isArray(parsed && parsed.value_transfers) ? parsed.value_transfers : [];
      return {
        ticker: network.ticker,
        transfers: list.map((vt) => ({
          kind: vt.kind,
          txid: vt.txid,
          amount: coins(vt.value),
          blockHeight: vt.blockheight,
          confirmations: vt.confirmations,
          datetime: vt.datetime,
          address: vt.recipient_address || vt.address || null,
          memos: Array.isArray(vt.memos) ? vt.memos : [],
          pending: !!vt.pending,
        })),
      };
    },

    /**
     * A payment.
     *
     * Two gates, not one: the session must be unlocked, AND this payment needs
     * its own Windows Hello. An unlocked session means the person unlocked the
     * wallet some minutes ago; a spend has to be confirmed now, by them, for
     * this amount.
     */
    async send(params) {
      requireUnlocked();
      const to = String((params && params.to) || "").trim();
      const amount = Number(params && params.amount);
      const memo = params && params.memo ? String(params.memo) : "";
      if (!to) throw new CommandError("bad_address", "Enter the address to pay.");
      if (!looksLikeAddressOf(network, to)) {
        throw new CommandError(
          "wrong_network",
          `That is not a ${network.displayName} address. ${network.displayName} addresses start with ${network.unifiedHrp}1, ${network.transparentPrefixes.join(" or ")}.`,
        );
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new CommandError("bad_amount", "Enter an amount greater than zero.");
      }
      if (memo.length > 512) {
        throw new CommandError("memo_too_long", "A memo is at most 512 characters.");
      }
      const verdict = await auth.verify(`Confirm sending ${amount} ${network.ticker}`);
      if (!verdict.success) {
        throw new CommandError("auth_refused", "Windows Hello did not confirm this payment. Nothing was sent.");
      }
      const core = requireAddon();
      const zats = Math.round(amount * ZATOSHIS_PER_COIN);
      const sendJson = [memo ? { address: to, amount: zats, memo } : { address: to, amount: zats }];
      const proposal = parseAddonJson("send", await core.send(JSON.stringify(sendJson)));
      if (proposal.error) throw new CommandError("send_refused", String(proposal.error));
      const confirmed = parseAddonJson("confirm", await core.confirm());
      if (confirmed.error) throw new CommandError("send_failed", String(confirmed.error));
      const txids = Array.isArray(confirmed.txids) ? confirmed.txids : [];
      if (txids.length === 0) throw new CommandError("send_failed", "The payment returned no transaction id.");
      if (typeof core.save_wallet_file === "function") await core.save_wallet_file();
      session.touch();
      return { txid: txids[0], txids, amount, to };
    },

    async "sync.start"() {
      requireUnlocked();
      const core = requireAddon();
      const result = await core.run_sync();
      syncStarted = true;
      return { started: true, detail: String(result || "") };
    },

    async "sync.status"() {
      requireUnlocked();
      const core = requireAddon();
      const s = parseAddonJson("status_sync", await core.status_sync());
      let walletHeight = null;
      try {
        walletHeight = heightFrom(await core.get_latest_block_wallet());
      } catch (e) {
        log(`sync.status height failed: ${e && e.message}`);
      }
      // "Sync task is not complete." is the core's only "still running" reply;
      // any other answer means the task has stopped. `status_sync` has no
      // in-progress field of its own — it reports scanned ranges and
      // percentages — so asking it would have meant inventing one.
      let inProgress = false;
      try {
        const poll = String((await core.poll_sync()) || "");
        inProgress = poll.toLowerCase().startsWith("sync task is not complete");
      } catch (e) {
        log(`poll_sync failed: ${e && e.message}`);
      }
      const percentage = s.percentage_total_blocks_scanned;
      return {
        started: syncStarted,
        inProgress,
        syncedBlocks: s.total_blocks_scanned ?? null,
        startHeight: s.sync_start_height ?? null,
        percentage: percentage === null || percentage === undefined ? null : Number(percentage),
        outputsScanned: s.total_outputs_scanned ?? null,
        lastError: s.lastError || s.last_error || null,
        walletHeight,
      };
    },

    /**
     * The hidden network switch.
     *
     * Not on a screen a user meets: the settings page reveals it only after a
     * typed word, because a wallet that can be moved to another chain by a
     * stray click is a wallet that will be. Refused while a wallet is open,
     * because the core's wallet directory is chosen when the wallet opens.
     */
    async "settings.network"(params) {
      const id = String((params && params.network) || "");
      if (opened || session.isOpen()) {
        throw new CommandError("wallet_open", "Lock the wallet before changing network.");
      }
      const next = networkFor(id);
      if (!next) throw new CommandError("unknown_network", `'${id}' is not a SWARM network.`);
      network = next;
      return {
        network: {
          id: network.id,
          displayName: network.displayName,
          server: network.defaultServer,
          coinsAreTestCoins: network.coinsAreTestCoins,
        },
      };
    },
  };

  /**
   * One request in, one response out.
   *
   * Never throws: an unhandled failure here would leave the extension's promise
   * hanging for the life of the port, which the popup cannot distinguish from a
   * slow sync. Everything comes back as `{ ok: false, error: { code, message } }`.
   */
  async function handle(request) {
    const id = request && request.id !== undefined ? request.id : null;
    const name = request && typeof request.command === "string" ? request.command : "";
    const fn = Object.prototype.hasOwnProperty.call(commands, name) ? commands[name] : null;
    if (!fn) {
      return { id, ok: false, error: { code: "unknown_command", message: `'${name}' is not a command this host has.` } };
    }
    try {
      const result = await fn(request.params || {});
      return { id, ok: true, command: name, result };
    } catch (e) {
      const code = e instanceof CommandError ? e.code : "core_error";
      const message = (e && e.message) || String(e);
      // Logged by name and code only. A failure inside `wallet.create` or
      // `wallet.restore` must not put its arguments anywhere.
      log(`${name} failed [${code}]`);
      return { id, ok: false, command: name, error: { code, message } };
    }
  }

  return {
    handle,
    /** For the host's shutdown path and for tests. */
    async shutdown() {
      session.close();
      await closeWallet();
    },
    /** The hidden testnet switch. Refused once a wallet is open. */
    setNetwork(id) {
      const next = networkFor(id);
      if (!next) throw new CommandError("unknown_network", `'${id}' is not a SWARM network.`);
      if (opened) throw new CommandError("wallet_open", "Lock the wallet before changing network.");
      network = next;
      return network;
    },
    get networkId() {
      return network.id;
    },
    commandNames: Object.keys(commands),
    HOST_VERSION,
  };
}

module.exports = { createRouter, CommandError, HOST_VERSION, ZATOSHIS_PER_COIN };
