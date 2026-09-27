"use strict";

// The decisions the signed macOS release makes, kept apart from the macOS-only
// steps (codesign, notarytool, lipo) so they can be tested on any machine:
//
//   node --test scripts/mac-release-checks.test.cjs
//   node scripts/mac-release-checks.cjs source [--profile <swarm-mainnet|swarm-testnet>]
//
// 1. WHICH SOURCE TREE MAY BE SIGNED. scripts/build-mac-distribution.js records
//    `git rev-parse HEAD` in the release manifest, so it refuses a tree HEAD does
//    not describe. One change is part of every non-default build, and the build
//    makes it itself: scripts/set-build-profile.js writes the selected network
//    into src/buildProfile.json before anything reads it. Until 2026-09-27 that
//    change alone made the signed build refuse to start on the mainnet profile.
//    Exactly the bytes set-build-profile.js writes from HEAD's copy, for the
//    profile being built, are accepted and recorded; every other change is
//    refused, including one hidden from `git status` with skip-worktree or
//    assume-unchanged.
//
// 2. WHETHER THE FRONTEND WAS BUILT FOR THAT PROFILE. `yarn script:build` bakes
//    src/buildProfile.json into the renderer, and electron-builder reads it
//    again when it names and stamps the package. A profile selected after the
//    frontend was built packages a mainnet app around a testnet renderer.
//
// 3. WHAT A DEVELOPER ID SIGNATURE LOOKS LIKE in `codesign -dv --verbose=4`,
//    for every Mach-O the wallet ships: not ad hoc (the CI build's arm64
//    signature, which Gatekeeper reports as damaged), a Developer ID Application
//    authority, the outer app's team, a secure timestamp, and the hardened
//    runtime on every executable — what notarization requires of each file.
//
// 4. WHETHER THE PACKAGE IS THE ONE THE PROFILE DESCRIBES: Info.plist and the
//    packaged package.json against src/buildProfile.json.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const BUILD_PROFILE = "src/buildProfile.json";

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Exactly what scripts/set-build-profile.js writes when it selects `profile`. */
function generatedBuildProfile(headText, profile) {
  const head = JSON.parse(headText);
  if (!head.profiles || !Object.prototype.hasOwnProperty.call(head.profiles, profile)) {
    throw new Error(`'${profile}' is not a network ${BUILD_PROFILE} describes`);
  }
  return JSON.stringify({ ...head, profile }, null, 2) + "\n";
}

/** `git status --porcelain=v1 -z`: "XY path\0", plus "origin\0" after a rename or copy. */
function parseStatusZ(text) {
  const fields = text.split("\0");
  const entries = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (!fields[i]) continue;
    const entry = { xy: fields[i].slice(0, 2), path: fields[i].slice(3) };
    if (entry.xy[0] === "R" || entry.xy[0] === "C") {
      entry.from = fields[i + 1];
      i += 1;
    }
    entries.push(entry);
  }
  return entries;
}

/** `git ls-files -v -z`: "H path\0"; S is skip-worktree, lowercase is assume-unchanged. */
function parseLsFilesZ(text) {
  return text
    .split("\0")
    .filter(Boolean)
    .map((field) => ({ tag: field.slice(0, 1), path: field.slice(2) }));
}

/**
 * Whether this tree may be signed, and what the manifest must say about it.
 *
 * `requestedProfile` is the profile the caller asked for (--profile or
 * SWARM_NETWORK_PROFILE); when it is absent the file's own selection is the
 * profile being built.
 */
