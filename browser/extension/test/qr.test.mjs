import test from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

import { encode } from "../lib/qr.js";

/**
 * The encoder is checked by decoding its output with somebody else's decoder.
 *
 * jsQR is the reader the desktop wallet already uses for scanning codes out of
 * images, so it is both independent of this encoder and already trusted in
 * this project. It lives in the wallet's own node_modules; when that is not
 * installed these tests skip rather than fail, and the structural checks below
 * still run.
 */
const require = createRequire(import.meta.url);
let jsQR = null;
for (const candidate of [
  "jsqr",
  "C:/Users/o5o-o/swarm-work/ws-b/privacy-wallet/node_modules/jsqr/dist/jsQR.js",
  "../../../node_modules/jsqr/dist/jsQR.js",
]) {
  try {
    const mod = require(candidate);
    jsQR = mod.default || mod;
    break;
  } catch (_) {
    /* try the next place */
  }
}

/** The code as the pixels a decoder expects: 4 bytes per module, no scaling. */
function toImageData(code, scale = 3, quiet = 4) {
  const side = (code.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const i = (py * side + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: side, height: side };
}

const roundTrip = (text) => {
  const code = encode(text);
  const image = toImageData(code);
  const decoded = jsQR(image.data, image.width, image.height);
  return { code, decoded };
};

// Real shapes: a SWARM mainnet unified address is long, a transparent one is
// short, and a payment URI carries an amount and a memo.
const SHORT_TRANSPARENT = "s1f4PXsXmyLqzHxFZLqkbHz8nYNGKLE4mWL";
const LONG_UNIFIED =
  "swm1qvczs9p8v6sqfhstm7p8u9dwmvctrm6frln0rqv6q9htlgpdz3g6w4hvk6dyy5exsfluy3kzvcy8hm7d2nz0cqjxjgj8e2xkrrpu8w0cxzt2jxldgs8qafvaldunjvezldj3phaz4l8lh9sr5ucnfxdeh7kn08vqt9uq8xxmszhzl3ac4k23uj6glm9cxdmgsrq";
const URI = `swarm:${LONG_UNIFIED}?amount=0.01&memo=thanks`;

test("a short transparent address round-trips", { skip: !jsQR }, () => {
  const { code, decoded } = roundTrip(SHORT_TRANSPARENT);
  assert.ok(decoded, `version ${code.version} did not decode`);
  assert.strictEqual(decoded.data, SHORT_TRANSPARENT);
});

test("a full-length unified address round-trips", { skip: !jsQR }, () => {
  const { code, decoded } = roundTrip(LONG_UNIFIED);
  assert.ok(decoded, `version ${code.version} did not decode`);
  assert.strictEqual(decoded.data, LONG_UNIFIED);
  // Long addresses need version-information blocks, which only exist from 7 up.
  assert.ok(code.version >= 7, `expected a version 7+ code, got ${code.version}`);
});

test("a payment URI with an amount and a memo round-trips", { skip: !jsQR }, () => {
  const { decoded } = roundTrip(URI);
  assert.ok(decoded);
  assert.strictEqual(decoded.data, URI);
});

test("codes of every length up to a long address decode", { skip: !jsQR }, () => {
  for (const length of [1, 10, 40, 100, 160, 220, 300]) {
    const text = "s".repeat(length);
    const { code, decoded } = roundTrip(text);
    assert.ok(decoded, `length ${length} (version ${code.version}) did not decode`);
    assert.strictEqual(decoded.data, text, `length ${length}`);
  }
});

test("the grid is square, odd-sided and carries its finder patterns", () => {
  const code = encode(LONG_UNIFIED);
  assert.strictEqual(code.modules.length, code.size);
  assert.strictEqual(code.modules[0].length, code.size);
  assert.strictEqual((code.size - 17) % 4, 0);
  // The three finder patterns: a dark centre with a light ring around it.
  for (const [cx, cy] of [
    [3, 3],
    [code.size - 4, 3],
    [3, code.size - 4],
  ]) {
    assert.strictEqual(code.modules[cy][cx], true);
    assert.strictEqual(code.modules[cy][cx + 2], false);
    assert.strictEqual(code.modules[cy][cx + 3], true);
  }
});

test("text too long for any version is refused rather than truncated", () => {
  assert.throws(() => encode("x".repeat(5000)));
});

/**
 * The second, independent check: module for module against another encoder.
 *
 * `test/fixtures-qr.json` was produced by the Python `qrcode` library in byte
 * mode at error-correction level M. Nothing of this encoder was used to make
 * it. A fixture passes when one of the eight masks reproduces the reference
 * grid exactly — the mask is the encoder's own choice and both encoders are
 * free to pick differently, but everything underneath it must agree.
 *
 * This is the check that caught the two real bugs in the first draft: the
 * format-information bits written as their own transpose, and the
 * error-correction divisor polynomial handed over lowest-power first.
 */
const fixtures = require("./fixtures-qr.json");

for (const [name, fixture] of Object.entries(fixtures)) {
  test(`matches an independent encoder: ${name} (version ${fixture.version})`, () => {
    const matching = [];
    for (let mask = 0; mask < 8; mask++) {
      const code = encode(fixture.text, { mask });
      assert.strictEqual(code.version, fixture.version, `${name}: version`);
      assert.strictEqual(code.size, fixture.size, `${name}: size`);
      let differences = 0;
      for (let y = 0; y < code.size; y++) {
        for (let x = 0; x < code.size; x++) {
          if ((fixture.rows[y][x] === "1") !== code.modules[y][x]) differences++;
        }
      }
      if (differences === 0) matching.push(mask);
    }
    assert.strictEqual(matching.length, 1, `${name}: expected exactly one mask to reproduce the reference grid`);
  });
}
