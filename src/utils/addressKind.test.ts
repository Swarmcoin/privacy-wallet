/**
 * The address check Send, the address book and payment links all go through,
 * `Utils.getAddressKind`, against the answers the addon's `parse_address`
 * really gives.
 *
 * Up to 0.1.0-mainnet.5 the addon read an address against Zcash Mainnet,
 * Zcash Testnet and regtest only, so every SWARM production address — the
 * FUEL payout address, a fund's `s3…`, the wallet's own `swm1…` — came back
 * `Invalid address`, and a mainnet wallet refused every recipient on the Send
 * screen. The addon now also tries SWARM production and SwarmTestnet
 * (`native/src/lib.rs`, `parse_address_json`, pinned by its
 * `swarm_address_parsing` tests); these are its answers, verbatim in shape,
 * and what the screen does with them.
 */
import Utils from "./utils";
import { AddressKindEnum, ServerChainNameEnum } from "../components/appstate";
import { native } from "../electronBridge";

jest.mock("../electronBridge");

const FUEL_PAYOUT =
  "swm1q4q6yr3rvnnqw64tqktf7plq86cnmdxezv2g5wjerfpratclfv87guyfqru4vf775ykqd8q9e7uzscmns7w6q2fpxwl5up0ez5xqe5gv";
const CORE_FUND = "s3fLmEHc1xqs8KAe7QS7oupkhuGDjidV4eq";
const SWARM_TESTNET_UA =
  "swarm1lpaw72xqh05uneatpyrn3etsae82v6vmvapu0jrwg48awww24v7u9mjvf3znqlu9jtqzqgjuyw03w9emm7wvf5rc5dpdyu5zsy334vah";
const ZCASH_T1 = "t1dRJRY7GmyeykJnMH38mdQoaZtFhn1QmGz";

/** What the fixed addon answers for each (shape of `parse_address_json`). */
const FIXED: Record<string, object> = {
  [FUEL_PAYOUT]: {
    status: "success",
    chain_name: "swarm-mainnet",
    valid_on: ["swarm-mainnet"],
    address_kind: "unified",
    receivers_available: ["orchard"],
  },
  [CORE_FUND]: { status: "success", chain_name: "swarm-mainnet", valid_on: ["swarm-mainnet"], address_kind: "transparent" },
  [SWARM_TESTNET_UA]: {
    status: "success",
    chain_name: "test",
    valid_on: ["test", "swarm-testnet"],
    address_kind: "unified",
    receivers_available: ["orchard"],
  },
  [ZCASH_T1]: { status: "success", chain_name: "main", valid_on: ["main"], address_kind: "transparent" },
};

/** What every mainnet build up to 0.1.0-mainnet.5 answered for a SWARM production address. */
const BEFORE = JSON.stringify({ status: "Invalid address", chain_name: null, address_kind: null });

const parseAddress = native.parse_address as jest.Mock;

function answerAsFixed() {
  parseAddress.mockImplementation(async (address: string) =>
    JSON.stringify(FIXED[address] ?? { status: "Invalid address", chain_name: null, valid_on: [], address_kind: null }),
  );
}

const MAINNET = ServerChainNameEnum.swarmMainnetChainName;
const TESTNET = ServerChainNameEnum.swarmTestnetChainName;

describe("Utils.getAddressKind on SWARM production", () => {
  beforeEach(answerAsFixed);

  it("accepts the FUEL payout address and a fund's P2SH address", async () => {
    await expect(Utils.getAddressKind(FUEL_PAYOUT, MAINNET)).resolves.toBe(AddressKindEnum.unified);
    await expect(Utils.getAddressKind(CORE_FUND, MAINNET)).resolves.toBe(AddressKindEnum.transparent);
  });

  it("refuses a SwarmTestnet address and a Zcash address", async () => {
    await expect(Utils.getAddressKind(SWARM_TESTNET_UA, MAINNET)).resolves.toBeUndefined();
    await expect(Utils.getAddressKind(ZCASH_T1, MAINNET)).resolves.toBeUndefined();
  });

  it("refused every SWARM production address while the addon answered 'Invalid address'", async () => {
    parseAddress.mockResolvedValue(BEFORE);
    await expect(Utils.getAddressKind(FUEL_PAYOUT, MAINNET)).resolves.toBeUndefined();
    await expect(Utils.getAddressKind(CORE_FUND, MAINNET)).resolves.toBeUndefined();
  });
});

describe("Utils.getAddressKind on SwarmTestnet", () => {
  beforeEach(answerAsFixed);

  it("keeps accepting a SwarmTestnet address, which the addon still names `test`", async () => {
    await expect(Utils.getAddressKind(SWARM_TESTNET_UA, TESTNET)).resolves.toBe(AddressKindEnum.unified);
  });

  it("refuses the production addresses and Zcash", async () => {
    await expect(Utils.getAddressKind(FUEL_PAYOUT, TESTNET)).resolves.toBeUndefined();
    await expect(Utils.getAddressKind(CORE_FUND, TESTNET)).resolves.toBeUndefined();
    await expect(Utils.getAddressKind(ZCASH_T1, TESTNET)).resolves.toBeUndefined();
  });
});
