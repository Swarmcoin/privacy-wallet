"use strict";

// The signed Mac release's decisions, on any machine (the macOS-only steps are
// not run here): node --test scripts/mac-release-checks.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const checks = require("./mac-release-checks.cjs");

const root = path.resolve(__dirname, "..");
const HEAD_PROFILE = fs.readFileSync(path.join(root, "src/buildProfile.json"), "utf8");
const HEAD_SELECTS = JSON.parse(HEAD_PROFILE).profile;
const OTHER = Object.keys(JSON.parse(HEAD_PROFILE).profiles).find((id) => id !== HEAD_SELECTS);

const decide = (overrides) =>
  checks.decideReleaseSource({
    status: [],
    flagged: [],
    headProfileText: HEAD_PROFILE,
    workingProfileText: HEAD_PROFILE,
    requestedProfile: null,
    ...overrides,
  });

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=T9 test", "-c", "user.email=t9@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** A throwaway repository holding this repo's build profile and the script that writes it. */
function scratchRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-mac-release-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, "-c", "init.defaultBranch=main", "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "src/buildProfile.json"), HEAD_PROFILE);
  fs.copyFileSync(path.join(root, "scripts/set-build-profile.js"), path.join(dir, "scripts/set-build-profile.js"));
  fs.writeFileSync(path.join(dir, "package.json"), '{\n  "name": "scratch"\n}\n');
  fs.writeFileSync(path.join(dir, ".gitignore"), "/dist-mac-signed\n/build\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "scratch");
  return dir;
}

const selectProfile = (dir, profile) =>
  execFileSync(process.execPath, ["scripts/set-build-profile.js"], {
    cwd: dir,
    env: { ...process.env, SWARM_NETWORK_PROFILE: profile },
    encoding: "utf8",
  });

test("the profile HEAD selects, untouched, is a clean tree", () => {
  const decision = decide({});
  assert.equal(decision.ok, true, decision.problems.join("\n"));
  assert.equal(decision.sourceState, "clean");
  assert.equal(decision.profile, HEAD_SELECTS);
});

test("exactly what set-build-profile.js writes for another profile is accepted and named", () => {
  const working = checks.generatedBuildProfile(HEAD_PROFILE, OTHER);
  const decision = decide({ workingProfileText: working, status: [{ xy: " M", path: checks.BUILD_PROFILE }] });
  assert.equal(decision.ok, true, decision.problems.join("\n"));
  assert.equal(decision.sourceState, "generated-build-profile");
  assert.equal(decision.profile, OTHER);
  assert.match(
    checks.describeSourceTree({ ...decision, commit: "c0ffee" }),
    new RegExp(`HEAD c0ffee plus src/buildProfile.json exactly as scripts/set-build-profile.js writes it for ${OTHER}`),
  );
});

test("the requested profile must be the one the file selects", () => {
  const working = checks.generatedBuildProfile(HEAD_PROFILE, OTHER);
  const status = [{ xy: " M", path: checks.BUILD_PROFILE }];
  assert.equal(decide({ workingProfileText: working, status, requestedProfile: OTHER }).ok, true);
  const refused = decide({ workingProfileText: working, status, requestedProfile: HEAD_SELECTS });
  assert.equal(refused.ok, false);
  assert.match(refused.problems.join("\n"), /set-build-profile\.js/);
  assert.match(refused.problems.join("\n"), /yarn script:build/);
});

test("a build profile edited by hand is refused, even when it selects a known profile", () => {
  // The same selection, reformatted: what an editor or a hand edit leaves, not the script.
  const selectedByHand = JSON.stringify({ ...JSON.parse(HEAD_PROFILE), profile: OTHER }, null, 4) + "\n";
  assert.notEqual(selectedByHand, checks.generatedBuildProfile(HEAD_PROFILE, OTHER));
  const byHand = decide({ workingProfileText: selectedByHand, status: [{ xy: " M", path: checks.BUILD_PROFILE }] });
  assert.equal(byHand.ok, false);
  assert.match(byHand.problems.join("\n"), /differs from HEAD by more than/);

  const versionBumped = JSON.parse(checks.generatedBuildProfile(HEAD_PROFILE, OTHER));
  versionBumped.profiles[OTHER].version += "-local";
  const bumped = decide({
    workingProfileText: JSON.stringify(versionBumped, null, 2) + "\n",
    status: [{ xy: " M", path: checks.BUILD_PROFILE }],
  });
  assert.equal(bumped.ok, false);
});

test("a profile HEAD does not describe is refused", () => {
  const unknown = JSON.stringify({ ...JSON.parse(HEAD_PROFILE), profile: "main" }, null, 2) + "\n";
  const decision = decide({ workingProfileText: unknown, status: [{ xy: " M", path: checks.BUILD_PROFILE }] });
  assert.equal(decision.ok, false);
  assert.match(decision.problems[0], /selects 'main', which HEAD does not describe/);
});

