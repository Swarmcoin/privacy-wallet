// Set the SWARM production profile's launch values, from the network manifest.
//
//   node scripts/set-swarm-mainnet-launch.js D:/privacy/network/swarm-mainnet/manifest.json
//   node scripts/set-swarm-mainnet-launch.js <manifest> --check
//
// SWARM production is unselectable in every build so far, and deliberately so:
// `SWARM_MAINNET_GENESIS` is `null`, and a wallet that cannot name a chain's
// first block cannot tell that chain's indexer from any other. Exactly two
// constants have to change for that to stop being true, and they belong to one
// commit. docs/SWARM-NETWORK-PROFILES.md, "What a release fills in", says so.
//
// This script is that commit's mechanical part. It reads the manifest the
// launch ceremony produced -- the same file the node app embeds, rendered by
// D:/privacy/scripts/swarm/render_mainnet_manifest.py -- and writes:
//
//   src/utils/networkProfiles.ts   SWARM_MAINNET_GENESIS  = "<64 hex>"
//                                  SWARM_MAINNET_SERVER   = "<host:port>"
//                                  MAINNET.serverIsLive   = true
//   sdk/swarm-sdk-pin.json         the same two values, with provenance
//
// and nothing else. It does not touch the SDK pin's commit, the testnet
// profile, or any address rule: those were decided earlier and reviewed.
//
// It refuses rather than guesses. A manifest that is not SWARM production, a
// genesis that is not 64 lower-case hex characters, a genesis belonging to
// another chain, a server that is not the reserved production host, a file
// that has already been filled in, or a source file whose two lines are not
// where this script expects them -- each is an error with a reason, and
// nothing is written.

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const PROFILES = path.join(root, "src/utils/networkProfiles.ts");
const PIN = path.join(root, "sdk/swarm-sdk-pin.json");

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const [manifestPath] = argv.filter((a) => !a.startsWith("--"));

const fail = (message) => {
  console.error(`refused: ${message}`);
  process.exit(2);
};

if (!manifestPath) fail("usage: node scripts/set-swarm-mainnet-launch.js <manifest.json> [--check]");

// Genesis hashes that are certainly not SWARM production's. Kept in step with
// the node app's electron/chain/network-profile.js.
const FOREIGN_GENESIS = {
  "00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08": "the upstream Zcash main chain",
  "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38": "the upstream Zcash test chain",
  "045993f5c91ea160c7ebda573dd97b0016816bca68d395bfff202779b88e2a28": "the SWARM testnet",
  "01c34428b9e67cdd8345e0b365aaa37dd8d2d65d3869e0e5d77d567f2c39afdd":
    "the SWARM Mainnet chain abandoned at the restart of 2 October 2026",
};

// The production indexer's name is reserved, and it is the only host this
// script will write. A manifest naming something else is a manifest for a
// different deployment, and that is a decision for a person, not a script.
// Port 443 since the network restart of 2 October 2026 (8443 served the
// abandoned chain).
const EXPECTED_SERVER = "lwd-main.swarm.green:443";

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (e) {
  fail(`cannot read ${manifestPath}: ${e.message}`);
}

const identity = manifest.identity || {};
if (identity.network_name !== "SwarmMainnet" || identity.network_kind !== "SwarmProduction") {
  fail(
    `${manifestPath} describes ${JSON.stringify(identity.network_name || identity.network_kind || "an unnamed network")}, ` +
      "not SWARM production (identity.network_name SwarmMainnet, identity.network_kind SwarmProduction)",
  );
}
if (identity.light_wallet_chain_label !== "swarm-mainnet") {
  fail(`the manifest's chain label is ${JSON.stringify(identity.light_wallet_chain_label)}, not "swarm-mainnet"`);
}

