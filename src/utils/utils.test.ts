import Utils from "./utils";
import {
  AddressKindEnum,
  BlockExplorerEnum,
  ServerChainNameEnum,
  UnifiedAddressClass,
  ValueTransferKindEnum,
  ValueTransferStatusEnum,
} from "../components/appstate";
import { native, shell } from "../electronBridge";

jest.mock("../electronBridge");

const mockOpenExternal = shell.openExternal as jest.Mock;

beforeEach(() => {
  mockOpenExternal.mockClear();
});

// ---------------------------------------------------------------------------
// getAddressKind on SWARM Mainnet
// ---------------------------------------------------------------------------
//
// 0.1.0-mainnet.2 to .5 refused every SWARM Mainnet address with "Not an
// address this network recognises": the addon answered `Invalid address` for
// `swm1…`, `s1…` and `s3…` alike, and this function passes that on. The addon
// now names them `swarm-mainnet` (native/src/lib.rs, `parse_address_tests`);
// these hold the renderer's half — that such an answer is accepted on a
// mainnet wallet and on nothing else.
describe("getAddressKind on SWARM Mainnet", () => {
  const FUEL_PAYOUT_UA =
    "swm1q4q6yr3rvnnqw64tqktf7plq86cnmdxezv2g5wjerfpratclfv87guyfqru4vf775ykqd8q9e7uzscmns7w6q2fpxwl5up0ez5xqe5gv";
  const SWARM_MAINNET_T = "s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk";
  const MAINNET = ServerChainNameEnum.swarmMainnetChainName;
  const mockParse = native.parse_address as jest.Mock;
  const answers = (answer: object) => mockParse.mockResolvedValue(JSON.stringify(answer));

  afterEach(() => mockParse.mockReset());

  it("accepts a swm1 address the addon names swarm-mainnet", async () => {
    answers({
      status: "success",
      chain_name: "swarm-mainnet",
      address_kind: "unified",
      receivers_available: ["orchard"],
    });
    await expect(Utils.getAddressKind(FUEL_PAYOUT_UA, MAINNET)).resolves.toBe(AddressKindEnum.unified);
    expect(mockParse).toHaveBeenCalledWith(FUEL_PAYOUT_UA);
  });

  it("accepts an s1 address the addon names swarm-mainnet", async () => {
    answers({ status: "success", chain_name: "swarm-mainnet", address_kind: "transparent" });
    await expect(Utils.getAddressKind(SWARM_MAINNET_T, MAINNET)).resolves.toBe(AddressKindEnum.transparent);
  });

  it("refuses what the mainnet.2 to .5 addon answered", async () => {
    answers({ status: "Invalid address", chain_name: null, address_kind: null });
    await expect(Utils.getAddressKind(FUEL_PAYOUT_UA, MAINNET)).resolves.toBeUndefined();
  });

  it("does not let any other chain's answer stand for SWARM Mainnet", async () => {
    for (const chain_name of ["main", "test", "regtest", "swarm-testnet"]) {
      answers({ status: "success", chain_name, address_kind: "unified" });
      await expect(Utils.getAddressKind(FUEL_PAYOUT_UA, MAINNET)).resolves.toBeUndefined();
    }
  });

  it("does not let a swarm-mainnet answer stand for SWARM Testnet", async () => {
    answers({ status: "success", chain_name: "swarm-mainnet", address_kind: "unified" });
    await expect(
      Utils.getAddressKind(FUEL_PAYOUT_UA, ServerChainNameEnum.swarmTestnetChainName),
    ).resolves.toBeUndefined();
  });

  it("refuses a SWARM Testnet address before asking the addon", async () => {
    answers({ status: "success", chain_name: "swarm-mainnet", address_kind: "unified" });
    const testnetUa = "swarm1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    await expect(Utils.getAddressKind(testnetUa, MAINNET)).resolves.toBeUndefined();
    expect(mockParse).not.toHaveBeenCalled();
  });
});

