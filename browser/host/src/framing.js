"use strict";

/**
 * Chromium native-messaging framing.
 *
 * Every message is UTF-8 JSON preceded by its byte length as a 32-bit integer
 * in the platform's native byte order. Chromium writes and reads that prefix
 * with the machine's own endianness, so this file does too: Node's
 * `os.endianness()` is the same answer the browser gets from the CPU.
 *
 * Two limits, both Chromium's and both enforced here rather than trusted:
 *
 *  - a message the host sends may not exceed 1 MB. Chromium closes the port
 *    when it does, which looks to the user like the wallet died; so an
 *    oversized reply is refused here, where it can be turned into an error the
 *    popup can show.
 *  - a message the extension sends may be up to 64 MiB. Nothing this host
 *    understands is larger than a few kilobytes, so the reader caps inbound
 *    frames far lower. A length prefix is the one field an attacker controls
 *    before any parsing happens, and an unbounded one is an allocation of
 *    whatever number they wrote.
 */

const os = require("os");

const LITTLE_ENDIAN = os.endianness() === "LE";

/** Chromium's own ceiling for a host -> extension message. */
const MAX_OUTBOUND_BYTES = 1024 * 1024;

/**
 * The ceiling for an extension -> host message.
 *
 * Chromium allows 64 MiB. This host's largest legitimate input is a 24-word
 * seed phrase or a memo, so 256 KiB is already generous, and anything past it
 * is a mistake or an attack rather than a payment.
 */
const MAX_INBOUND_BYTES = 256 * 1024;

const writeLength = (buf, value) => {
  if (LITTLE_ENDIAN) buf.writeUInt32LE(value, 0);
  else buf.writeUInt32BE(value, 0);
};

const readLength = (buf, offset) => (LITTLE_ENDIAN ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset));

/** One message, as the bytes Chromium expects on stdout. */
function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > MAX_OUTBOUND_BYTES) {
    const error = new Error(`message of ${body.length} bytes exceeds the ${MAX_OUTBOUND_BYTES} byte native-messaging limit`);
    error.code = "message_too_large";
    throw error;
  }
  const header = Buffer.alloc(4);
  writeLength(header, body.length);
  return Buffer.concat([header, body]);
}

/**
 * A stream of stdin chunks turned into whole messages.
 *
 * Deliberately not an EventEmitter: `read()` hands back the messages that are
 * complete and nothing else, so a caller cannot accidentally process a frame
 * while another is still arriving.
 */
class FrameReader {
  constructor(options = {}) {
    this.maxBytes = options.maxBytes || MAX_INBOUND_BYTES;
    this.buffer = Buffer.alloc(0);
    /** Set once a frame was too large; the transport is not recoverable after that. */
    this.fatal = null;
  }

  push(chunk) {
    if (this.fatal) return;
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
  }

  /**
   * Every complete message now in the buffer.
   *
   * Each entry is `{ ok: true, value }` for a frame that parsed, or
   * `{ ok: false, code, message }` for one whose body was not JSON — a bad
   * body is one request's problem, not the connection's, so the reader keeps
   * going. A bad LENGTH is the connection's problem: the stream is no longer
   * aligned to any frame boundary, so `fatal` is set and nothing more is read.
   */
  read() {
    const out = [];
    if (this.fatal) return out;
    for (;;) {
      if (this.buffer.length < 4) break;
      const length = readLength(this.buffer, 0);
      if (length > this.maxBytes) {
        this.fatal = {
          code: "frame_too_large",
          message: `a ${length} byte message exceeds this host's ${this.maxBytes} byte limit`,
        };
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch (e) {
        out.push({ ok: false, code: "bad_json", message: "message body is not JSON" });
        continue;
      }
      out.push({ ok: true, value: parsed });
    }
    return out;
  }
}

module.exports = {
  LITTLE_ENDIAN,
  MAX_INBOUND_BYTES,
  MAX_OUTBOUND_BYTES,
  FrameReader,
  encodeMessage,
};
