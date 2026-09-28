import { IRONWOOD_RECEIVER_LABEL } from "../constants/ironwood";
import {
  AddressKindEnum,
  BlockExplorerEnum,
  UnifiedAddressClass,
  ValueTransferKindEnum,
  ValueTransferStatusEnum,
} from "../components/appstate";
import randomColor from "randomcolor";

import { native, shell } from "../electronBridge";
import { ServerChainNameEnum } from "../components/appstate";
import { SWARM_MAINNET_PROFILE, SWARM_TESTNET_PROFILE, swarmProfileFor } from "./networkProfiles";
import { checkAddressForChain } from "./swarmAddress";

export const NO_CONNECTION: string = "Could not connect to the Server";

export default class Utils {
  // recover the var from the Global CSS.
  /**
   * A palette colour as a string JavaScript can hold.
   *
   * Not the way to colour something. `var(--color-error)` written straight
   * into a style is, because the browser resolves it and keeps resolving it;
   * this reads the computed value once, at the moment it is called, so a
   * colour taken this way is frozen until the component renders again. With
   * one fixed palette that is the same colour either way, which is exactly why
   * two idioms lived side by side for so long — and why the day a second
   * palette arrives, whichever call sites still use this would keep painting
   * the old one.
   *
   * It earns its place where the value cannot be a CSS function: a canvas the
   * chart library paints on, or a component prop that may end up as an SVG
   * presentation attribute. Six call sites, and they are the only ones.
   */
  static getCssVariable(variableName: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  }

  static VTTypeWithConfirmations(
    type: ValueTransferKindEnum | "",
    status: ValueTransferStatusEnum | "",
    confirmations: number,
  ): string {
    return status === ValueTransferStatusEnum.failed && type === ValueTransferKindEnum.sent
      ? "Send"
      : status === ValueTransferStatusEnum.failed && type === ValueTransferKindEnum.shield
        ? "Shield"
        : status === ValueTransferStatusEnum.failed && type === ValueTransferKindEnum.received
          ? "Receive"
          : type === ValueTransferKindEnum.sent && confirmations === 0
            ? "...Sending..."
            : type === ValueTransferKindEnum.sent && confirmations > 0
              ? "Sent"
              : type === ValueTransferKindEnum.received && confirmations === 0
                ? "...Receiving..."
                : type === ValueTransferKindEnum.received && confirmations > 0
                  ? "Received"
                  : type === ValueTransferKindEnum.memoToSelf && confirmations === 0
                    ? "...Sending to self..."
                    : type === ValueTransferKindEnum.memoToSelf && confirmations > 0
                      ? "Memo to self"
                      : type === ValueTransferKindEnum.sendToSelf && confirmations === 0
                        ? "...Sending to self..."
                        : type === ValueTransferKindEnum.sendToSelf && confirmations > 0
                          ? "Send to self"
                          : type === ValueTransferKindEnum.shield && confirmations === 0
                            ? "...Shielding..."
                            : type === ValueTransferKindEnum.shield && confirmations > 0
                              ? "Shield"
                              : type === ValueTransferKindEnum.rejection && confirmations === 0
                                ? "...Sending..."
                                : type === ValueTransferKindEnum.rejection && confirmations > 0
                                  ? "Rejection"
                                  : type === ValueTransferKindEnum.migration && confirmations === 0
                                    ? "...Migrating..."
                                    : type === ValueTransferKindEnum.migration && confirmations > 0
                                      ? "Migration"
                                      : type === ValueTransferKindEnum.swap
                                        ? "Swap"
                                        : "";
  }

  /**
   * The head and tail of a long string with an ellipsis between them, and the
   * string itself when it is not long enough for that to help.
   *
   * The two slices are taken from opposite ends, so a string shorter than
   * twice `numChars` makes them overlap and the shared middle is printed
   * twice — a short address came out reading as two copies of itself with
   * dots in between. At exactly twice, nothing is repeated but the result is
   * three characters longer than what it replaced.
   *
   * So the abbreviation only happens once it is actually an abbreviation:
   * past both slices plus the ellipsis that joins them.
   */
  static trimToSmall(addr?: string, numChars?: number): string {
    if (!addr) {
      return "";
    }
    const trimSize: number = numChars || 5;
    const ELLIPSIS = "...";
    if (addr.length <= trimSize * 2 + ELLIPSIS.length) {
      return addr;
    }
    return `${addr.slice(0, trimSize)}${ELLIPSIS}${addr.slice(addr.length - trimSize)}`;
  }

