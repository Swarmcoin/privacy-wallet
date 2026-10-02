import { ServerChainNameEnum, ServerClass } from "../components/appstate";
import fetchServerList from "./fetchServerList";
import selectFastestServer from "./selectFastestServer";
import pickRotationTarget from "./pickRotationTarget";

// Automocking the two helpers still loads them to derive their shape, and they
// reach the electron bridge on the way in.
jest.mock("../electronBridge");
jest.mock("./fetchServerList");
jest.mock("./selectFastestServer");

const liveList = fetchServerList as jest.MockedFunction<typeof fetchServerList>;
const race = selectFastestServer as jest.MockedFunction<typeof selectFastestServer>;

const server = (uri: string, chain = ServerChainNameEnum.mainChainName): ServerClass => ({
  uri,
  chain_name: chain,
  latency: null,
  default: false,
  obsolete: false,
});

beforeEach(() => {
  liveList.mockReset().mockResolvedValue([]);
  race.mockReset().mockResolvedValue(null);
});

test("takes whichever of the registry's best answers first, not the first listed", async () => {
  liveList.mockResolvedValue([server("https://one.zec.rocks:443"), server("https://two.zec.rocks:443")]);
  race.mockImplementation(async (servers: ServerClass[]) => servers[1] ?? null);

  expect(await pickRotationTarget(ServerChainNameEnum.mainChainName, ["https://old.zec.rocks:443"])).toBe(
    "https://two.zec.rocks:443",
  );
});

// A registry whose best few all stay silent still has to yield a server.
test("falls back to the registry order when none of them answers", async () => {
  liveList.mockResolvedValue([server("https://one.zec.rocks:443"), server("https://two.zec.rocks:443")]);

  expect(await pickRotationTarget(ServerChainNameEnum.mainChainName, ["https://old.zec.rocks:443"])).toBe(
    "https://one.zec.rocks:443",
  );
});

// The whole point of rotating is to leave the server that is not answering.
test("never returns the server it was asked to leave", async () => {
  liveList.mockResolvedValue([server("https://old.zec.rocks:443"), server("https://two.zec.rocks:443")]);

  expect(await pickRotationTarget(ServerChainNameEnum.mainChainName, ["https://old.zec.rocks:443"])).toBe(
    "https://two.zec.rocks:443",
  );
});

// SWARM has no registry, so the static list is all a rotation ever has — and
// since 2026-09-26 that list is SWARM's alone. It used to hold upstream Zcash's
// twenty lightwalletd endpoints, which is how a rotation, a server picker and
// finally the create-a-wallet screen could all reach them.
test("races the static list when the registry says nothing", async () => {
  race.mockResolvedValue(server("http://127.0.0.1:9067", ServerChainNameEnum.swarmTestnetChainName));

  expect(
    await pickRotationTarget(ServerChainNameEnum.swarmTestnetChainName, ["https://lwd.swarm.green:443"]),
  ).toBe("http://127.0.0.1:9067");
  const raced = race.mock.calls[0][0].map((s: ServerClass) => s.uri);
  expect(raced).not.toContain("https://lwd.swarm.green:443");
  expect(raced.length).toBeGreaterThan(0);
});

test("falls back to the server we ship for the chain when none answer", async () => {
  expect(
    await pickRotationTarget(ServerChainNameEnum.swarmTestnetChainName, ["https://lwd.swarm.green:443"]),
  ).toBe("http://127.0.0.1:9067");
});

test("stays on the wallet's chain", async () => {
  race.mockImplementation(async (servers: ServerClass[]) => servers[0] ?? null);

  const target = await pickRotationTarget(ServerChainNameEnum.swarmMainnetChainName, []);

  expect(target).toBe("https://lwd-main.swarm.green:443");
  // The testnet's endpoints belong to the testnet, and a mainnet wallet may
  // not be rotated onto one: a light wallet cannot follow its server to
  // another chain, least of all from real money to test coins.
  const raced = race.mock.calls[0][0].map((s: ServerClass) => s.uri);
  expect(raced).toEqual(["https://lwd-main.swarm.green:443"]);
});

// Upstream's chains have no SWARM endpoint, and nothing may invent one for
// them.
test("gives up rather than rotating a Zcash wallet onto a SWARM server", async () => {
  expect(await pickRotationTarget(ServerChainNameEnum.mainChainName, [])).toBeNull();
  expect(await pickRotationTarget(ServerChainNameEnum.testChainName, [])).toBeNull();
});

test("gives up rather than rotating to nothing", async () => {
  expect(await pickRotationTarget(ServerChainNameEnum.regtestChainName, ["http://127.0.0.1:9067"])).toBeNull();
});

// Each rotation adds to the rejected list, so rotating twice keeps moving
// forward instead of bouncing back to the first server.
test("skips every server already rejected", async () => {
  liveList.mockResolvedValue([
    server("https://one.zec.rocks:443"),
    server("https://two.zec.rocks:443"),
    server("https://three.zec.rocks:443"),
  ]);

  const target = await pickRotationTarget(ServerChainNameEnum.mainChainName, [
    "https://one.zec.rocks:443",
    "https://two.zec.rocks:443",
  ]);

  expect(target).toBe("https://three.zec.rocks:443");
});
