import test from "node:test";
import assert from "node:assert";

import { FORBIDDEN, hasForbiddenFields, isUnifiedAddress, readAddress, shortAddress } from "../lib/link.js";

// Bech32m charset only (no 1, b, i or o), the shape the wallet hands over.
const MAINNET = "swm1q9s8y9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l";
const TESTNET = "swarm1q9s8v0j4cm7py82dsnkeulz9gtw35h6aqrxfv0j4cm7py82dsnkeulz9gtw3";

test("a mainnet unified address is accepted", () => {
  const read = readAddress({ ok: true, result: { address: MAINNET, network: "swarm-mainnet" } });
  assert.deepEqual(read, { ok: true, address: MAINNET, network: "swarm-mainnet" });
});

test("a testnet unified address is accepted", () => {
  assert.equal(readAddress({ ok: true, result: { address: TESTNET } }).ok, true);
  assert.equal(readAddress({ ok: true, result: { address: TESTNET } }).network, null);
});

test("surrounding whitespace is trimmed, inner whitespace is refused", () => {
  assert.equal(readAddress({ ok: true, result: { address: `  ${MAINNET}\n` } }).address, MAINNET);
  assert.equal(readAddress({ ok: true, result: { address: `${MAINNET} ${MAINNET}` } }).ok, false);
});

test("a recovery phrase is not an address", () => {
  const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  const read = readAddress({ ok: true, result: { address: phrase } });
  assert.equal(read.ok, false);
  assert.equal(read.code, "bad_address");
});

test("another chain's address is refused", () => {
  for (const other of ["u1qw3e4r5t6y7u8i9o0p1q2w3e4r5t6y7u8i9o0p1q2w3e4r5t6y7u8i9o0", "zs1abcdefghijkmnopqrstuvwxyz023456789", "s1SomeTransparentThing", "0xdeadbeef"]) {
    assert.equal(readAddress({ ok: true, result: { address: other } }).ok, false, other);
  }
});

test("a short lookalike is refused", () => {
  assert.equal(isUnifiedAddress("swm1"), false);
  assert.equal(isUnifiedAddress("swm1qqqq"), false);
  assert.equal(isUnifiedAddress(MAINNET), true);
});

test("bech32m's excluded letters are excluded", () => {
  assert.equal(isUnifiedAddress(MAINNET.replace("q9s8", "q9sb")), false, "b is not in the charset");
  assert.equal(isUnifiedAddress(MAINNET.replace("q9s8", "q9si")), false, "i is not in the charset");
  assert.equal(isUnifiedAddress(MAINNET.toUpperCase()), false, "upper case is not accepted");
});

test("an answer that carries anything secret is dropped whole", () => {
  for (const field of FORBIDDEN) {
    const result = { address: MAINNET, [field]: "whatever this is" };
    const read = readAddress({ ok: true, result });
    assert.equal(read.ok, false, field);
    assert.equal(read.code, "too_much", field);
  }
});

test("hasForbiddenFields sees a field even when it is empty or null", () => {
  assert.equal(hasForbiddenFields({ address: MAINNET }), false);
  assert.equal(hasForbiddenFields({ address: MAINNET, seed: null }), true);
  assert.equal(hasForbiddenFields({ address: MAINNET, balance: 0 }), true);
  assert.equal(hasForbiddenFields(null), false);
});

test("a refusal from the wallet is passed through with its reason", () => {
  const read = readAddress({ ok: false, error: { code: "consent_required", message: "Open the wallet popup." } });
  assert.deepEqual(read, { ok: false, code: "consent_required", message: "Open the wallet popup." });
});

test("a refusal with no detail still has a code and a sentence", () => {
  const read = readAddress({ ok: false });
  assert.equal(read.ok, false);
  assert.equal(read.code, "refused");
  assert.equal(typeof read.message, "string");
  assert.ok(read.message.length > 0);
});

test("no answer at all is not a link", () => {
  for (const nothing of [undefined, null, "", 0, "swm1..."]) {
    const read = readAddress(nothing);
    assert.equal(read.ok, false, JSON.stringify(nothing));
    assert.equal(read.code, "no_answer");
  }
});

test("an answer with no result is refused, not read as empty", () => {
  assert.equal(readAddress({ ok: true }).ok, false);
  assert.equal(readAddress({ ok: true, result: {} }).code, "bad_address");
});

test("shortAddress folds the middle and keeps both ends", () => {
  const short = shortAddress(MAINNET);
  assert.ok(short.startsWith(MAINNET.slice(0, 12)));
  assert.ok(short.endsWith(MAINNET.slice(-8)));
  assert.ok(short.length < MAINNET.length);
  assert.equal(shortAddress("swm1short"), "swm1short");
  assert.equal(shortAddress(null), "");
});
