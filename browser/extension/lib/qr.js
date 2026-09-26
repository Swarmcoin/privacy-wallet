/**
 * A QR encoder, in this extension and not fetched from anywhere.
 *
 * A receive screen has to draw a QR code, and every ready-made way of doing
 * that in a browser either pulls a script from a CDN or renders the address on
 * someone else's server. Both are out of the question for a wallet: the first
 * lets a third party replace the code that draws your address, the second
 * tells them the address.
 *
 * Byte mode only, which is all an address needs, error-correction level M, and
 * versions 1 to 40 so a long unified address fits. The algorithm is the one in
 * ISO/IEC 18004; the structure follows Project Nayuki's public-domain
 * description of it (https://www.nayuki.io/page/qr-code-generator-library).
 *
 * It is verified the only way an encoder can honestly be verified: the tests
 * render its output and decode it again with an independent decoder (jsQR, the
 * one the desktop wallet already uses to read codes), for strings the length of
 * real SWARM addresses.
 */

const ECC_CODEWORDS_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

const NUM_ERROR_CORRECTION_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 5, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/** Modules a version holds before the format, version and function patterns. */
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version, ecl) {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl][version]
  );
}

function alignmentPositions(version) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ── GF(256), the field the error-correction code lives in ──────────────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * The divisor polynomial for `degree` error-correction codewords: the product
 * of (x - α^0)…(x - α^(degree-1)) with its leading 1 dropped, written
 * highest-power first.
 *
 * The polynomial is built lowest-power first, because that is what "multiply
 * by x" means in an array, and then reversed. Returning it in the wrong
 * direction is a mistake that still produces plausible-looking codewords and a
 * code no reader will read.
 */
function generatorPoly(degree) {
  let poly = [1]; // ascending: poly[j] is the coefficient of x^j
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  const divisor = [];
  for (let i = degree - 1; i >= 0; i--) divisor.push(poly[i]);
  return divisor;
}

function eccForBlock(data, degree) {
  const gen = generatorPoly(degree);
  const result = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(gen[i], factor);
  }
  return result;
}

/* ── the bit stream ─────────────────────────────────────────────────────── */

function bitStream(bytes, version, ecl) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCodewords(version, ecl) * 8;
  if (bits.length > capacityBits) return null;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let pad = 0xec; codewords.length < dataCodewords(version, ecl); pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Splits the data into blocks, adds error correction, interleaves the result. */
function interleave(codewords, version, ecl) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const data = codewords.slice(k, k + dataLen);
    k += dataLen;
    blocks.push({ data, ecc: eccForBlock(data, blockEccLen) });
  }

  const out = [];
  for (let i = 0; i < shortBlockLen - blockEccLen + 1; i++) {
    blocks.forEach((block, j) => {
      if (i < block.data.length && (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)) out.push(block.data[i]);
    });
  }
  for (let i = 0; i < blockEccLen; i++) for (const block of blocks) out.push(block.ecc[i]);
  return out;
}

/* ── the module grid ────────────────────────────────────────────────────── */

function makeMatrix(version, ecl, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (x, y, dark) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };

  // Timing patterns first, then the finders overwrite their own corners.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const skipCorner =
        (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (skipCorner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve the format areas; the real bits are written per mask below.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) set(i, 8, false);
    if (i !== 6) set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true); // the always-dark module

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // The data, snaking up and down two columns at a time, skipping column 6.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunction[y][x] || i >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }

  return { size, modules, isFunction };
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid, mask) {
  const { size, modules, isFunction } = grid;
  const out = modules.map((row) => row.slice());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && MASKS[mask](x, y)) out[y][x] = !out[y][x];
    }
  }
  return out;
}

function writeFormat(modules, size, ecl, mask) {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) !== 0;

  // `modules` is indexed [y][x]. The first copy runs DOWN column 8 and then
  // LEFT along row 8; the second runs right along row 8 and down column 8.
  // Writing the transpose of this by accident produces a code that looks
  // perfectly well formed and that no reader can read, which is exactly what
  // the first draft of this file did.
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true;
}

/** ISO/IEC 18004 mask penalty. A lower score is a code more readers can read. */
function penalty(modules, size) {
  let score = 0;
  const runScore = (run) => (run >= 5 ? 3 + (run - 5) : 0);

  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (modules[y][x] === modules[y][x - 1]) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (modules[y][x] === modules[y - 1][x]) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }
  const finderLike = [true, false, true, true, true, false, true, false, false, false, false];
  const matches = (get) => {
    let count = 0;
    for (let start = 0; start + finderLike.length <= size; start++) {
      let all = true;
      for (let k = 0; k < finderLike.length; k++) {
        if (get(start + k) !== finderLike[k]) {
          all = false;
          break;
        }
      }
      if (all) count++;
      let allReverse = true;
      for (let k = 0; k < finderLike.length; k++) {
        if (get(start + k) !== finderLike[finderLike.length - 1 - k]) {
          allReverse = false;
          break;
        }
      }
      if (allReverse) count++;
    }
    return count;
  };
  for (let y = 0; y < size; y++) score += 40 * matches((x) => modules[y][x]);
  for (let x = 0; x < size; x++) score += 40 * matches((y) => modules[y][x]);

  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/**
 * `encode(text)` -> `{ size, modules }`, where `modules[y][x]` is true for a
 * dark module. Throws when the text is longer than a version-40 code holds.
 */
function encode(text, options = {}) {
  const ecl = options.ecl || "M";
  const bytes = Array.from(new TextEncoder().encode(String(text)));
  for (let version = 1; version <= 40; version++) {
    const codewords = bitStream(bytes, version, ecl);
    if (!codewords) continue;
    const grid = makeMatrix(version, ecl, interleave(codewords, version, ecl));
    let best = null;
    const masks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
    for (const mask of masks) {
      const masked = applyMask(grid, mask);
      writeFormat(masked, grid.size, ecl, mask);
      const score = penalty(masked, grid.size);
      if (!best || score < best.score) best = { score, modules: masked, mask };
    }
    return { size: grid.size, modules: best.modules, version, mask: best.mask, ecl };
  }
  throw new Error("that text is too long for a QR code");
}

/** Draws a code onto a canvas, one module per `scale` pixels, with a quiet zone. */
function draw(canvas, code, options = {}) {
  const scale = options.scale || 4;
  const quiet = options.quiet === undefined ? 4 : options.quiet;
  const side = (code.size + quiet * 2) * scale;
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = options.light || "#ffffff";
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = options.dark || "#0a0908";
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
  return canvas;
}

export { encode, draw };
