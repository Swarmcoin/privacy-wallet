import {
  RELAY_MAX_BLOB_BYTES,
  RelayClient,
  RelayError,
  base64ToHex,
  hexToBase64,
  parseEnvelope,
  relayFailure,
  type RelayTransport,
} from "./relayClient";

const answering = (
  answers: { ok: boolean; status: number; text: string }[],
): { transport: RelayTransport; calls: Parameters<RelayTransport>[0][] } => {
  const calls: Parameters<RelayTransport>[0][] = [];
  let i = 0;
  const transport: RelayTransport = async (request) => {
    calls.push(request);
    const answer = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return answer;
  };
  return { transport, calls };
};

const SESSION = "ab".repeat(32);

describe("base64 and hex", () => {
  it("round trips arbitrary bytes", () => {
    const hex = "00ff107a2b3c4d5e6f";
    expect(base64ToHex(hexToBase64(hex))).toBe(hex);
  });

  it("round trips an empty blob without inventing bytes", () => {
    expect(base64ToHex(hexToBase64(""))).toBe("");
  });
});

describe("putting a blob on the relay", () => {
  it("sends the ciphertext to the session's path and reports the slot", async () => {
    const { transport, calls } = answering([
      { ok: true, status: 201, text: JSON.stringify({ slot: 0, count: 1 }) },
    ]);
    const client = new RelayClient("https://lwd-main.swarm.green", transport);
    await expect(client.put(SESSION, "deadbeef")).resolves.toEqual({ slot: 0, count: 1 });
    expect(calls[0]).toEqual({
      baseUrl: "https://lwd-main.swarm.green",
      method: "PUT",
      session: SESSION,
      bodyHex: "deadbeef",
    });
  });

  it("refuses an oversized blob here rather than letting the relay refuse it", async () => {
    const { transport, calls } = answering([{ ok: true, status: 201, text: "{}" }]);
    const client = new RelayClient("https://lwd-main.swarm.green", transport);
    const tooBig = "ab".repeat(RELAY_MAX_BLOB_BYTES + 1);
    await expect(client.put(SESSION, tooBig)).rejects.toBeInstanceOf(RelayError);
    expect(calls).toHaveLength(0);
  });

  it("turns a refusal into a sentence about what to do", async () => {
    const { transport } = answering([{ ok: false, status: 429, text: "slow down" }]);
    const client = new RelayClient("https://lwd-main.swarm.green", transport);
    await expect(client.put(SESSION, "aa")).rejects.toThrow("rate-limiting");
  });
});

describe("reading a session", () => {
  it("answers null for a session nobody has written to, because that is normal", async () => {
    const { transport } = answering([{ ok: false, status: 404, text: "" }]);
    const client = new RelayClient("https://lwd-main.swarm.green", transport);
    await expect(client.get(SESSION)).resolves.toBeNull();
  });

  it("hands back the blobs in slot order", async () => {
    const body = {
      session: SESSION,
      count: 2,
      expires_at: "2026-09-28T00:00:00Z",
      blobs: [
        { slot: 0, created: "2026-09-27T00:00:00Z", size: 4, body: hexToBase64("aabbccdd") },
        { slot: 1, created: "2026-09-27T00:01:00Z", size: 2, body: hexToBase64("eeff") },
      ],
    };
    const { transport } = answering([{ ok: true, status: 200, text: JSON.stringify(body) }]);
    const client = new RelayClient("https://lwd-main.swarm.green", transport);
    const session = await client.get(SESSION);
    expect(session?.blobs.map((b) => base64ToHex(b.body))).toEqual(["aabbccdd", "eeff"]);
  });

  it("explains an expired session in terms of the 24 hours", () => {
    expect(relayFailure(404, "")).toContain("24 hours");
    expect(relayFailure(503, "")).toContain("full");
    expect(relayFailure(418, "teapot")).toContain("418");
  });
});

describe("the envelope inside a blob", () => {
  it("reads a proposal envelope", () => {
    const envelope = parseEnvelope(
      JSON.stringify({
        v: 1,
        kind: "proposal",
        policy: "{}",
        proposal: "{}",
        proposalHash: "ab".repeat(32),
        from: "coordinator",
      }),
    );
    expect(envelope.kind).toBe("proposal");
  });

  it("reads a signature envelope", () => {
    const envelope = parseEnvelope(
      JSON.stringify({
        v: 1,
        kind: "signature",
        signature: "{}",
        proposalHash: "ab".repeat(32),
        fingerprint: "0123456789abcdef",
        from: "B",
      }),
    );
    expect(envelope.kind).toBe("signature");
    if (envelope.kind !== "signature") return;
    expect(envelope.fingerprint).toBe("0123456789abcdef");
  });

  it("refuses a version this build does not understand instead of half-reading it", () => {
    expect(() => parseEnvelope(JSON.stringify({ v: 2, kind: "proposal" }))).toThrow(
      "different version",
    );
  });

  it("refuses an envelope missing the part that matters", () => {
    expect(() =>
      parseEnvelope(JSON.stringify({ v: 1, kind: "proposal", policy: "{}" })),
    ).toThrow("missing part of one");
  });

  it("refuses something that is not an envelope at all", () => {
    expect(() => parseEnvelope("not json")).toThrow("not a payout envelope");
    expect(() => parseEnvelope(JSON.stringify({ v: 1, kind: "invoice" }))).toThrow(
      "neither a proposal nor a signature",
    );
  });
});