function decideReleaseSource({ status, flagged, headProfileText, workingProfileText, requestedProfile }) {
  const problems = [];
  let working;
  let head;
  try {
    working = JSON.parse(workingProfileText);
    head = JSON.parse(headProfileText);
  } catch (error) {
    return { ok: false, profile: null, sourceState: null, problems: [`${BUILD_PROFILE} is not valid JSON: ${error.message}`] };
  }
  const profile = working.profile;
  const known = Object.keys(head.profiles || {});
  if (!known.includes(profile)) {
    return {
      ok: false,
      profile,
      sourceState: null,
      problems: [`${BUILD_PROFILE} selects '${profile}', which HEAD does not describe (on offer: ${known.join(", ")})`],
    };
  }
  if (requestedProfile && requestedProfile !== profile) {
    problems.push(
      `This build was asked for '${requestedProfile}', but ${BUILD_PROFILE} selects '${profile}'. Run ` +
        `SWARM_NETWORK_PROFILE=${requestedProfile} node scripts/set-build-profile.js, rebuild the frontend ` +
        `(yarn script:build), then sign.`,
    );
  }
  const unchanged = workingProfileText === headProfileText;
  if (!unchanged && workingProfileText !== generatedBuildProfile(headProfileText, profile)) {
    problems.push(
      `${BUILD_PROFILE} differs from HEAD by more than the '${profile}' selection scripts/set-build-profile.js ` +
        `writes. Restore it (git checkout -- ${BUILD_PROFILE}) and select the profile again.`,
    );
  }
  const changed = status.filter((entry) => !(entry.path === BUILD_PROFILE && /^[ M]{2}$/.test(entry.xy)));
  if (changed.length > 0) {
    problems.push(
      "HEAD does not describe these paths; commit and review them, or restore them, before signing: " +
        changed.map((entry) => `[${entry.xy}] ${entry.path}${entry.from ? ` (from ${entry.from})` : ""}`).join(", "),
    );
  }
  const hidden = flagged.filter((entry) => entry.path !== BUILD_PROFILE);
  if (hidden.length > 0) {
    problems.push(
      "git is told not to look at these paths (skip-worktree or assume-unchanged), so a change there would " +
        "not be seen: " +
        hidden.map((entry) => `[${entry.tag}] ${entry.path}`).join(", ") +
        ". Clear it with git update-index --no-skip-worktree --no-assume-unchanged <path>.",
    );
  }
  return { ok: problems.length === 0, profile, sourceState: unchanged ? "clean" : "generated-build-profile", problems };
}

/** The same decision, read from a real checkout. */
function inspectSourceTree(root, requestedProfile) {
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const commit = git(["rev-parse", "HEAD"]).trim();
  const status = parseStatusZ(git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]));
  const flagged = parseLsFilesZ(git(["ls-files", "-v", "-z"])).filter((entry) => entry.tag !== "H");
  const headProfileText = git(["show", `HEAD:${BUILD_PROFILE}`]);
  const workingProfileText = fs.readFileSync(path.join(root, BUILD_PROFILE), "utf8");
  const decision = decideReleaseSource({ status, flagged, headProfileText, workingProfileText, requestedProfile });
  return { ...decision, commit, buildProfileSha256: sha256(workingProfileText) };
}

/** What the release manifest says about the tree it was built from. */
function describeSourceTree(source) {
  return source.sourceState === "clean"
    ? `HEAD ${source.commit}, clean`
    : `HEAD ${source.commit} plus ${BUILD_PROFILE} exactly as scripts/set-build-profile.js writes it for ${source.profile}`;
}

/** The frontend in build/ must have been built after the profile last changed. */
function frontendProblems({ profileMtimeMs, frontendMtimeMs }) {
  if (frontendMtimeMs == null) {
    return ["build/index.html is missing: select the profile, then run yarn script:build"];
  }
  if (frontendMtimeMs < profileMtimeMs) {
    return [
      `build/index.html is older than ${BUILD_PROFILE}: the frontend was built before the network profile ` +
        "last changed, so it would carry the other network's name. Run yarn script:build again, then sign.",
    ];
  }
  return [];
}

/** `lipo -archs` answers for the prebuilt binaries, against the architecture being packaged. */
function architectureProblems(expected, archsByFile) {
  return Object.entries(archsByFile)
    .filter(([, archs]) => !archs.split(/\s+/).includes(expected))
    .map(([file, archs]) => `${file} is ${archs.trim() || "unreadable"}, not ${expected}; rebuild it for this architecture`);
}

