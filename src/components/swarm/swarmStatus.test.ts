import InfoClass from "../appstate/classes/InfoClass";
import { currentProblem, deriveStatus, formatHeight, plainProblem, serverHost } from "./swarmStatus";

function info(overrides: Partial<InfoClass>): InfoClass {
  return { ...new InfoClass(), ...overrides } as InfoClass;
}

describe("serverHost", () => {
  it("keeps the host and drops scheme, port and path", () => {
    expect(serverHost("https://lwd.swarm.green:443")).toBe("lwd.swarm.green");
    expect(serverHost("http://127.0.0.1:9067")).toBe("127.0.0.1");
    expect(serverHost("lwd.swarm.green:443")).toBe("lwd.swarm.green");
  });

  it("answers empty for nothing configured", () => {
    expect(serverHost(undefined)).toBe("");
    expect(serverHost("   ")).toBe("");
  });
});

describe("formatHeight", () => {
  it("groups thousands", () => {
    expect(formatHeight(812405)).toBe("812,405");
  });

  it("refuses to print a height it does not have", () => {
    expect(formatHeight(0)).toBe("—");
    expect(formatHeight(NaN)).toBe("—");
  });
});

describe("deriveStatus", () => {
  it("is not connected when no server has answered", () => {
    const status = deriveStatus(info({ serverUri: "https://lwd.swarm.green:443", latestBlock: 0 }), null);
    expect(status.state).toBe("disconnected");
    expect(status.label).toBe("Not connected");
    expect(status.detail).toBe("No answer from lwd.swarm.green");
  });

  // Defect W-5. Before a wallet exists there is no RPC and so no `info`, but
  // the profile has had a server since its first run. Claiming "No server
  // configured" in that window told the first person to open a public download
  // that the application was broken when it was waiting for them to make a
  // wallet.
  it("names the configured server before any wallet has opened", () => {
    const status = deriveStatus(info({ serverUri: "", latestBlock: 0 }), null, undefined, "https://lwd.swarm.green:443");
    // Neutral, not an error: nothing has gone wrong, nothing has been tried.
    expect(status.state).toBe("connecting");
    expect(status.detail).toBe("Connecting to lwd.swarm.green…");
    expect(status.host).toBe("lwd.swarm.green");
  });

  // The one case where "no server configured" is the truth.
  it("says a server is missing only when there is genuinely none", () => {
    const status = deriveStatus(info({ serverUri: "", latestBlock: 0 }), null);
    expect(status.detail).toBe("No server configured");
  });

  it("reports a percentage while it is scanning", () => {
    const status = deriveStatus(info({ serverUri: "https://lwd.swarm.green:443", latestBlock: 12046 }), 42);
    expect(status.state).toBe("syncing");
    expect(status.label).toBe("Syncing 42 %");
    expect(status.percent).toBe(42);
  });

  it("falls back to the scanner's own percentage", () => {
    const status = deriveStatus(info({ serverUri: "https://a.b", latestBlock: 10 }), null, {
      percentage_total_blocks_scanned: 7,
    });
    expect(status.label).toBe("Syncing 7 %");
  });

  it("says syncing, not synced, when no progress has been measured yet", () => {
    const status = deriveStatus(info({ serverUri: "https://a.b", latestBlock: 10 }), null);
    expect(status.state).toBe("syncing");
    expect(status.label).toBe("Syncing…");
    expect(status.percent).toBeNull();
  });

  it("names the height and the server once it is synced", () => {
    const status = deriveStatus(info({ serverUri: "https://lwd.swarm.green:443", latestBlock: 12046 }), 100);
    expect(status.state).toBe("synced");
    expect(status.detail).toBe("#12,046 · lwd.swarm.green");
  });

  // The old sidebar printed "42 peers". A light wallet has none.
  it("never claims a peer count", () => {
    const status = deriveStatus(info({ serverUri: "https://lwd.swarm.green:443", latestBlock: 12046 }), 100);
    expect(`${status.label} ${status.detail}`).not.toMatch(/peer/i);
  });
});

describe("plainProblem", () => {
  it("requires a restart for a poisoned engine even when its cause mentions a network error", () => {
    const raw = "Lightclient lock poisoned. Original failure: transport error";
    expect(plainProblem(raw)).toMatchObject({
      kind: "wallet-session", retryable: false, technical: raw,
    });
    expect(plainProblem(raw)?.body).toContain("Fully quit SWARM Wallet");
  });
  // The exact text the owner was shown.
  const dns =
    "sync: Indexer request error. ← code: 'The service is currently unavailable', " +
    'message: "dns error", source: tonic::transport::Error(Transport, ConnectError("dns error"))';

  it("turns a DNS failure into one sentence that names the server", () => {
    const problem = plainProblem(dns, "lwd.swarm.green");
    expect(problem?.kind).toBe("unreachable");
    expect(problem?.headline).toBe("Can't reach the wallet server lwd.swarm.green right now.");
    expect(problem?.body).toBe("Your coins are safe. Retrying…");
    expect(problem?.retryable).toBe(true);
  });

  it("keeps the original text untouched for the expander", () => {
    expect(plainProblem(dns, "lwd.swarm.green")?.technical).toBe(dns);
  });

  it("says nothing when nothing is wrong", () => {
    expect(plainProblem(undefined)).toBeNull();
    expect(plainProblem("")).toBeNull();
    expect(plainProblem("   ")).toBeNull();
  });

  it("recognises a refused connection and a timeout as the same kind of problem", () => {
    expect(plainProblem("Connection refused (os error 111)", "h")?.kind).toBe("unreachable");
    expect(plainProblem("deadline exceeded", "h")?.kind).toBe("unreachable");
  });

  it("does not offer a retry for a shortfall of funds", () => {
    const problem = plainProblem("read: insufficient funds: 0 available of 10000 required");
    expect(problem?.kind).toBe("funds");
    expect(problem?.retryable).toBe(false);
  });

  it("recognises a shard-tree corruption as a local rebuild, not a retry", () => {
    const problem = plainProblem(
      "sync: shard tree error ← Inserted root conflicts with existing root at address Address { level: Level(0), index: 1246 }",
      "lwd.swarm.green",
    );
    expect(problem?.kind).toBe("shard-tree");
    expect(problem?.retryable).toBe(false);
    expect(problem?.rebuildable).toBe(true);
    expect(problem?.headline).toContain("needs rebuilding");
  });

  it("recognises the abbreviated shard-tree error reported by the owner", () => {
    expect(plainProblem("sync: shard tree err")).toMatchObject({
      kind: "shard-tree", retryable: false, rebuildable: true,
      technical: "sync: shard tree err",
    });
  });

  it("falls back to the server's generic name when the host is unknown", () => {
    expect(plainProblem("dns error")?.headline).toContain("the wallet server");
  });

  it("never leaves the user without a reassurance", () => {
    for (const raw of ["dns error", "boom", "read: insufficient funds", "saving wallet: disk full"]) {
      expect(plainProblem(raw, "h")?.body).toBeTruthy();
    }
  });
});

describe("currentProblem", () => {
  it("prefers a failed fetch over a background sync error", () => {
    const problem = currentProblem({ error: "dns error" }, { lastError: "read: insufficient funds" }, "h");
    expect(problem?.kind).toBe("unreachable");
  });

  it("falls back to the sync error", () => {
    const problem = currentProblem({} as { error: string }, { lastError: "dns error" }, "h");
    expect(problem?.kind).toBe("unreachable");
  });

  it("is null when neither is set", () => {
    expect(currentProblem(undefined, undefined, "h")).toBeNull();
  });
});