test("any other change, staged, untracked or renamed, is refused and named", () => {
  const working = checks.generatedBuildProfile(HEAD_PROFILE, OTHER);
  const decision = decide({
    workingProfileText: working,
    status: [
      { xy: " M", path: checks.BUILD_PROFILE },
      { xy: " M", path: "package.json" },
      { xy: "??", path: "notes.txt" },
      { xy: "R ", path: "b.js", from: "a.js" },
    ],
  });
  assert.equal(decision.ok, false);
  const said = decision.problems.join("\n");
  for (const name of ["package.json", "notes.txt", "b.js (from a.js)"]) assert.match(said, new RegExp(name.replace(/[().]/g, "\\$&")));
  assert.doesNotMatch(said, /\] src\/buildProfile\.json/);
  assert.equal(decide({ status: [{ xy: " D", path: checks.BUILD_PROFILE }] }).ok, false);
});

test("a change hidden with skip-worktree or assume-unchanged is refused, except the checked profile", () => {
  const hidden = decide({ flagged: [{ tag: "S", path: "package.json" }, { tag: "h", path: "yarn.lock" }] });
  assert.equal(hidden.ok, false);
  assert.match(hidden.problems.join("\n"), /\[S\] package\.json, \[h\] yarn\.lock/);
  const profileOnly = decide({
    flagged: [{ tag: "S", path: checks.BUILD_PROFILE }],
    workingProfileText: checks.generatedBuildProfile(HEAD_PROFILE, OTHER),
  });
  assert.equal(profileOnly.ok, true, profileOnly.problems.join("\n"));
});

test("git's -z output is read without quoting", () => {
  assert.deepEqual(checks.parseStatusZ(" M src/buildProfile.json\0?? a b.txt\0R  new.js\0old.js\0"), [
    { xy: " M", path: "src/buildProfile.json" },
    { xy: "??", path: "a b.txt" },
    { xy: "R ", path: "new.js", from: "old.js" },
  ]);
  assert.deepEqual(checks.parseLsFilesZ("H package.json\0S src/buildProfile.json\0"), [
    { tag: "H", path: "package.json" },
    { tag: "S", path: "src/buildProfile.json" },
  ]);
});

test("the gate's generated bytes are the bytes set-build-profile.js writes, in a real checkout", (t) => {
  const dir = scratchRepo(t);
  assert.equal(checks.inspectSourceTree(dir, null).sourceState, "clean");
  selectProfile(dir, OTHER);
  const written = fs.readFileSync(path.join(dir, "src/buildProfile.json"), "utf8");
  assert.equal(written, checks.generatedBuildProfile(HEAD_PROFILE, OTHER));

  const source = checks.inspectSourceTree(dir, OTHER);
  assert.equal(source.ok, true, source.problems.join("\n"));
  assert.equal(source.sourceState, "generated-build-profile");
  assert.equal(source.commit, git(dir, "rev-parse", "HEAD").trim());
  assert.match(source.buildProfileSha256, /^[0-9a-f]{64}$/);
  assert.equal(checks.inspectSourceTree(dir, HEAD_SELECTS).ok, false);

  // Selecting the HEAD profile again is also exactly what the script writes.
  selectProfile(dir, HEAD_SELECTS);
  assert.equal(checks.inspectSourceTree(dir, HEAD_SELECTS).ok, true);
});

test("in a real checkout, untracked files and hidden edits are refused and ignored output is not", (t) => {
  const dir = scratchRepo(t);
  selectProfile(dir, OTHER);
  fs.mkdirSync(path.join(dir, "dist-mac-signed"));
  fs.writeFileSync(path.join(dir, "dist-mac-signed", "anything"), "generated output");
  assert.equal(checks.inspectSourceTree(dir, OTHER).ok, true);

  fs.writeFileSync(path.join(dir, "stray.txt"), "not committed");
  assert.match(checks.inspectSourceTree(dir, OTHER).problems.join("\n"), /\[\?\?\] stray\.txt/);
  fs.rmSync(path.join(dir, "stray.txt"));

  // What the macOS install hook used to leave behind.
  fs.writeFileSync(path.join(dir, "package.json"), '{\n  "name": "scratch"\n}');
  assert.match(checks.inspectSourceTree(dir, OTHER).problems.join("\n"), /\[ M\] package\.json/);
  git(dir, "update-index", "--skip-worktree", "package.json");
  assert.match(checks.inspectSourceTree(dir, OTHER).problems.join("\n"), /\[S\] package\.json/);
  git(dir, "update-index", "--no-skip-worktree", "package.json");
  git(dir, "checkout", "--", "package.json");

  // The manual workaround for a release commit without this gate hides the
  // profile file; the gate still reads it, so the workaround cannot hide an edit.
  git(dir, "update-index", "--skip-worktree", "src/buildProfile.json");
  assert.equal(checks.inspectSourceTree(dir, OTHER).ok, true);
  fs.appendFileSync(path.join(dir, "src/buildProfile.json"), "\n");
  assert.equal(checks.inspectSourceTree(dir, OTHER).ok, false);
});