const genesis = String((manifest.genesis || {}).hash || "");
if (!/^[0-9a-f]{64}$/.test(genesis)) {
  fail(`the manifest's genesis hash is not 64 lower-case hex characters: ${JSON.stringify(genesis)}`);
}
if (FOREIGN_GENESIS[genesis]) {
  fail(`the manifest's genesis ${genesis} is ${FOREIGN_GENESIS[genesis]}, not SWARM production's`);
}
if (/^_*$/.test(genesis) || genesis.includes("__")) fail("the manifest still carries a placeholder genesis");

const servers = manifest.light_wallet_servers || [];
const server = String(servers[0] || "");
if (server !== EXPECTED_SERVER) {
  fail(
    `the manifest's light_wallet_servers[0] is ${JSON.stringify(server)}; this script writes only the ` +
      `reserved production indexer ${EXPECTED_SERVER}`,
  );
}

// ---------------------------------------------------------------- the edits

let source = fs.readFileSync(PROFILES, "utf8");

const edits = [
  {
    what: "SWARM_MAINNET_GENESIS",
    // `null` before the first launch; a 64-hex value when a restart replaces
    // the genesis, as the one of 2 October 2026 did.
    find: /export const SWARM_MAINNET_GENESIS: string \| null = (?:null|"[0-9a-f]{64}");/,
    to: `export const SWARM_MAINNET_GENESIS: string | null = "${genesis}";`,
  },
  {
    what: "SWARM_MAINNET_SERVER",
    find: /export const SWARM_MAINNET_SERVER = "[^"]*";/,
    to: `export const SWARM_MAINNET_SERVER = "${server}";`,
  },
  {
    // Only the production record's flag. The testnet record's `serverIsLive`
    // is already true, so an unanchored replace would be a no-op there -- but
    // anchoring it to the line after `defaultServer: SWARM_MAINNET_SERVER`
    // means this can never reach the wrong profile.
    what: "MAINNET.serverIsLive",
    find: /(defaultServer: SWARM_MAINNET_SERVER,\n {2})serverIsLive: (?:false|true),/,
    to: "$1serverIsLive: true,",
  },
];

for (const edit of edits) {
  if (!edit.find.test(source)) {
    fail(
      `${edit.what} is not where this script expects it in src/utils/networkProfiles.ts. ` +
        "Either it has already been set, or the file was restructured -- either way, look before writing.",
    );
  }
  source = source.replace(edit.find, edit.to);
}

const pin = JSON.parse(fs.readFileSync(PIN, "utf8"));
pin.mainnet = {
  state: "LAUNCHED",
  chainLabel: "swarm-mainnet",
  sdkChainType: "ChainType::SwarmMainnet(SwarmMainnetGenesis)",
  genesis,
  server,
  serverIsLive: true,
  genesisTimeUtc: (manifest.genesis || {}).time_utc || null,
  manifestSource: path.resolve(manifestPath).replace(/\\/g, "/"),
  manifestSha256: require("crypto").createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex"),
  chainHint: `swarm-mainnet:${genesis}`,
  note:
    "Set by scripts/set-swarm-mainnet-launch.js from the launch-ceremony manifest. The chain hint is " +
    "what the addon is given; ChainType::try_from(\"swarm-mainnet\") without a genesis remains an error.",
};

if (check) {
  console.log(`would set SWARM_MAINNET_GENESIS = ${genesis}`);
  console.log(`would set SWARM_MAINNET_SERVER  = ${server}`);
  console.log("would set MAINNET.serverIsLive  = true");
  console.log(`chain hint                      = swarm-mainnet:${genesis}`);
  console.log("nothing written (--check)");
  process.exit(0);
}

fs.writeFileSync(PROFILES, source);
fs.writeFileSync(PIN, `${JSON.stringify(pin, null, 2)}\n`);

console.log(`src/utils/networkProfiles.ts  genesis ${genesis}`);
console.log(`                              server  ${server}, live`);
console.log(`sdk/swarm-sdk-pin.json        mainnet block recorded`);
console.log("");
console.log("Now run the suite before committing:");
console.log("  yarn test:run");
