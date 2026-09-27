/**
 * The relay: a store-and-forward for blobs neither it nor anyone watching it
 * can read.
 *
 * The coordinating machine seals the proposal under the session code and
 * PUTs it. The second machine fetches, opens it with the code its owner
 * typed, signs, seals the signature under the same code and PUTs that back.
 * The coordinator polls, opens the signatures, combines and broadcasts.
 *
 * What the relay holds is a 64-character hex path and some `age` ciphertext,
 * for at most 24 hours. It is told nothing else: not the fund, not the
 * amount, not the recipient, not who the two machines are. It could be run by
 * someone hostile and the worst it could do is fail to deliver, which the
 * page notices and which costs a re-share and nothing else.
 *
 * Everything here is transport. The sealing and the session-id derivation are
 * in the addon (`native/src/treasury.rs`), because the format is `age` and
 * this application does not implement `age` twice.
 */

/** What one machine puts on the relay for the other. */
export type RelayEnvelopeKind = "proposal" | "signature";

/**
 * The plaintext inside a sealed blob.
 *
 * Versioned, because a build that meets a blob from a build it does not
 * understand must say so rather than half-read it in front of someone who is
 * about to sign.
 */
export type RelayEnvelope =
  | {
      v: 1;
      kind: "proposal";
      /** The fund policy this proposal is bound to, verbatim. */
      policy: string;
      /** The proposal file, verbatim. */
      proposal: string;
      /** The proposal hash, repeated outside the file so a mismatch is loud. */
      proposalHash: string;
      /** Which machine wrote it, for the screen. Not trusted for anything. */
      from: string;
    }
  | {
      v: 1;
      kind: "signature";
      /** The signature file, verbatim. */
      signature: string;
      /** The proposal it was made over. */
      proposalHash: string;
      /** The signer's fingerprint, repeated for the screen. */
      fingerprint: string;
      from: string;
    };

/** One blob as the relay hands it back. */
export type RelayBlob = {
  slot: number;
  created: string;
  size: number;
  /** base64 of the ciphertext. */
  body: string;
};

/** What a GET answers. */
export type RelaySession = {
  session: string;
  count: number;
  expires_at: string;
  blobs: RelayBlob[];
};

/** The raw transport, so the tests do not need Electron. */
export type RelayTransport = (request: {
  baseUrl: string;
  method: "GET" | "PUT";
  session: string;
  bodyHex?: string;
}) => Promise<{ ok: boolean; status: number; text: string }>;

/** Base64 of a hex string, without pulling in a dependency for it. */
export function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The inverse, for reading a blob the relay handed back. */
export function base64ToHex(base64: string): string {
  const binary = atob(base64);
  let hex = "";
  for (let i = 0; i < binary.length; i += 1) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/** The ceiling the relay enforces, mirrored so a blob never leaves oversized. */
export const RELAY_MAX_BLOB_BYTES = 64 * 1024;

export class RelayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RelayError";
    this.status = status;
  }
}

/** Turns a relay status into a sentence about what to do next. */
export function relayFailure(status: number, body: string): string {
  switch (status) {
    case 404:
      return "Nothing is waiting under that code. Either it has not been shared yet, or the 24 hours have passed and the coordinator needs to share it again.";
    case 409:
      return "That session already holds as many blobs as it may. Start a new payout.";
    case 413:
      return "That is too large for the relay. This is a defect: tell the planner.";
    case 429:
      return "The relay is rate-limiting this machine. Wait a minute and try again.";
    case 503:
      return "The relay is full. Wait a few minutes, or use the offline file ceremony.";
    default:
      return `The relay answered ${status}. ${body.slice(0, 200)}`;
  }
}

export class RelayClient {
  private readonly baseUrl: string;

  private readonly transport: RelayTransport;

  constructor(baseUrl: string, transport: RelayTransport) {
    this.baseUrl = baseUrl;
    this.transport = transport;
  }

  /** Puts one sealed blob into a session. */
  async put(session: string, ciphertextHex: string): Promise<{ slot: number; count: number }> {
    if (ciphertextHex.length / 2 > RELAY_MAX_BLOB_BYTES) {
      throw new RelayError(
        `this blob is ${Math.round(ciphertextHex.length / 2)} bytes and the relay takes ${RELAY_MAX_BLOB_BYTES}`,
        413,
      );
    }
    const answer = await this.transport({
      baseUrl: this.baseUrl,
      method: "PUT",
      session,
      bodyHex: ciphertextHex,
    });
    if (!answer.ok) throw new RelayError(relayFailure(answer.status, answer.text), answer.status);
    const parsed = JSON.parse(answer.text) as { slot: number; count: number };
    return { slot: parsed.slot, count: parsed.count };
  }

  /**
   * Reads every blob in a session.
   *
   * An absent session is not an error here: it is the ordinary state of a
   * session the other machine has not answered yet, and the caller polls.
   */
  async get(session: string): Promise<RelaySession | null> {
    const answer = await this.transport({ baseUrl: this.baseUrl, method: "GET", session });
    if (answer.status === 404) return null;
    if (!answer.ok) throw new RelayError(relayFailure(answer.status, answer.text), answer.status);
    return JSON.parse(answer.text) as RelaySession;
  }
}

/**
 * Reads an envelope out of a decrypted blob, refusing anything this build
 * does not understand.
 *
 * Every field is checked before any of it reaches a screen. A blob is
 * ciphertext from a machine this one has never authenticated — the session
 * code proves that whoever wrote it knew the code, and nothing more.
 */
export function parseEnvelope(plaintext: string): RelayEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("that blob opened, but what came out is not a payout envelope");
  }
  const envelope = parsed as Partial<RelayEnvelope> & { v?: unknown; kind?: unknown };
  if (envelope.v !== 1) {
    throw new Error(
      `this blob was written by a different version of the Treasury page (v${String(envelope.v)}). Both machines must run the same build.`,
    );
  }
  if (envelope.kind === "proposal") {
    const candidate = envelope as Extract<RelayEnvelope, { kind: "proposal" }>;
    if (
      typeof candidate.policy !== "string" ||
      typeof candidate.proposal !== "string" ||
      typeof candidate.proposalHash !== "string"
    ) {
      throw new Error("that blob says it is a proposal but is missing part of one");
    }
    return { ...candidate, from: String(candidate.from ?? "") };
  }
  if (envelope.kind === "signature") {
    const candidate = envelope as Extract<RelayEnvelope, { kind: "signature" }>;
    if (typeof candidate.signature !== "string" || typeof candidate.proposalHash !== "string") {
      throw new Error("that blob says it is a signature but is missing part of one");
    }
    return {
      ...candidate,
      fingerprint: String(candidate.fingerprint ?? ""),
      from: String(candidate.from ?? ""),
    };
  }
  throw new Error(`that blob is neither a proposal nor a signature (kind: ${String(envelope.kind)})`);
}
