"use strict";

// electron-builder's afterSign hook for configs/swarm-mac-developer-id.cjs. It
// runs after the app has been signed and notarized, before the DMG and ZIP are
// written, and refuses a bundle that is not what the release claims:
//
// - the identity src/buildProfile.json selected (Info.plist and the packaged
//   package.json), so a mainnet package cannot carry a testnet name or id;
// - the Rust addon and the pinned Nym helper actually packaged;
// - EVERY Mach-O in the bundle signed with the Developer ID of the outer app's
//   team, with a secure timestamp, and the hardened runtime on every
//   executable. `codesign --verify --deep` alone does not show this: it checks
//   that nested code is validly signed, and an ad hoc signature is valid. The CI
//   arm64 app is the example — its Electron binaries keep an ad hoc signature
//   and Gatekeeper calls the download damaged.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const checks = require("./mac-release-checks.cjs");

function codesignDetails(file) {
  const shown = spawnSync("codesign", ["-dv", "--verbose=4", file], { encoding: "utf8" });
  if (shown.status !== 0) throw new Error(`Cannot read the signature of ${file}: ${(shown.stderr || "").trim()}`);
  return checks.parseCodesignDetails(shown.stderr);
}

/** Every regular Mach-O file in the bundle, symlinks not followed (as check-swarm-macho-arch.js). */
function machOFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) machOFiles(full, found);
    else if (entry.isFile()) {
      const kind = spawnSync("file", ["-b", full], { encoding: "utf8" }).stdout || "";
      if (/Mach-O/.test(kind)) found.push({ file: full, executable: /executable/.test(kind) });
    }
  }
  return found;
}

function plistValue(plist, key) {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8" }).trim();
}

module.exports = async function verifyMacSignedApp(context) {
  if (context.electronPlatformName !== "darwin") throw new Error("Expected a macOS app");
  const buildProfile = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/buildProfile.json"), "utf8"));
  const identity = buildProfile.profiles[buildProfile.profile];
  const app = path.join(context.appOutDir, `${identity.executableName}.app`);
  const resources = path.join(app, "Contents/Resources");

  const infoPlist = path.join(app, "Contents/Info.plist");
  const plist = {};
  for (const key of ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleExecutable"]) plist[key] = plistValue(infoPlist, key);
  const asar = require("@electron/asar");
  const packaged = JSON.parse(asar.extractFile(path.join(resources, "app.asar"), "package.json").toString("utf8"));
  const identityProblems = checks.packagedIdentityProblems({ plist, packaged, identity, profile: buildProfile.profile });
  if (identityProblems.length > 0) {
    throw new Error(`The packaged app is not ${identity.productName} ${identity.version} (${buildProfile.profile}):\n- ${identityProblems.join("\n- ")}`);
  }

  const nym = path.join(resources, "nym-proxy");
  if (!fs.existsSync(nym)) throw new Error("The pinned Nym helper was not packaged");
  const unpacked = path.join(resources, "app.asar.unpacked");
  if (!fs.existsSync(path.join(unpacked, "build/native.node"))) throw new Error("The SWARM Rust native addon was not packaged");

  const outer = codesignDetails(app);
  const outerProblems = checks.signatureProblems(outer, { team: null, executable: true });
  if (outer.identifier !== identity.appId) outerProblems.push(`identifier ${outer.identifier}, not ${identity.appId}`);
  if (outerProblems.length > 0) throw new Error(`The app is not Developer ID signed for distribution: ${outerProblems.join("; ")}`);

  const files = machOFiles(app);
  for (const required of [nym, path.join(unpacked, "build/native.node")]) {
    if (!files.some((entry) => entry.file === required)) throw new Error(`${required} is not a Mach-O file`);
  }
  // The binaries SWARM adds sit loose in Resources, where the bundle's
  // --deep verification seals them as data rather than checking them as code,
  // so each is verified on its own as well (as it has been since the signed
  // 0.1.0-testnet.7). Everything else is nested code that the --deep check
  // below verifies; for all of them the signature must be distribution-grade.
  const standalone = (file) => file === nym || file.endsWith(".node");
  const unsigned = [];
  for (const { file, executable } of files) {
    const problems = [];
    if (standalone(file)) {
      const verified = spawnSync("codesign", ["--verify", "--strict", "--verbose=2", file], { encoding: "utf8" });
      if (verified.status !== 0) problems.push(`does not verify: ${(verified.stderr || "").trim()}`);
    }
    problems.push(...checks.signatureProblems(codesignDetails(file), { team: outer.teamIdentifier, executable }));
    if (problems.length > 0) unsigned.push(`${path.relative(app, file)}: ${problems.join("; ")}`);
  }
  if (unsigned.length > 0) {
    throw new Error(`${unsigned.length} of ${files.length} Mach-O files are not signed for distribution:\n- ${unsigned.join("\n- ")}`);
  }

  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
  const addons = files.filter((entry) => entry.file.endsWith(".node")).length;
  const executables = files.filter((entry) => entry.executable).length;
  console.log(
    `Verified ${identity.productName} ${identity.version} (${buildProfile.profile}): all ${files.length} Mach-O files ` +
      `(${executables} executables with the hardened runtime, ${addons} native addons, the Nym helper) carry ` +
      `Developer ID signatures of team ${outer.teamIdentifier} with secure timestamps`,
  );
};