  static async getAddressChainName(addr: string): Promise<string | undefined> {
    if (!addr) return undefined;
    try {
      const resultParse: string = await native.parse_address(addr);
      if (!resultParse) return undefined;
      let parsed;
      try {
        parsed = JSON.parse(resultParse);
      } catch {
        return undefined;
      }
      if (parsed?.status === "success" && parsed?.chain_name) {
        return parsed.chain_name as string;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  static async getAddressKind(addr: string, currChain: "" | ServerChainNameEnum): Promise<AddressKindEnum | undefined> {
    if (!addr) return;
    // The SWARM rule, ahead of the addon, because the addon cannot answer this
    // one. Its vendored protocol crate gives the TESTNET constants SwarmTestnet's
    // HRPs, so `swarm1…` decodes as chain `test` and `sameAddressNetwork` below
    // treats that as SwarmTestnet on purpose. That aliasing must not reach SWARM
    // production: a SwarmTestnet address offered to a production wallet has to be
    // refused by its encoding, which is what this does. See utils/swarmAddress.ts.
    const swarmVerdict = Utils.addressVerdict(addr, currChain);
    if (swarmVerdict && !swarmVerdict.accepted) return;
    try {
      const resultParse: string = await native.parse_address(addr);
      if (!resultParse) {
        return;
      }

      let resultParseJSON;
      try {
        resultParseJSON = JSON.parse(resultParse);
      } catch (error) {
        console.error("parse-address", error);
        return;
      }

      if (
        resultParseJSON &&
        resultParseJSON.status &&
        resultParseJSON.status === "success" &&
        resultParseJSON.chain_name &&
        Utils.sameAddressNetwork(resultParseJSON.chain_name, currChain)
      ) {
        return resultParseJSON.address_kind;
      } else {
        return;
      }
    } catch (error) {
      console.error(`Critical Error address kind ${error}`);
      return;
    }
  }

  /**
   * Human-readable display name for a network — used wherever the chain is
   * shown to the user (address book entries, server selector, dashboards…).
   * Single source of truth so we don't drift across components.
   * Returns an empty string for empty / undefined / unknown values so callers
   * can drop it straight into JSX without a guard.
   */
  static sameAddressNetwork(encodedNetwork: string | undefined, selectedNetwork: string): boolean {
    // The one alias, and it is deliberate: this build's vendored protocol crate
    // renamed upstream TESTNET's unified HRP to SwarmTestnet's, so the addon
    // reports `test` for an address a SwarmTestnet user typed. There is no
    // second alias. SWARM production is its own network type in the SDK and
    // reports its own label; `main` is upstream Zcash and satisfies nothing here.
    return (
      encodedNetwork === selectedNetwork ||
      (selectedNetwork === ServerChainNameEnum.swarmTestnetChainName &&
        encodedNetwork === ServerChainNameEnum.testChainName)
    );
  }

  /**
   * What the SWARM address rules say about `addr` on `chain`, or `undefined`
   * when `chain` is not a SWARM network and the rules have no opinion.
   */
  static addressVerdict(addr: string, chain: "" | ServerChainNameEnum | undefined) {
    return checkAddressForChain(addr, chain || undefined);
  }

  /**
   * Why an address cannot be paid on `chain`, in one sentence a user can act
   * on, or "" when it can. Screens show this instead of a bare "invalid".
   */
  static addressRefusal(addr: string, chain: "" | ServerChainNameEnum | undefined): string {
    const verdict = Utils.addressVerdict(addr, chain);
    return verdict && !verdict.accepted ? verdict.message : "";
  }

  static chainDisplayName(chain: string | undefined): string {
    switch (chain) {
      case ServerChainNameEnum.mainChainName:
        return "Mainnet";
      case ServerChainNameEnum.testChainName:
        return "Testnet";
      case ServerChainNameEnum.regtestChainName:
        return "Regtest";
      case ServerChainNameEnum.swarmTestnetChainName:
        return SWARM_TESTNET_PROFILE.displayName;
      case ServerChainNameEnum.swarmMainnetChainName:
        return SWARM_MAINNET_PROFILE.displayName;
      default:
        return "";
    }
  }

  /**
   * Tries each Zcash network in turn and returns the one for which `addr` parses
   * as a valid address. Used by the address-book migration (entries created
   * before chain tagging) to back-fill the `chain` field without guessing.
   * Returns null if no network recognizes the address — caller should fall back.
   */
  static async detectAddressChain(addr: string): Promise<ServerChainNameEnum | null> {
    if (!addr) return null;
    // A SWARM encoding names its own chain and is never probed against the
    // upstream list below, where `swarm1…` would come back as `test`.
    for (const profile of [SWARM_MAINNET_PROFILE, swarmProfileFor(ServerChainNameEnum.swarmTestnetChainName)]) {
      if (profile && checkAddressForChain(addr, profile.chainLabel)?.accepted) {
        // Only the encodings that are this profile's alone. SwarmTestnet shares
        // `utest1…`/`tm…`/`t2…` with upstream testnet, so those keep falling
        // through to the probe below and keep answering `test`, as they always
        // have.
        if (profile.distinctivePrefixes.some((prefix) => addr.startsWith(prefix))) return profile.chainLabel;
      }
    }
    const chains: ServerChainNameEnum[] = [
      ServerChainNameEnum.mainChainName,
      ServerChainNameEnum.testChainName,
      ServerChainNameEnum.regtestChainName,
    ];
    for (const chain of chains) {
      const kind = await Utils.getAddressKind(addr, chain);
      if (kind !== undefined) return chain;
    }
    return null;
  }

  static isValidSaplingPrivateKey(key: string): boolean {
    return (
      new RegExp("^secret-extended-key-test[0-9a-z]{278}$").test(key) ||
      new RegExp("^secret-extended-key-main[0-9a-z]{278}$").test(key)
    );
  }

  static isValidSaplingViewingKey(key: string): boolean {
    return new RegExp("^zxviews[0-9a-z]{278}$").test(key);
  }

  // Convert to max 8 decimal places, and remove trailing zeros
  static maxPrecision(v: number): string {
    if (!v) return `${v}`;

    return v.toFixed(8);
  }

  static maxPrecisionTrimmed(v: number): string {
    let s: string = Utils.maxPrecision(v);
    if (!s) {
      return s;
    }

    while (s.indexOf(".") >= 0 && s.substr(s.length - 1, 1) === "0") {
      s = s.substr(0, s.length - 1);
    }

    if (s.substr(s.length - 1) === ".") {
      s = s.substr(0, s.length - 1);
    }

    return s;
  }

  static splitZecAmountIntoBigSmall(zecValue: number) {
    if (!zecValue) {
      return { bigPart: zecValue.toString(), smallPart: "" };
    }

    let bigPart: string = Utils.maxPrecision(zecValue);
    let smallPart: string = "";

    if (bigPart.indexOf(".") >= 0) {
      const decimalPart: string = bigPart.substr(bigPart.indexOf(".") + 1);
      if (decimalPart.length > 4) {
        smallPart = decimalPart.substr(4);
        bigPart = bigPart.substr(0, bigPart.length - smallPart.length);

        // Pad the small part with trailing 0s
        while (smallPart.length < 4) {
          smallPart += "0";
        }
      }
    }

    if (smallPart === "0000") {
      smallPart = "";
    }

    return { bigPart, smallPart };
  }

  static getReceivers(addr: UnifiedAddressClass): string[] {
    let receivers: string[] = [];

    if (addr.has_orchard) receivers.push(IRONWOOD_RECEIVER_LABEL);
    if (addr.has_sapling) receivers.push("Sapling");
    if (addr.has_transparent) receivers.push("Transparent");

    return receivers;
  }

  static splitStringIntoChunks(s: string, numChunks: number) {
    if (numChunks > s.length) return [s];
    if (s.length < 16) return [s];

    const chunkSize: number = Math.round(s.length / numChunks);
    const chunks: string[] = [];
    for (let i = 0; i < numChunks - 1; i++) {
      chunks.push(s.substr(i * chunkSize, chunkSize));
    }
    // Last chunk might contain un-even length
    chunks.push(s.substr((numChunks - 1) * chunkSize));

    return chunks;
  }

  static nextToAddrID: number = 0;

  static getNextToAddrID(): number {
    return Utils.nextToAddrID++;
  }

  /**
   * The donation feature upstream shipped is not wired up in this fork, and
   * these three are what is left of it: nothing in the interface calls them.
   *
   * They are kept, and emptied, rather than deleted. An empty address cannot
   * become a payment; a zero amount cannot prefill one; and the memo no longer
   * asks a SWARM user to thank a different project. If a donation flow is ever
   * built for this network it starts from a blank here rather than inheriting
   * somebody else's recipient by accident.
   */
  static getDonationAddress(_testnet: boolean): string {
    return "";
  }

  static getDefaultDonationAmount(_testnet: boolean): number {
    return 0;
  }

  static getDefaultDonationMemo(_testnet: boolean): string {
    return "";
  }

  static getZecToUsdString(price?: number, zecValue?: number): string {
    if (!price || !zecValue) {
      return "USD --";
    }

    if (price * zecValue < 0.01) {
      return "USD < 0.01";
    }

    return `USD ${(price * zecValue).toFixed(2)}`;
  }

  /**
   * Formats the per-ZEC exchange rate. Returns `USD --` when the price is
   * missing — matches the fallback of `getZecToUsdString` so the UI is
   * consistent everywhere a USD figure may not be available. Otherwise
   * `USD x.xx / ZEC`.
   */
  static getZecRateString(price?: number): string {
    if (!price) return "USD --";
    return `USD ${price.toFixed(2)} / ZEC`;
  }

  static utf16Split(s: string, chunksize: number): string[] {
    const ans: string[] = [];

    let current: string = "";
    let currentLen: number = 0;
    const a: string[] = [...s];
    for (let i = 0; i < a.length; i++) {
      // Each UTF-16 char will take upto 4 bytes when encoded
      const utf8len: number = a[i].length > 1 ? 4 : 1;

      // Test if adding it will exceed the size
      if (currentLen + utf8len > chunksize) {
        ans.push(current);
        current = "";
        currentLen = 0;
      }

      current += a[i];
      currentLen += utf8len;
    }

    if (currentLen > 0) {
      ans.push(current);
    }

    return ans;
  }

  static generateColorList(numColors: number): string[] {
    const colorList: string[] = [];

    for (let i = 0; i < numColors; i++) {
      const color = randomColor({
        luminosity: "bright", // Define la luminosidad de los colores generados
        format: "hex", // Formato de color en hexadecimal
      });

      colorList.push(color);
    }

    return colorList;
  }

  // Deterministic bright colour keyed by an arbitrary string (e.g. a token
  // ticker). Same seed always yields the same colour, so a per-asset avatar
  // keeps a stable identity across re-renders instead of flickering a new
  // random colour each time. Mirrors `generateColorList`'s options; only the
  // `seed` makes it reproducible.
  static generateColorFromSeed(seed: string): string {
    return randomColor({
      seed,
      luminosity: "bright",
      format: "hex",
    });
  }

  static getLabelColor(bgColor: string): string {
    // Remove the '#' if present.
    if (bgColor.startsWith("#")) {
      bgColor = bgColor.slice(1);
    }

    // Convert the hexadecimal color to its red, green, and blue components.
    const r: number = parseInt(bgColor.substring(0, 2), 16);
    const g: number = parseInt(bgColor.substring(2, 4), 16);
    const b: number = parseInt(bgColor.substring(4, 6), 16);

    // Calculate the brightness using the standard luminance formula.
    const brightness: number = (r * 299 + g * 587 + b * 114) / 1000;

    // If the brightness is greater than 128, return dark text (black); otherwise, return light text (white).
    return brightness > 128 ? "#000000" : "#FFFFFF";
  }

  static usesMainnetExplorerSettings = (chainName: ServerChainNameEnum | string | undefined): boolean =>
    chainName === ServerChainNameEnum.mainChainName || chainName === ServerChainNameEnum.swarmMainnetChainName;

  /** The SWARM explorer for the wallet's verified network. */
  static zecExplorerTxUrl = (
    txid: string,
    chainName: ServerChainNameEnum | undefined,
    _blockExplorer: BlockExplorerEnum,
    _blockExplorerCustom: string,
  ): string => {
    const swarm = swarmProfileFor(chainName);
    return swarm && txid ? `${swarm.explorer}/transactions/${encodeURIComponent(txid)}` : "";
  };

  /** Only transparent SWARM addresses have explorer pages. */
  static zecExplorerAddressUrl = (
    address: string,
    chainName: ServerChainNameEnum | undefined,
    _blockExplorer: BlockExplorerEnum,
    _blockExplorerCustom: string,
  ): string => {
    const swarm = swarmProfileFor(chainName);
    const transparent = swarm?.transparentPrefixes.some((prefix) => address.startsWith(prefix));
    return swarm && transparent ? `${swarm.explorer}/address/${encodeURIComponent(address)}` : "";
  };

  static openTxid = (
    txid: string,
    chainName: ServerChainNameEnum | undefined,
    blockExplorer: BlockExplorerEnum,
    blockExplorerCustom: string,
  ) => {
    const url = Utils.zecExplorerTxUrl(txid, chainName, blockExplorer, blockExplorerCustom);
    if (url) shell.openExternal(url);
  };

  static openAddress = (
    address: string,
    chainName: ServerChainNameEnum | undefined,
    blockExplorer: BlockExplorerEnum,
    blockExplorerCustom: string,
  ) => {
    const url = Utils.zecExplorerAddressUrl(address, chainName, blockExplorer, blockExplorerCustom);
    if (url) shell.openExternal(url);
  };
}