test("custom testnet uses test addresses while rejecting mainnet and regtest encodings", () => {
  const project = ServerChainNameEnum.swarmTestnetChainName;
  expect(Utils.sameAddressNetwork(ServerChainNameEnum.testChainName, project)).toBe(true);
  expect(Utils.sameAddressNetwork(ServerChainNameEnum.mainChainName, project)).toBe(false);
  expect(Utils.sameAddressNetwork(ServerChainNameEnum.regtestChainName, project)).toBe(false);
});

// ---------------------------------------------------------------------------
// Explorer links on the SWARM chains
// ---------------------------------------------------------------------------
//
// Up to 0.1.0-mainnet.7 every explorer setting defaulted to Zcashexplorer, so
// "View TXID" after a SWARM Mainnet payment opened
// https://mainnet.zcashexplorer.app/transactions/<SWARM txid>: a page that
// cannot exist, and a SWARM transaction id handed to a third party. On a SWARM
// chain the only explorer is SWARM's. The paths were checked against the live
// explorers on 2026-09-28 with real ids: /transactions/<txid>, /address/<s1…|t2…>
// and /blocks/<height> answer 200; /tx/<txid> is 404, and so is /address/ for a
// shielded (swm1…) address.
describe("explorer links on the SWARM chains", () => {
  const MAINNET = ServerChainNameEnum.swarmMainnetChainName;
  const TESTNET = ServerChainNameEnum.swarmTestnetChainName;
  const MAINNET_TX = "0dfdf4d12fd7f92ac8b143b38f55c25e6275bd22ebea18a852ced78c84cb30ff";
  const TESTNET_TX = "ab8303df00bfef45ec4f2664d78fe5d59dc9d6c0a675c507ae7c7c3b2ca4c48a";
  const ZCASH_HOSTS = /zcashexplorer|cipherscan|zexplorer|zcashnames|zec\.rocks|zcha\.in|blockchair|zypherscan/i;
  // Everything a settings file can hold, including values earlier versions
  // wrote and values nothing ever wrote.
  const STORED = [...Object.values(BlockExplorerEnum), "Zypherscan", "", undefined] as BlockExplorerEnum[];

  it("sends a SWARM Mainnet transaction to the SWARM Mainnet explorer, whatever the setting says", () => {
    for (const stored of STORED) {
      expect(Utils.zecExplorerTxUrl(MAINNET_TX, MAINNET, stored, "")).toBe(
        `https://mainnet.explore.swarm.green/transactions/${MAINNET_TX}`,
      );
    }
  });

  it("sends a SWARM Testnet transaction to the SWARM Testnet explorer, whatever the setting says", () => {
    for (const stored of STORED) {
      expect(Utils.zecExplorerTxUrl(TESTNET_TX, TESTNET, stored, "")).toBe(
        `https://testnet.explore.swarm.green/transactions/${TESTNET_TX}`,
      );
    }
  });

  it("can produce no Zcash explorer host for either SWARM chain", () => {
    for (const chain of [MAINNET, TESTNET]) {
      for (const stored of STORED) {
        for (const custom of ["", "https://mainnet.zcashexplorer.app/transactions/", "https://my.own.explorer/tx/"]) {
          const url = Utils.zecExplorerTxUrl("ab".repeat(32), chain, stored, custom);
          expect(url).not.toMatch(ZCASH_HOSTS);
          expect(url).toMatch(/^https:\/\/(mainnet\.explore\.swarm\.green|testnet\.explore\.swarm\.green)\//);
        }
        mockOpenExternal.mockClear();
        Utils.openAddress("s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk", chain, stored, "");
        Utils.openAddress("t2DGVURG5tAyXXSkj85JV5xbvTobYv7H99n", chain, stored, "");
        Utils.openAddress("swm1q4q6yr3rvnnqw64tqktf7plq86cnmdxez", chain, stored, "");
        for (const [opened] of mockOpenExternal.mock.calls) expect(opened).not.toMatch(ZCASH_HOSTS);
      }
    }
  });

  it("replaces saved custom explorer URLs with the SWARM explorer", () => {
    expect(Utils.zecExplorerTxUrl(MAINNET_TX, MAINNET, BlockExplorerEnum.Custom, "https://my.own.explorer/tx/")).toBe(
      `https://mainnet.explore.swarm.green/transactions/${MAINNET_TX}`,
    );
    // Custom chosen but never filled in: the SWARM explorer, not nothing.
    expect(Utils.zecExplorerTxUrl(MAINNET_TX, MAINNET, BlockExplorerEnum.Custom, "")).toBe(
      `https://mainnet.explore.swarm.green/transactions/${MAINNET_TX}`,
    );
  });

  it("opens a transparent address on its own network's explorer", () => {
    mockOpenExternal.mockClear();
    Utils.openAddress("s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk", MAINNET, BlockExplorerEnum.Zcashexplorer, "");
    Utils.openAddress("t2DGVURG5tAyXXSkj85JV5xbvTobYv7H99n", TESTNET, BlockExplorerEnum.Zcashexplorer, "");
    expect(mockOpenExternal.mock.calls.map(([url]) => url)).toEqual([
      "https://mainnet.explore.swarm.green/address/s1UsiRFq4FrtHUbHobXxssCN7EVCcu9GvFk",
      "https://testnet.explore.swarm.green/address/t2DGVURG5tAyXXSkj85JV5xbvTobYv7H99n",
    ]);
  });

  it("opens nothing for a shielded address, which no explorer page can show", () => {
    mockOpenExternal.mockClear();
    Utils.openAddress(
      "swm1q4q6yr3rvnnqw64tqktf7plq86cnmdxezv2g5wjerfpratclfv87guyfqru4vf775ykqd8q9e7uzscmns7w6q2fpxwl5up0ez5xqe5gv",
      MAINNET,
      BlockExplorerEnum.Zcashexplorer,
      "",
    );
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it("reads a SWARM Mainnet wallet's explorer from the Mainnet settings", () => {
    expect(Utils.usesMainnetExplorerSettings(MAINNET)).toBe(true);
    expect(Utils.usesMainnetExplorerSettings(ServerChainNameEnum.mainChainName)).toBe(true);
    expect(Utils.usesMainnetExplorerSettings(TESTNET)).toBe(false);
    expect(Utils.usesMainnetExplorerSettings(undefined)).toBe(false);
  });

  it("disables explorer links when the wallet has no SWARM chain", () => {
    for (const chain of [
      undefined,
      ServerChainNameEnum.mainChainName,
      ServerChainNameEnum.testChainName,
      ServerChainNameEnum.regtestChainName,
      "unknown" as ServerChainNameEnum,
    ]) {
      for (const stored of STORED) {
        Utils.openTxid(MAINNET_TX, chain, stored, "https://mainnet.zcashexplorer.app/transactions/");
        Utils.openAddress("s1address", chain, stored, "https://mainnet.zcashexplorer.app/address/");
      }
    }
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it("keeps custom address settings on the network's transparent explorer", () => {
    for (const [chain, host, address] of [
      [MAINNET, "mainnet.explore.swarm.green", "s1address"],
      [TESTNET, "testnet.explore.swarm.green", "tmaddress"],
    ] as const) {
      expect(Utils.zecExplorerAddressUrl(address, chain, BlockExplorerEnum.Custom, "https://outside.example/")).toBe(
        `https://${host}/address/${address}`,
      );
      expect(
        Utils.zecExplorerAddressUrl("swm1shielded", chain, BlockExplorerEnum.Custom, "https://outside.example/"),
      ).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// trimToSmall
// ---------------------------------------------------------------------------
describe("trimToSmall", () => {
  it("returns empty string for undefined", () => {
    expect(Utils.trimToSmall(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(Utils.trimToSmall("")).toBe("");
  });

  it("trims with default 5 chars on each side", () => {
    expect(Utils.trimToSmall("abcde1234567890")).toBe("abcde...67890");
  });

  it("trims with custom numChars", () => {
    expect(Utils.trimToSmall("abcdefghij", 3)).toBe("abc...hij");
  });

  // The two slices come from opposite ends, so below twice `numChars` they
  // overlap and the shared middle is printed twice. A short address came out
  // reading as two copies of itself with dots in between.
  it("returns a short string whole rather than repeating its middle", () => {
    expect(Utils.trimToSmall("abcde123", 5)).toBe("abcde123");
    expect(Utils.trimToSmall("abcdef", 5)).toBe("abcdef");
  });

  // At exactly twice, nothing repeats — but the result is three characters
  // longer than what it replaced, which is not an abbreviation.
  it("leaves a string alone when shortening it would make it longer", () => {
    expect(Utils.trimToSmall("abcde12345")).toBe("abcde12345");
    expect(Utils.trimToSmall("abcde12345678")).toBe("abcde12345678");
  });

  // One character past the point where the ellipsis pays for itself.
  it("starts trimming as soon as trimming saves a character", () => {
    expect(Utils.trimToSmall("abcde123456789")).toBe("abcde...56789");
  });
});

// ---------------------------------------------------------------------------
// isValidSaplingPrivateKey
// ---------------------------------------------------------------------------
describe("isValidSaplingPrivateKey", () => {
  it("returns false for a random string", () => {
    expect(Utils.isValidSaplingPrivateKey("notakey")).toBe(false);
  });

  it("returns false for wrong prefix", () => {
    expect(Utils.isValidSaplingPrivateKey("secret-extended-key-regtest" + "a".repeat(278))).toBe(false);
  });

  it("returns true for valid testnet key format", () => {
    expect(Utils.isValidSaplingPrivateKey("secret-extended-key-test" + "a".repeat(278))).toBe(true);
  });

  it("returns true for valid mainnet key format", () => {
    expect(Utils.isValidSaplingPrivateKey("secret-extended-key-main" + "a".repeat(278))).toBe(true);
  });

  it("returns false when key is too short", () => {
    expect(Utils.isValidSaplingPrivateKey("secret-extended-key-main" + "a".repeat(100))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidSaplingViewingKey
// ---------------------------------------------------------------------------
describe("isValidSaplingViewingKey", () => {
  it("returns false for a random string", () => {
    expect(Utils.isValidSaplingViewingKey("notakey")).toBe(false);
  });

  it("returns true for valid viewing key format", () => {
    expect(Utils.isValidSaplingViewingKey("zxviews" + "a".repeat(278))).toBe(true);
  });

  it("returns false when key is too short", () => {
    expect(Utils.isValidSaplingViewingKey("zxviews" + "a".repeat(10))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// maxPrecision
// ---------------------------------------------------------------------------
describe("maxPrecision", () => {
  it("returns '0' for falsy input", () => {
    expect(Utils.maxPrecision(0)).toBe("0");
  });

  it("pads to 8 decimal places", () => {
    expect(Utils.maxPrecision(1.5)).toBe("1.50000000");
  });

  it("rounds at the 8th decimal", () => {
    expect(Utils.maxPrecision(1.123456789)).toBe("1.12345679");
  });

  it("handles whole numbers", () => {
    expect(Utils.maxPrecision(1)).toBe("1.00000000");
  });
});

// ---------------------------------------------------------------------------
// maxPrecisionTrimmed
// ---------------------------------------------------------------------------
describe("maxPrecisionTrimmed", () => {
  it("returns '0' for 0", () => {
    expect(Utils.maxPrecisionTrimmed(0)).toBe("0");
  });

  it("removes trailing zeros after decimal", () => {
    expect(Utils.maxPrecisionTrimmed(1.5)).toBe("1.5");
  });

  it("removes the decimal point when all decimals are zero", () => {
    expect(Utils.maxPrecisionTrimmed(1)).toBe("1");
  });

  it("preserves significant decimal digits", () => {
    expect(Utils.maxPrecisionTrimmed(1.12345678)).toBe("1.12345678");
  });

  it("trims trailing zeros but keeps significant ones", () => {
    expect(Utils.maxPrecisionTrimmed(1.1)).toBe("1.1");
  });
});

// ---------------------------------------------------------------------------
// splitZecAmountIntoBigSmall
// ---------------------------------------------------------------------------
describe("splitZecAmountIntoBigSmall", () => {
  it("returns '0' bigPart and empty smallPart for zero", () => {
    expect(Utils.splitZecAmountIntoBigSmall(0)).toEqual({ bigPart: "0", smallPart: "" });
  });

  it("returns empty smallPart when all tail decimals are zeros", () => {
    expect(Utils.splitZecAmountIntoBigSmall(1.5)).toEqual({ bigPart: "1.5000", smallPart: "" });
  });

  it("splits a value with significant tail digits", () => {
    expect(Utils.splitZecAmountIntoBigSmall(1.12345678)).toEqual({ bigPart: "1.1234", smallPart: "5678" });
  });

  it("rounds correctly at the 8th decimal", () => {
    expect(Utils.splitZecAmountIntoBigSmall(1.123456789)).toEqual({ bigPart: "1.1234", smallPart: "5679" });
  });

  it("returns empty smallPart for a whole number", () => {
    const { bigPart, smallPart } = Utils.splitZecAmountIntoBigSmall(10);
    expect(bigPart).toBe("10.0000");
    expect(smallPart).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getReceivers
// ---------------------------------------------------------------------------
describe("getReceivers", () => {
  it("returns all three receivers when all are true", () => {
    const addr = { has_orchard: true, has_sapling: true, has_transparent: true } as UnifiedAddressClass;
    expect(Utils.getReceivers(addr)).toEqual(["Ironwood", "Sapling", "Transparent"]);
  });

  it("returns only Sapling", () => {
    const addr = { has_orchard: false, has_sapling: true, has_transparent: false } as UnifiedAddressClass;
    expect(Utils.getReceivers(addr)).toEqual(["Sapling"]);
  });

  it("returns empty array when none are set", () => {
    const addr = { has_orchard: false, has_sapling: false, has_transparent: false } as UnifiedAddressClass;
    expect(Utils.getReceivers(addr)).toEqual([]);
  });

  it("labels the Orchard receiver with where the funds end up", () => {
    const addr = { has_orchard: true, has_sapling: false, has_transparent: false } as UnifiedAddressClass;
    expect(Utils.getReceivers(addr)).toEqual(["Ironwood"]);
  });
});

// ---------------------------------------------------------------------------
// splitStringIntoChunks
// ---------------------------------------------------------------------------
describe("splitStringIntoChunks", () => {
  it("returns original string when numChunks > string length", () => {
    expect(Utils.splitStringIntoChunks("abc", 10)).toEqual(["abc"]);
  });

  it("returns original string when string is shorter than 16 chars", () => {
    expect(Utils.splitStringIntoChunks("short", 3)).toEqual(["short"]);
  });

  it("splits a long string into the requested number of chunks", () => {
    const s = "a".repeat(30);
    const chunks = Utils.splitStringIntoChunks(s, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(s);
  });

  it("last chunk absorbs the remainder", () => {
    const s = "a".repeat(31);
    const chunks = Utils.splitStringIntoChunks(s, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("").length).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// getZecToUsdString
// ---------------------------------------------------------------------------
describe("getZecToUsdString", () => {
  it("returns 'USD --' when price is missing", () => {
    expect(Utils.getZecToUsdString(undefined, 1)).toBe("USD --");
  });

  it("returns 'USD --' when zecValue is missing", () => {
    expect(Utils.getZecToUsdString(50000, undefined)).toBe("USD --");
  });

  it("returns 'USD --' when both are missing", () => {
    expect(Utils.getZecToUsdString(undefined, undefined)).toBe("USD --");
  });

  it("returns 'USD < 0.01' for tiny amounts", () => {
    expect(Utils.getZecToUsdString(1, 0.001)).toBe("USD < 0.01");
  });

  it("formats a normal USD amount with 2 decimal places", () => {
    expect(Utils.getZecToUsdString(50000, 1)).toBe("USD 50000.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(Utils.getZecToUsdString(3, 1)).toBe("USD 3.00");
  });

  it("handles fractional USD amounts", () => {
    expect(Utils.getZecToUsdString(0.5, 1)).toBe("USD 0.50");
  });
});

// ---------------------------------------------------------------------------
// utf16Split
// ---------------------------------------------------------------------------
describe("utf16Split", () => {
  it("returns a single chunk when the string fits", () => {
    expect(Utils.utf16Split("hello", 10)).toEqual(["hello"]);
  });

  it("splits ASCII at the chunksize boundary", () => {
    expect(Utils.utf16Split("abcdefgh", 4)).toEqual(["abcd", "efgh"]);
  });

  it("handles odd-length strings", () => {
    const result = Utils.utf16Split("abcde", 4);
    expect(result.join("")).toBe("abcde");
    expect(result[0]).toBe("abcd");
    expect(result[1]).toBe("e");
  });

  it("counts emoji as 4 bytes and splits correctly", () => {
    // 🦄 has length 2 in JS (surrogate pair) → utf16Split counts it as 4 bytes
    const result = Utils.utf16Split("🦄abc", 4);
    expect(result[0]).toBe("🦄");
    expect(result[1]).toBe("abc");
  });

  it("returns empty array for empty string", () => {
    expect(Utils.utf16Split("", 4)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VTTypeWithConfirmations
// ---------------------------------------------------------------------------
describe("VTTypeWithConfirmations", () => {
  it("returns 'Send' for a failed sent transaction", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.sent, ValueTransferStatusEnum.failed, 0)).toBe("Send");
  });

  it("returns 'Shield' for a failed shield transaction", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.shield, ValueTransferStatusEnum.failed, 0)).toBe(
      "Shield",
    );
  });

  it("returns '...Sending...' for a pending sent", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.sent, "", 0)).toBe("...Sending...");
  });

  it("returns 'Sent' for a confirmed sent", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.sent, "", 3)).toBe("Sent");
  });

  it("returns '...Receiving...' for a pending received", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.received, "", 0)).toBe("...Receiving...");
  });

  it("returns 'Received' for a confirmed received", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.received, "", 1)).toBe("Received");
  });

  it("returns '...Sending to self...' for a pending memoToSelf", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.memoToSelf, "", 0)).toBe("...Sending to self...");
  });

  it("returns 'Memo to self' for a confirmed memoToSelf", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.memoToSelf, "", 1)).toBe("Memo to self");
  });

  it("returns '...Sending to self...' for a pending sendToSelf", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.sendToSelf, "", 0)).toBe("...Sending to self...");
  });

  it("returns 'Send to self' for a confirmed sendToSelf", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.sendToSelf, "", 2)).toBe("Send to self");
  });

  it("returns '...Shielding...' for a pending shield", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.shield, "", 0)).toBe("...Shielding...");
  });

  it("returns 'Shield' for a confirmed shield", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.shield, "", 5)).toBe("Shield");
  });

  it("returns '...Sending...' for a pending rejection", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.rejection, "", 0)).toBe("...Sending...");
  });

  it("returns 'Rejection' for a confirmed rejection", () => {
    expect(Utils.VTTypeWithConfirmations(ValueTransferKindEnum.rejection, "", 1)).toBe("Rejection");
  });

  it("returns empty string for unknown type", () => {
    expect(Utils.VTTypeWithConfirmations("", "", 0)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getDefaultDonationAmount / getDefaultDonationMemo
// ---------------------------------------------------------------------------
// Upstream's donation feature is not wired up in this fork, and what is left
// of it is emptied rather than inherited: an empty address cannot become a
// payment, a zero amount cannot prefill one, and the memo no longer asks a
// SWARM user to thank a different project.
describe("the donation defaults left over from upstream", () => {
  it("names no recipient, on either network", () => {
    expect(Utils.getDonationAddress(false)).toBe("");
    expect(Utils.getDonationAddress(true)).toBe("");
  });

  it("prefills no amount", () => {
    expect(Utils.getDefaultDonationAmount(false)).toBe(0);
    expect(Utils.getDefaultDonationAmount(true)).toBe(0);
  });

  it("carries no memo thanking another project", () => {
    expect(Utils.getDefaultDonationMemo(false)).toBe("");
    expect(Utils.getDefaultDonationMemo(true)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// openTxid
// ---------------------------------------------------------------------------
describe("opening a SWARM transaction", () => {
  it("opens the official explorer after loading a legacy custom URL", () => {
    Utils.openTxid(
      "ab".repeat(32),
      ServerChainNameEnum.swarmMainnetChainName,
      BlockExplorerEnum.Custom,
      "https://mainnet.zcashexplorer.app/transactions/",
    );
    expect(mockOpenExternal).toHaveBeenCalledWith(
      `https://mainnet.explore.swarm.green/transactions/${"ab".repeat(32)}`,
    );
  });
});
