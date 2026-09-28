#!/usr/bin/env node
// Holds the built SWARM Wallet .deb to its own install path.
//
// Up to 0.1.0-mainnet.7 the .deb shipped an AppArmor profile that named the
// testnet build's binary, "/opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet",
// in the mainnet package too, whose binary is "/opt/SWARM Wallet/SWARM
// Wallet". A profile for a path that does not exist attaches to nothing, and
// on Ubuntu 24.04+ and Debian 13+ Chromium's zygote then dies at launch. No
// check read the package, and there is no Linux desktop here to find it on.
//
// So this reads the package the way dpkg will: `dpkg-deb -c` for what it
// installs, `dpkg-deb -e` for its maintainer scripts, and the profile out of
// the data archive, and refuses the build when
//   - the binary is not where the build profile says it is,
//   - the AppArmor profile names any path but that binary,
//   - a maintainer script names an /opt path the package does not install,
//     or still carries upstream's Zingo PC paths or an unfilled macro.
//
// The checks themselves are pure functions over text, exported for
// src/debPackage.test.ts, which runs them on every platform.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/** electron-builder's own rule for the /opt directory name (builder-util). */
function sanitizeFileName(name) {
  try {
    // eslint-disable-next-line global-require
    return require("builder-util/out/filename").sanitizeFileName(name);
  } catch {
    return name.replace(/[/\\?%*:|"<>]/g, "-");
  }
}

/** Where a build with this identity installs, as electron-builder lays it out. */
function expectedLayout(identity) {
  const appDir = `/opt/${sanitizeFileName(identity.productName)}`;
  return { appDir, binary: `${appDir}/${identity.executableName}` };
}

/** The paths `dpkg-deb -c` lists, absolute, directories without a trailing slash. */
function parseListing(text) {
  const paths = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\S)\S*\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    let entry = m[2];
    if (m[1] === "l") entry = entry.replace(/ -> .*$/, "");
    entry = entry.replace(/^\.\//, "/").replace(/\/$/, "");
    if (entry) paths.add(entry);
  }
  return paths;
}

/** The binary an AppArmor profile attaches to: `profile <name> <path> …{`. */
function profileTarget(profileText) {
  const m = /^\s*profile\s+(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|(\S+))/m.exec(String(profileText));
  return m ? m[1] || m[2] : null;
}

/**
 * What electron-builder does to a template (FpmTarget `writeConfigFile`):
 * every `${letters}` is replaced, and an unknown one is an error. Used by the
 * test to render the templates in this repository exactly as a build would.
 */
function renderTemplate(text, options) {
  return String(text).replace(/\${([a-zA-Z]+)}/g, (match, name) => {
    if (!(name in options)) throw new Error(`Macro ${name} is not defined`);
    return options[name];
  });
}

/** Every problem with a package, in sentences; empty when it is right. */
function checkDeb({ identity, listing, postinst, postrm, profile }) {
  const problems = [];
  const { appDir, binary } = expectedLayout(identity);
  if (!listing.has(binary)) {
    problems.push(`the package does not install ${binary}, where the build profile puts the binary`);
  }
  if (profile == null) {
    problems.push(`the package ships no AppArmor profile at ${appDir}/resources/apparmor-profile`);
  } else {
    const target = profileTarget(profile);
    if (target !== binary) {
      problems.push(`the AppArmor profile attaches to ${JSON.stringify(target)}, not to the binary ${binary}`);
    }
  }
  for (const [name, script] of [
    ["postinst", postinst],
    ["postrm", postrm],
  ]) {
    if (script == null) {
      problems.push(`the package has no ${name}`);
      continue;
    }
    if (/\$\{[a-zA-Z]+\}/.test(script)) problems.push(`${name} still carries an unfilled macro`);
    if (/zingo/i.test(script)) problems.push(`${name} still names upstream's Zingo PC paths`);
    for (const [, literal] of script.matchAll(/'(\/opt\/[^']*)'/g)) {
      if (!listing.has(literal)) problems.push(`${name} names ${literal}, which the package does not install`);
    }
  }
  if (postinst != null && !postinst.includes(`BINARY='${binary}'`)) {
    problems.push(`postinst does not name this build's binary, ${binary}`);
  }
  return problems;
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: options.encoding ?? "utf8", maxBuffer: 1 << 30, ...options });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.error}`);
  return r.stdout;
}

function main() {
  const buildProfile = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "buildProfile.json"), "utf8"));
  const identity = buildProfile.profiles[buildProfile.profile];
  const dist = path.join(__dirname, "..", "dist");
  const debs = fs.readdirSync(dist).filter((f) => f.endsWith(".deb"));
  if (debs.length !== 1) throw new Error(`expected one .deb in dist, found ${JSON.stringify(debs)}`);
  const deb = path.join(dist, debs[0]);
  const { appDir, binary } = expectedLayout(identity);

  const listing = parseListing(run("dpkg-deb", ["-c", deb]));
  const control = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-deb-control-"));
  run("dpkg-deb", ["-e", deb, control]);
  const read = (name) =>
    fs.existsSync(path.join(control, name)) ? fs.readFileSync(path.join(control, name), "utf8") : null;
  const postinst = read("postinst");
  const postrm = read("postrm");
  for (const name of ["postinst", "postrm"]) {
    if (read(name) != null) run("bash", ["-n", path.join(control, name)]);
  }
  const tar = spawnSync("dpkg-deb", ["--fsys-tarfile", deb], { maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`dpkg-deb --fsys-tarfile failed: ${tar.stderr}`);
  const member = `.${appDir}/resources/apparmor-profile`;
  const extracted = spawnSync("tar", ["-xO", "-f", "-", member], {
    input: tar.stdout,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  const profile = extracted.status === 0 ? extracted.stdout : null;

  console.log(`package   ${debs[0]}`);
  console.log(`binary    ${binary} ${listing.has(binary) ? "(installed)" : "(MISSING)"}`);
  console.log(`profile   ${profile == null ? "(none)" : `attaches to ${profileTarget(profile)}`}`);
  console.log(
    `postinst  /opt paths: ${JSON.stringify([...(postinst ?? "").matchAll(/'(\/opt\/[^']*)'/g)].map((m) => m[1]))}`,
  );
  console.log(
    `postrm    /opt paths: ${JSON.stringify([...(postrm ?? "").matchAll(/'(\/opt\/[^']*)'/g)].map((m) => m[1]))}`,
  );

  const problems = checkDeb({ identity, listing, postinst, postrm, profile });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`REFUSED: ${problem}`);
    process.exit(1);
  }
  console.log("The .deb installs its AppArmor profile and maintainer scripts for its own binary.");
}

module.exports = { checkDeb, expectedLayout, parseListing, profileTarget, renderTemplate, sanitizeFileName };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error && error.stack ? error.stack : error));
    process.exit(1);
  }
}