test("the frontend must be built after the profile was selected", () => {
  assert.deepEqual(checks.frontendProblems({ profileMtimeMs: 1000, frontendMtimeMs: 2000 }), []);
  assert.match(checks.frontendProblems({ profileMtimeMs: 2000, frontendMtimeMs: 1000 })[0], /yarn script:build again/);
  assert.match(checks.frontendProblems({ profileMtimeMs: 2000, frontendMtimeMs: null })[0], /missing/);
});

test("a native module left over from the other architecture is named before packaging", () => {
  assert.deepEqual(checks.architectureProblems("x86_64", { "build/native.node": "x86_64", "resources/nym-proxy": "x86_64 arm64" }), []);
  const wrong = checks.architectureProblems("x86_64", { "build/native.node": "arm64", "resources/nym-proxy": "" });
  assert.equal(wrong.length, 2);
  assert.match(wrong[0], /build\/native\.node is arm64, not x86_64/);
  assert.match(wrong[1], /unreadable/);
});

test("Mac release files are named per platform and never take the Windows zip's name", () => {
  assert.deepEqual(checks.releaseFileNames("0.1.0-mainnet.6", "x64"), {
    dmg: "SWARM-Wallet-0.1.0-mainnet.6-mac-x64.dmg",
    zip: "SWARM-Wallet-0.1.0-mainnet.6-mac-x64.zip",
    checksums: "SHA256SUMS-mac-x64",
    manifest: "release-manifest-mac-x64.json",
  });
  const windowsZip = require(path.join(root, "configs/swarm-builder.cjs"))
    .artifactName.replace("${version}", "0.1.0-mainnet.6")
    .replace("${arch}", "x64")
    .replace("${ext}", "zip");
  assert.equal(windowsZip, "SWARM-Wallet-0.1.0-mainnet.6-x64.zip");
  assert.notEqual(checks.releaseFileNames("0.1.0-mainnet.6", "x64").zip, windowsZip);
  assert.throws(() => checks.releaseFileNames("0.1.0-mainnet.6", "universal"), /Unsupported/);
});

/** configs/swarm-mac-developer-id.cjs, loaded with a stand-in for the Keychain lookup. */
function developerIdConfig(arch) {
  const identityModule = require.resolve("./mac-distribution-identity.cjs");
  const configModule = require.resolve("../configs/swarm-mac-developer-id.cjs");
  const saved = { identity: require.cache[identityModule], arch: process.env.SWARM_MAC_ARCH };
  require.cache[identityModule] = {
    id: identityModule,
    filename: identityModule,
    loaded: true,
    exports: () => "Developer ID Application: Example Holder (ABCDE12345)",
  };
  delete require.cache[configModule];
  process.env.SWARM_MAC_ARCH = arch;
  try {
    return require(configModule);
  } finally {
    delete require.cache[configModule];
    if (saved.identity) require.cache[identityModule] = saved.identity;
    else delete require.cache[identityModule];
    if (saved.arch === undefined) delete process.env.SWARM_MAC_ARCH;
    else process.env.SWARM_MAC_ARCH = saved.arch;
  }
}

test("the Developer ID config names files as the script expects", () => {
  for (const arch of ["arm64", "x64"]) {
    const config = developerIdConfig(arch);
    assert.equal(config.afterSign, "./scripts/verify-mac-signed-app.cjs");
    assert.equal(config.mac.identity, "Example Holder (ABCDE12345)");
    assert.equal(config.mac.hardenedRuntime, true);
    assert.equal(config.mac.notarize, true);
    assert.equal(config.mac.entitlements, "./configs/entitlements.swarm-mac.plist");
    assert.equal(config.mac.entitlementsInherit, "./configs/entitlements.swarm-mac.plist");
    assert.ok(config.mac.binaries.includes("Contents/Resources/nym-proxy"));
    assert.equal(config.directories.output, arch === "x64" ? "dist-mac-signed-x64" : "dist-mac-signed");
    assert.deepEqual(config.mac.target, [{ target: "dmg", arch: [arch] }, { target: "zip", arch: [arch] }]);
    const expand = (pattern, ext) => pattern.replace("${version}", "0.1.0-mainnet.6").replace("${arch}", arch).replace("${ext}", ext);
    const names = checks.releaseFileNames("0.1.0-mainnet.6", arch);
    assert.equal(expand(config.dmg.artifactName, "dmg"), names.dmg);
    assert.equal(expand(config.mac.artifactName, "zip"), names.zip);
  }
});

test("electron-builder accepts the Developer ID config", async (t) => {
  let configTools;
  try {
    configTools = {
      ...require("app-builder-lib/out/util/config/config"),
      DebugLogger: require("builder-util").DebugLogger,
    };
  } catch {
    t.skip("electron-builder is not installed here (yarn install --frozen-lockfile)");
    return;
  }
  await configTools.validateConfiguration(developerIdConfig("x64"), new configTools.DebugLogger(false));
});
