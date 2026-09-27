import test from "node:test";
import assert from "node:assert";

import {
  REWARDS_ADDRESS_REQUEST,
  REWARDS_EXTENSION_ID,
  addressAnswer,
  isAddressRequest,
  isRewardsSender,
  mayAnswerRewards,
} from "../lib/rewards.js";

const ID = REWARDS_EXTENSION_ID;
const BASE = `chrome-extension://${ID}`;
const ASK = { type: REWARDS_ADDRESS_REQUEST };

test("the rewards id is the one the manifest key produces", () => {
  assert.equal(ID, "gjmgdanakkpkgpmecnecoliifonlapnb");
  assert.equal(ID.length, 32);
});

test("the rewards extension's own pages may ask", () => {
  assert.equal(isRewardsSender({ id: ID, origin: BASE, url: `${BASE}/popup.html` }, ID), true);
  assert.equal(isRewardsSender({ id: ID, origin: BASE, url: `${BASE}/rewards.html` }, ID), true);
  assert.equal(isRewardsSender({ id: ID, url: `${BASE}/background.js` }, ID), true, "its service worker");
  assert.equal(isRewardsSender({ id: ID, origin: BASE }, ID), true, "origin alone is proof enough");
});

test("any other extension is refused", () => {
  const other = "abcdefghijklmnopabcdefghijklmnop";
  assert.equal(isRewardsSender({ id: other, origin: `chrome-extension://${other}` }, ID), false);
  // Claiming our origin while carrying another id does not help.
  assert.equal(isRewardsSender({ id: other, origin: BASE, url: `${BASE}/popup.html` }, ID), false);
});

test("an id that merely starts or ends the same is refused", () => {
  assert.equal(isRewardsSender({ id: `${ID}x`, origin: `${BASE}x` }, ID), false);
  assert.equal(isRewardsSender({ id: ID.slice(0, 31), origin: BASE }, ID), false);
  assert.equal(isRewardsSender({ id: ID.toUpperCase(), origin: BASE }, ID), false);
});

test("a web page is refused", () => {
  assert.equal(isRewardsSender({ origin: "https://swarm.green", url: "https://swarm.green/" }, ID), false);
  assert.equal(isRewardsSender({ id: ID, origin: "https://swarm.green", url: "https://swarm.green/", tab: { id: 4 } }, ID), false);
});

test("a content script is refused: it carries the page's origin, not ours", () => {
  const injected = { id: ID, origin: "https://example.com", url: "https://example.com/article", tab: { id: 9 } };
  assert.equal(isRewardsSender(injected, ID), false);
});

test("the Rewards page in a tab is accepted: having a tab is not a reason to refuse", () => {
  // rewards.html is an ordinary tab, exactly as the wallet's own settings page
  // is (lib/sender.js makes the same call).
  assert.equal(isRewardsSender({ id: ID, origin: BASE, url: `${BASE}/rewards.html`, tab: { id: 9 } }, ID), true);
});

test("an id on its own is not proof of where the message came from", () => {
  assert.equal(isRewardsSender({ id: ID }, ID), false);
  assert.equal(isRewardsSender({ id: ID, tab: { id: 2 } }, ID), false);
});

test("a lookalike origin or url is refused", () => {
  assert.equal(isRewardsSender({ id: ID, origin: `${BASE}.evil.example` }, ID), false);
  assert.equal(isRewardsSender({ id: ID, url: `${BASE}x/popup.html` }, ID), false);
  assert.equal(isRewardsSender({ id: ID, url: `https://evil.example/${ID}/popup.html` }, ID), false);
});

test("no sender, no id, no allow-list: refused", () => {
  assert.equal(isRewardsSender(null, ID), false);
  assert.equal(isRewardsSender(undefined, ID), false);
  assert.equal(isRewardsSender({}, ID), false);
  assert.equal(isRewardsSender("gjmg", ID), false);
  assert.equal(isRewardsSender({ id: ID, origin: BASE }, ""), false);
  assert.equal(isRewardsSender({ id: ID, origin: BASE }, undefined), true, "the default is the rewards id");
});

test("the one question is accepted", () => {
  assert.equal(isAddressRequest(ASK), true);
  assert.equal(isAddressRequest({ type: "swarm.rewards.address" }), true);
});

test("no other question is accepted", () => {
  for (const message of [
    { type: "swarm.command", command: "addresses" },
    { type: "swarm.command", command: "history" },
    { type: "swarm.rewards.seed" },
    { type: "swarm.rewards.address " },
    { type: "SWARM.REWARDS.ADDRESS" },
    { type: "swarm.rewards.balance" },
  ]) {
    assert.equal(isAddressRequest(message), false, JSON.stringify(message));
  }
});

test("the question may not carry a smuggled command or parameters", () => {
  assert.equal(isAddressRequest({ type: REWARDS_ADDRESS_REQUEST, command: "send" }), false);
  assert.equal(isAddressRequest({ type: REWARDS_ADDRESS_REQUEST, params: { to: "swm1…" } }), false);
  assert.equal(isAddressRequest({ type: REWARDS_ADDRESS_REQUEST, reveal: "seed" }), false);
});

test("junk is not a question", () => {
  for (const junk of [null, undefined, "", "swarm.rewards.address", 7, [], [{ type: REWARDS_ADDRESS_REQUEST }]]) {
    assert.equal(isAddressRequest(junk), false, JSON.stringify(junk));
  }
});

test("both halves must hold before the wallet considers answering", () => {
  assert.equal(mayAnswerRewards({ id: ID, origin: BASE }, ASK, ID), true);
  assert.equal(mayAnswerRewards({ id: "abcdefghijklmnopabcdefghijklmnop", origin: BASE }, ASK, ID), false);
  assert.equal(mayAnswerRewards({ id: ID, origin: BASE }, { type: "swarm.command", command: "history" }, ID), false);
  assert.equal(mayAnswerRewards(null, null, ID), false);
});

test("the answer carries an address and a network and nothing else", () => {
  const answer = addressAnswer("swm1q9s8y9x8gf2tvdw0s3jn54khce6mua7l", "swarm-mainnet");
  assert.deepEqual(Object.keys(answer).sort(), ["ok", "result"]);
  assert.deepEqual(Object.keys(answer.result).sort(), ["address", "network"]);
  assert.equal(answer.ok, true);
  assert.equal(answer.result.address, "swm1q9s8y9x8gf2tvdw0s3jn54khce6mua7l");
  assert.equal(answer.result.network, "swarm-mainnet");
});

test("the answer cannot be widened by what it is built from", () => {
  const fromHost = {
    unified: "swm1q9s8y9x8gf2tvdw0s3jn54khce6mua7l",
    transparent: "s1SomethingVisible",
    allUnified: ["swm1…", "swm1…"],
    seed: "never ever",
  };
  const answer = addressAnswer(fromHost.unified, "swarm-mainnet");
  const wire = JSON.stringify(answer);
  assert.equal(wire.includes("s1SomethingVisible"), false);
  assert.equal(wire.includes("never ever"), false);
  assert.equal(wire.includes("allUnified"), false);
  assert.equal(answer.result.network, "swarm-mainnet");
});

test("a missing network is null, not undefined or a guess", () => {
  assert.equal(addressAnswer("swm1q9s8", null).result.network, null);
  assert.equal(addressAnswer("swm1q9s8").result.network, null);
});
