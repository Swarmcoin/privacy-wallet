"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");
const { makeUniversalApp } = require("@electron/universal");
const { signAsync } = require("@electron/osx-sign");
const developerId = require("./mac-distribution-identity.cjs");
const checks = require("./mac-release-checks.cjs");
const verifySignedApp = require("./verify-mac-signed-app.cjs");

const root = path.resolve(__dirname, "..");
const argument = (name) => {
  const position = process.argv.indexOf(name);
  if (position < 0 || !process.argv[position + 1]) throw new Error(`Required argument: ${name}`);
  return process.argv[position + 1];
};
const command = (name, args, options = {}) => execFileSync(name, args, { cwd: root, stdio: "inherit", ...options });
const readCommand = (name, args) => command(name, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, contents) => fs.writeFileSync(file, JSON.stringify(contents, undefined, 2) + "\n");

async function main() {
  if (process.platform !== "darwin") throw new Error("A Mac is required to build the universal release.");
  const profile = process.env.APPLE_KEYCHAIN_PROFILE;
  if (!profile) throw new Error("Set APPLE_KEYCHAIN_PROFILE to the local notarization profile.");
  const source = argument("--source");
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error("The app source must be a full commit SHA.");
  const out = path.resolve(argument("--out"));
  if (fs.existsSync(out)) throw new Error(`Choose a fresh output directory: ${out}`);
  const identity = developerId();
  readCommand("xcrun", ["notarytool", "history", "--keychain-profile", profile, "--output-format", "json"]);
  const sourceFile = (file) => command("git", ["show", `${source}:${file}`], { stdio: ["ignore", "pipe", "pipe"] });
  const buildProfile = JSON.parse(sourceFile("src/buildProfile.json").toString());
  const network = "swarm-mainnet";
  const product = buildProfile.profiles[network];
  const sdk = JSON.parse(sourceFile("sdk/swarm-sdk-pin.json").toString());
  const inputs = [];
  for (const arch of ["arm64", "x64"]) {
    const directory = path.resolve(argument(`--${arch}`));
    const recordedSource = fs.readFileSync(path.join(directory, "source-commit.txt"), "utf8").trim();
    if (recordedSource !== source) throw new Error(`${arch}: the source commit differs.`);
    const expectedProfile = checks.generatedBuildProfile(sourceFile("src/buildProfile.json").toString(), network);
    if (fs.readFileSync(path.join(directory, "build-profile.json"), "utf8") !== expectedProfile) {
      throw new Error(`${arch}: the build profile differs from the selected mainnet source.`);
    }
    if (!fs.readFileSync(path.join(directory, "Cargo.lock")).equals(sourceFile("native/Cargo.lock"))) {
      throw new Error(`${arch}: the native dependency lockfile differs.`);
    }
    const integration = json(path.join(directory, "sdk-integration.json"));
    if (integration.commit !== sdk.commit || integration.mainnet.genesis !== sdk.mainnet.genesis) {
      throw new Error(`${arch}: the SDK or mainnet genesis differs.`);
    }
    const name = `SWARM-Wallet-${product.version}-${arch}.zip`;
    const archive = path.join(directory, name);
    const checksum = sha256(archive);
    const checksumLine = fs.readFileSync(path.join(directory, "SHA256SUMS"), "utf8")
      .split(/\r?\n/).find((line) => line.trim().endsWith(name));
    if (!checksumLine || checksumLine.split(/\s+/)[0] !== checksum) throw new Error(`${arch}: the ZIP checksum differs.`);
    inputs.push({ arch, archive, sha256: checksum, bytes: fs.statSync(archive).size });
  }

  fs.mkdirSync(out, { recursive: true });
  writeJson(path.join(out, "inputs.json"), { source, network, inputs });
  const apps = {};
  for (const input of inputs) {
    const directory = path.join(out, `input-${input.arch}`);
    command("ditto", ["-x", "-k", input.archive, directory]);
    const app = path.join(directory, `${product.executableName}.app`);
    const resources = path.join(app, "Contents/Resources");
    const packaged = JSON.parse(asar.extractFile(path.join(resources, "app.asar"), "package.json").toString());
    const plist = {};
    for (const key of ["CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleExecutable"]) {
      plist[key] = readCommand("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents/Info.plist")]);
    }
    const problems = checks.packagedIdentityProblems({ plist, packaged, identity: product, profile: network });
    if (problems.length) throw new Error(`${input.arch}: ${problems.join(", ")}`);
    command(process.execPath, ["scripts/check-swarm-macho-arch.js", `mac-${input.arch}`, directory]);
    apps[input.arch] = app;
  }

  const app = path.join(out, `${product.executableName}.app`);
  console.log("Merging the Intel and Apple silicon apps.");
  await makeUniversalApp({ x64AppPath: apps.x64, arm64AppPath: apps.arm64, outAppPath: app, mergeASARs: true });
  const merged = path.join(out, "universal");
  fs.mkdirSync(merged);
  fs.renameSync(app, path.join(merged, path.basename(app)));
  const universalApp = path.join(merged, path.basename(app));
  for (const arch of ["arm64", "x64"]) command(process.execPath, ["scripts/check-swarm-macho-arch.js", `mac-${arch}`, merged]);

  console.log("Signing the universal app with Developer ID.");
  await signAsync({
    app: universalApp,
    platform: "darwin",
    type: "distribution",
    identity,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    binaries: [path.join(universalApp, "Contents/Resources/nym-proxy")],
    optionsForFile: () => ({ entitlements: path.join(root, "configs/entitlements.swarm-mac.plist"), hardenedRuntime: true }),
  });
  await verifySignedApp({ electronPlatformName: "darwin", appOutDir: merged, swarmNetworkProfile: network });

  const notarize = (file, label) => {
    console.log(`Submitting ${label} to Apple.`);
    const submission = JSON.parse(readCommand("xcrun", ["notarytool", "submit", file, "--keychain-profile", profile, "--wait", "--output-format", "json"]));
    writeJson(path.join(out, `${label}-notary.json`), submission);
    if (submission.status !== "Accepted") throw new Error(`${label}: Apple notarization status is ${submission.status} (${submission.id}).`);
    return submission.id;
  };
  const appZip = path.join(out, "notary-app.zip");
  command("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", universalApp, appZip]);
  const appSubmission = notarize(appZip, "app");
  command("xcrun", ["stapler", "staple", universalApp]);
  command("xcrun", ["stapler", "validate", universalApp]);
  command("spctl", ["--assess", "--type", "execute", "--verbose=4", universalApp]);

  const stage = path.join(out, "dmg-stage");
  fs.mkdirSync(stage);
  command("ditto", [universalApp, path.join(stage, path.basename(universalApp))]);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  const artifacts = path.join(out, "out");
  fs.mkdirSync(artifacts);
  const stem = `SWARM-Wallet-${product.version}-mac-universal`;
  const dmg = path.join(artifacts, `${stem}.dmg`);
  const zip = path.join(artifacts, `${stem}.zip`);
  const writableDmg = path.join(out, "staging.dmg");
  command("hdiutil", ["create", "-volname", product.productName, "-srcfolder", stage, "-fs", "APFS", "-format", "UDRW", writableDmg]);
  command("hdiutil", ["convert", writableDmg, "-format", "UDZO", "-o", dmg]);
  command("codesign", ["--sign", identity, "--timestamp", dmg]);
  const dmgSubmission = notarize(dmg, "dmg");
  command("xcrun", ["stapler", "staple", dmg]);
  command("xcrun", ["stapler", "validate", dmg]);
  command("hdiutil", ["verify", dmg]);
  command("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", universalApp, zip]);
  const files = [dmg, zip].map((file) => ({ name: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256(file) }));
  fs.writeFileSync(path.join(artifacts, "SHA256SUMS-mac-universal"), files.map((file) => `${file.sha256}  ${file.name}\n`).join(""));
  writeJson(path.join(artifacts, "release-manifest-mac-universal.json"), {
    product: product.productName, version: product.version, app_id: product.appId,
    platform: "darwin-universal", architectures: ["arm64", "x86_64"], network,
    source_commit: source, assembly_commit: readCommand("git", ["rev-parse", "HEAD"]),
    sdk_commit: sdk.commit, genesis: sdk.mainnet.genesis,
    signed: true, notarized: true, app_notary_submission_id: appSubmission,
    notary_submission_id: dmgSubmission,
    inputs: inputs.map(({ arch, sha256, bytes }) => ({ arch, sha256, bytes })), files,
  });
  console.log(`Universal release artifacts: ${artifacts}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
