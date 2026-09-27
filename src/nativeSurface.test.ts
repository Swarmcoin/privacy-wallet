/**
 * The bridge and the addon have to agree about what exists.
 *
 * Every native call leaves the renderer as `native.<name>(...)`, which the
 * preload turns into `ipcRenderer.invoke("native:<name>", …)`, which the main
 * process answers with `requireNative(name)[name](…)`. Three lists, in three
 * files, that have to name the same functions — and if one of them does not,
 * the call is `undefined is not a function` in a packaged build and nowhere
 * else.
 *
 * That is not hypothetical. On 2026-09-27 the eleven `treasury_*` functions
 * were in the addon, in `src/native.node.d.ts`, and in every caller in
 * `src/treasury/`, and in neither `_ALL_NATIVE_METHODS` in
 * `public/preload.js` nor any `ipcMain.handle("native:treasury_*")` in
 * `public/electron.js`. In the packaged mainnet.3 build every one of them
 * was `undefined` in the renderer, so the Treasury page threw on mount, at
 * `treasury_policy_verify`, before it had drawn a single fund.
 *
 * The whole suite was green throughout, because `src/__mocks__/
 * electronBridge.ts` supplies all eleven as `jest.fn`. A mock more capable
 * than the real bridge is a mock that hides exactly this. So this test reads
 * the three files as text and holds them against each other, and it is
 * deliberately the only test in the suite that does not go through the mock.
 *
 * `src/rpc/nativeIpc.test.ts` already held the preload's list against main's
 * handlers, and it passed all along: a function in neither list is in
 * agreement with itself. What was missing is the step before it — the addon's
 * own declared surface against the preload's list — and the step beside it,
 * the mock against the same list. Both are here.
 */

import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/** The names `src/native.node.d.ts` declares — what the addon offers. */
function declaredByTheAddon(): string[] {
  const source = read("src/native.node.d.ts");
  return [...source.matchAll(/export function (\w+)\s*\(/g)].map((m) => m[1]);
}

/** The names `public/preload.js` puts on `window.electronAPI.native`. */
function exposedByThePreload(): string[] {
  const source = read("public/preload.js");
  const list = source.match(/const _ALL_NATIVE_METHODS = \[([\s\S]*?)\n\];/);
  if (!list) throw new Error("preload.js no longer declares _ALL_NATIVE_METHODS as one array");
  return [...list[1].matchAll(/"([\w]+)"/g)].map((m) => m[1]);
}

/** The `native:<name>` channels `public/electron.js` answers. */
function answeredByMain(): Set<string> {
  const source = read("public/electron.js");
  const names = new Set<string>();
  // The one-by-one handlers: ipcMain.handle("native:foo", …)
  for (const match of source.matchAll(/ipcMain\.handle\(\s*"native:(\w+)"/g)) {
    names.add(match[1]);
  }
  // The loops: `for (const method of [ … ]) { ipcMain.handle(`native:${method}` … }`,
  // read from their own array literals rather than being assumed.
  for (const block of source.matchAll(/for \(const method of ([\s\S]*?)\]\) \{[\s\S]*?ipcMain\.handle\(`native:\$\{method\}`/g)) {
    for (const name of block[1].matchAll(/"([\w]+)"/g)) names.add(name[1]);
  }
  // `_NATIVE_NO_PARAM_METHODS` is declared above its loop rather than inline.
  const noParam = source.match(/const _NATIVE_NO_PARAM_METHODS = \[([\s\S]*?)\n\];/);
  if (noParam) {
    for (const name of noParam[1].matchAll(/"([\w]+)"/g)) names.add(name[1]);
  }
  return names;
}

describe("the native bridge", () => {
  const declared = declaredByTheAddon();
  const exposed = exposedByThePreload();

  it("declares a surface worth checking", () => {
    expect(declared.length).toBeGreaterThan(50);
    expect(exposed.length).toBeGreaterThan(50);
  });

  /**
   * Addon functions the renderer is deliberately not given.
   *
   * The mixnet transport is main-owned and session-level: main spawns the
   * nym-proxy and holds it for the whole app session, and switching wallets
   * re-attaches the new LightClient to the same tunnel (ADR 0024). A
   * renderer that could start or stop it would be able to take the wallet's
   * traffic off the mixnet, so these three stay on the far side of the
   * bridge. Named here rather than allowed by a pattern: an exception that
   * has to be typed out is an exception somebody has to justify.
   */
  const deliberatelyNotExposed = ["mixnet_status", "attach_mixnet", "stop_mixnet"];

  it("exposes every function the addon declares, bar the ones main keeps", () => {
    const missing = declared
      .filter((name) => !exposed.includes(name))
      .filter((name) => !deliberatelyNotExposed.includes(name));
    expect(missing).toEqual([]);
  });

  it("still has the functions main keeps to itself", () => {
    // If one of these is ever exposed, the exclusion above stops being an
    // exclusion and starts being a lie.
    for (const name of deliberatelyNotExposed) {
      expect(declared).toContain(name);
      expect(exposed).not.toContain(name);
    }
  });

  it("exposes nothing the addon does not declare", () => {
    // A name here that the addon does not have is a call that reaches main
    // and dies there instead of failing where it was written.
    const strangers = exposed.filter((name) => !declared.includes(name));
    expect(strangers).toEqual([]);
  });

  it("carries the treasury surface the Treasury page needs", () => {
    // Named, not just counted: this is the set that was missing, and the
    // page is unusable without any one of them.
    for (const name of [
      "treasury_signer_import",
      "treasury_policy_verify",
      "treasury_proposal_build",
      "treasury_proposal_summary",
      "treasury_proposal_sign",
      "treasury_signatures_combine",
      "treasury_utxos_from_lightwalletd",
      "treasury_broadcast",
      "treasury_seal",
      "treasury_unseal",
      "treasury_session_id",
    ]) {
      expect(declared).toContain(name);
      expect(exposed).toContain(name);
      expect(answeredByMain().has(name)).toBe(true);
    }
  });

  it("mocks exactly the surface the bridge has, and no more", () => {
    // The mock being larger than the bridge is what hid the gap. It must
    // track the real thing in both directions.
    const mock = read("src/__mocks__/electronBridge.ts");
    // Only the `native` object: the file also mocks clipboard, shell,
    // ipcRenderer and fs, which are not addon functions.
    const nativeBlock = mock.match(/export const native = \{([\s\S]*?)\n\};/);
    if (!nativeBlock) throw new Error("the mock no longer declares `native` as one object");
    const mocked = [...nativeBlock[1].matchAll(/^\s{2}(\w+): jest\.fn\(\)/gm)].map((m) => m[1]);
    const overreach = mocked.filter((name) => !exposed.includes(name));
    expect(overreach).toEqual([]);
  });
});

describe("the addon's SWARM production profile", () => {
  it("is a candidate for every address parse_address answers", () => {
    // The mainnet.2 to .5 defect in one line: a candidate list with no
    // production entry, so every swm1/s1/s3 answered "Invalid address". Read
    // from the source so a revert is a red test in the renderer suite too,
    // and not only in the Rust suite the workflows run.
    const lib = read("native/src/lib.rs");
    const body = lib.match(/fn address_chain_profiles\(\) -> \[ChainType; \d+\] \{([\s\S]*?)\n\}/);
    expect(body).not.toBeNull();
    expect(body?.[1]).toContain("ChainType::SwarmMainnet(");
  });
});
