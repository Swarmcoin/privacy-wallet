import test from "node:test";
import assert from "node:assert";

import { isOwnPage } from "../lib/sender.js";

const ID = "gmmgmodmgnigcgboccjelpgedejejfap";
const BASE = `chrome-extension://${ID}`;

test("popup without a tab is accepted", () => {
  assert.equal(isOwnPage({ id: ID, origin: BASE, url: `${BASE}/popup.html` }, ID), true);
});

test("onboarding, settings and side panel opened as tabs are accepted", () => {
  for (const page of ["onboarding.html#create", "settings.html", "sidepanel.html"]) {
    const sender = { id: ID, origin: BASE, url: `${BASE}/${page}`, tab: { id: 7 } };
    assert.equal(isOwnPage(sender, ID), true, page);
  }
});

test("url alone is enough when origin is missing", () => {
  assert.equal(isOwnPage({ id: ID, url: `${BASE}/onboarding.html`, tab: { id: 1 } }, ID), true);
});

test("a content script on a web page is refused", () => {
  const sender = { id: ID, origin: "https://example.com", url: "https://example.com/", tab: { id: 3 } };
  assert.equal(isOwnPage(sender, ID), false);
});

test("another extension is refused even with a matching-looking url", () => {
  const other = "abcdefghijklmnopabcdefghijklmnop";
  assert.equal(isOwnPage({ id: other, origin: `chrome-extension://${other}`, url: `chrome-extension://${other}/popup.html` }, ID), false);
  assert.equal(isOwnPage({ id: other, origin: BASE, url: `${BASE}/popup.html` }, ID), false);
});

test("missing origin and url is refused", () => {
  assert.equal(isOwnPage({ id: ID }, ID), false);
  assert.equal(isOwnPage(null, ID), false);
  assert.equal(isOwnPage({ id: ID, origin: BASE }, undefined), false);
});

test("a lookalike origin with a longer id is refused", () => {
  assert.equal(isOwnPage({ id: ID, origin: `${BASE}x`, url: `${BASE}x/popup.html` }, ID), false);
});
