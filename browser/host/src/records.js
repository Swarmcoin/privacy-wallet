"use strict";

/**
 * The host's own record of its wallet: which chain the wallet file belongs to.
 *
 * The desktop wallet keeps a list of wallet records (`wallets.json`) and, since
 * 0.1.0-mainnet.10, writes the SWARM Mainnet genesis into each one. The browser
 * host has one wallet and kept no record at all, so this is that record: a small
 * JSON file beside the wallet file,
 *
 *     <wallet base dir>/swarm-mainnet/swarm-browser-wallet.dat.record.json
 *
 * holding `{ "network": "swarm-mainnet", "genesis": "<64 hex>" }`.
 *
 * Why a record and not the wallet file: the wallet file stores the network's
 * TAG for SWARM Mainnet, never the genesis it was synced against, so it cannot
 * say whether it holds the abandoned chain's state. Every browser wallet made
 * by a host before 0.2.0 has no record, and every one of those was made on the
 * abandoned chain (no earlier host could reach any other).
 *
 * No key material is ever written here.
 */

const fs = require("fs");
const path = require("path");

const RECORD_SUFFIX = ".record.json";

function createRecordStore(baseDir, fsImpl = fs) {
  const recordPath = (network, walletFileName) =>
    path.join(baseDir, network.walletSubdir, `${walletFileName}${RECORD_SUFFIX}`);

  return {
    recordPath,

    /** The record, or null when there is none or it cannot be read. */
    read(network, walletFileName) {
      try {
        const parsed = JSON.parse(fsImpl.readFileSync(recordPath(network, walletFileName), "utf8"));
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (_) {
        return null;
      }
    },

    /** Writes the record through a temporary file and a rename. Throws on failure. */
    write(network, walletFileName, record) {
      const target = recordPath(network, walletFileName);
      fsImpl.mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.tmp`;
      fsImpl.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      fsImpl.renameSync(temp, target);
      return target;
    },
  };
}

/** An in-memory store with the same shape, for tests. */
function createMemoryRecordStore(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const key = (network, walletFileName) => `${network.walletSubdir}/${walletFileName}`;
  return {
    rows,
    writes: [],
    recordPath: (network, walletFileName) => `memory:${key(network, walletFileName)}${RECORD_SUFFIX}`,
    read(network, walletFileName) {
      const row = rows.get(key(network, walletFileName));
      return row ? { ...row } : null;
    },
    write(network, walletFileName, record) {
      if (this.failWrites) throw new Error("record write refused (test)");
      rows.set(key(network, walletFileName), { ...record });
      this.writes.push({ key: key(network, walletFileName), record: { ...record } });
      return `memory:${key(network, walletFileName)}`;
    },
  };
}

module.exports = { createRecordStore, createMemoryRecordStore, RECORD_SUFFIX };
