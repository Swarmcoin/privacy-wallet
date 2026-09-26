"use strict";

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");

const { FrameReader, encodeMessage, MAX_INBOUND_BYTES, MAX_OUTBOUND_BYTES, LITTLE_ENDIAN } = require("../src/framing");

const lengthOf = (buf) => (LITTLE_ENDIAN ? buf.readUInt32LE(0) : buf.readUInt32BE(0));

const frame = (value) => encodeMessage(value);

test("the length prefix is the machine's own byte order, as Chromium writes it", () => {
  assert.strictEqual(LITTLE_ENDIAN, os.endianness() === "LE");
  const encoded = frame({ a: 1 });
  assert.strictEqual(lengthOf(encoded), encoded.length - 4);
});

test("a message round-trips through the reader", () => {
  const reader = new FrameReader();
  reader.push(frame({ id: 7, command: "status" }));
  const out = reader.read();
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { ok: true, value: { id: 7, command: "status" } });
});

test("a message split across chunks is held until it is whole", () => {
  const encoded = frame({ id: 1, command: "balance" });
  const reader = new FrameReader();
  reader.push(encoded.subarray(0, 3));
  assert.deepStrictEqual(reader.read(), []);
  reader.push(encoded.subarray(3, 6));
  assert.deepStrictEqual(reader.read(), []);
  reader.push(encoded.subarray(6));
  assert.deepStrictEqual(reader.read()[0].value, { id: 1, command: "balance" });
});

test("several messages in one chunk all come out, in order", () => {
  const reader = new FrameReader();
  reader.push(Buffer.concat([frame({ id: 1 }), frame({ id: 2 }), frame({ id: 3 })]));
  assert.deepStrictEqual(
    reader.read().map((m) => m.value.id),
    [1, 2, 3],
  );
});

test("a non-JSON body fails that message only; the stream keeps going", () => {
  const body = Buffer.from("not json", "utf8");
  const header = Buffer.alloc(4);
  if (LITTLE_ENDIAN) header.writeUInt32LE(body.length, 0);
  else header.writeUInt32BE(body.length, 0);
  const reader = new FrameReader();
  reader.push(Buffer.concat([header, body, frame({ id: 9 })]));
  const out = reader.read();
  assert.strictEqual(out[0].ok, false);
  assert.strictEqual(out[0].code, "bad_json");
  assert.strictEqual(out[1].value.id, 9);
  assert.strictEqual(reader.fatal, null);
});

test("an oversized length prefix is fatal and allocates nothing", () => {
  const header = Buffer.alloc(4);
  const huge = MAX_INBOUND_BYTES + 1;
  if (LITTLE_ENDIAN) header.writeUInt32LE(huge, 0);
  else header.writeUInt32BE(huge, 0);
  const reader = new FrameReader();
  reader.push(header);
  assert.deepStrictEqual(reader.read(), []);
  assert.ok(reader.fatal);
  assert.strictEqual(reader.fatal.code, "frame_too_large");
  // Nothing more is read once the stream is no longer frame-aligned.
  reader.push(frame({ id: 1 }));
  assert.deepStrictEqual(reader.read(), []);
});

test("a length of exactly the limit is accepted", () => {
  const filler = "x".repeat(MAX_INBOUND_BYTES - 20);
  const encoded = frame({ m: filler });
  assert.ok(encoded.length - 4 <= MAX_INBOUND_BYTES);
  const reader = new FrameReader();
  reader.push(encoded);
  assert.strictEqual(reader.read()[0].value.m.length, filler.length);
});

test("a reply larger than Chromium's 1 MB limit is refused, not truncated", () => {
  const tooBig = { blob: "y".repeat(MAX_OUTBOUND_BYTES + 10) };
  assert.throws(() => encodeMessage(tooBig), (e) => e.code === "message_too_large");
});

test("a zero-length message is a valid frame", () => {
  const encoded = frame(null);
  const reader = new FrameReader();
  reader.push(encoded);
  assert.strictEqual(reader.read()[0].value, null);
});

test("unicode is measured in bytes, not characters", () => {
  const encoded = frame({ memo: "⬢⬢⬢" });
  assert.strictEqual(lengthOf(encoded), Buffer.byteLength(JSON.stringify({ memo: "⬢⬢⬢" }), "utf8"));
});