/** The fields of `codesign -dv --verbose=4` (written to stderr) that decide distribution. */
function parseCodesignDetails(text) {
  const lines = text.split(/\r?\n/);
  const value = (key) => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line === undefined ? null : line.slice(key.length + 1);
  };
  const codeDirectory = lines.find((l) => l.startsWith("CodeDirectory ")) || "";
  const flags = (codeDirectory.match(/flags=0x[0-9a-f]+\(([^)]*)\)/i) || [null, ""])[1].split(",").filter(Boolean);
  return {
    identifier: value("Identifier"),
    authorities: lines.filter((l) => l.startsWith("Authority=")).map((l) => l.slice("Authority=".length)),
    teamIdentifier: value("TeamIdentifier"),
    adhoc: value("Signature") === "adhoc" || flags.includes("adhoc"),
    linkerSigned: flags.includes("linker-signed"),
    runtime: flags.includes("runtime"),
    timestamp: value("Timestamp"),
  };
}

/** Why a signature is not a Developer ID distribution signature; empty when it is. */
function signatureProblems(details, { team, executable }) {
  const problems = [];
  if (details.adhoc) problems.push(details.linkerSigned ? "only the linker's ad hoc signature" : "an ad hoc signature");
  if (!details.authorities[0] || !details.authorities[0].startsWith("Developer ID Application:")) {
    problems.push(`no Developer ID Application authority (${details.authorities[0] || "none"})`);
  }
  if (!details.teamIdentifier || details.teamIdentifier === "not set") {
    problems.push("no team identifier");
  } else if (team && details.teamIdentifier !== team) {
    problems.push(`team ${details.teamIdentifier}, not the app's ${team}`);
  }
  if (!details.timestamp) problems.push("no secure timestamp");
  if (executable && !details.runtime) problems.push("no hardened runtime");
  return problems;
}

/** Whether the packaged app is the one src/buildProfile.json describes. */
function packagedIdentityProblems({ plist, packaged, identity, profile }) {
  const problems = [];
  const expect = (what, actual, wanted) => {
    if (actual !== wanted) problems.push(`${what} is ${JSON.stringify(actual)}, not ${JSON.stringify(wanted)}`);
  };
  expect("Info.plist CFBundleIdentifier", plist.CFBundleIdentifier, identity.appId);
  expect("Info.plist CFBundleShortVersionString", plist.CFBundleShortVersionString, identity.version);
  expect("Info.plist CFBundleExecutable", plist.CFBundleExecutable, identity.executableName);
  expect("the packaged package.json swarmNetworkProfile", packaged.swarmNetworkProfile, profile);
  expect("the packaged package.json version", packaged.version, identity.version);
  expect("the packaged package.json name", packaged.name, identity.packageName);
  return problems;
}

/** The release file names, one set per architecture, so they never collide with another platform's. */
function releaseFileNames(version, arch) {
  if (!["arm64", "x64"].includes(arch)) throw new Error(`Unsupported Mac architecture: ${arch}`);
  return {
    dmg: `SWARM-Wallet-${version}-mac-${arch}.dmg`,
    zip: `SWARM-Wallet-${version}-mac-${arch}.zip`,
    checksums: `SHA256SUMS-mac-${arch}`,
    manifest: `release-manifest-mac-${arch}.json`,
  };
}

module.exports = {
  BUILD_PROFILE,
  generatedBuildProfile,
  parseStatusZ,
  parseLsFilesZ,
  decideReleaseSource,
  inspectSourceTree,
  describeSourceTree,
  frontendProblems,
  architectureProblems,
  parseCodesignDetails,
  signatureProblems,
  packagedIdentityProblems,
  releaseFileNames,
};

if (require.main === module) {
  const [command] = process.argv.slice(2);
  const flag = process.argv.indexOf("--profile");
  if (command !== "source" || (flag >= 0 && !process.argv[flag + 1])) {
    console.error("usage: node scripts/mac-release-checks.cjs source [--profile <network profile>]");
    process.exit(2);
  }
  const requested = flag >= 0 ? process.argv[flag + 1] : process.env.SWARM_NETWORK_PROFILE || null;
  const source = inspectSourceTree(path.resolve(__dirname, ".."), requested);
  if (!source.ok) {
    console.error(`A signed Mac build would refuse this tree:\n- ${source.problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`A signed Mac build would accept this tree: ${describeSourceTree(source)} (profile ${source.profile}).`);
}
