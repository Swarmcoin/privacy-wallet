// Signs, notarizes and packages the wallet for direct download on the owner's
// Apple-silicon Mac. Run it after the pinned SDK, native module, Nym helper and
// frontend have been built exactly as docs/MAC-DISTRIBUTION.md lists (the same
// steps and pins as .github/workflows/swarm-wallet-unix.yml):
//
//   APPLE_KEYCHAIN_PROFILE=SWARM-notary node scripts/build-mac-distribution.js [--arch x64]
//     [--profile <network profile>] [--resume] [--skip-smoke]
//
// The network is the one scripts/set-build-profile.js selected in
// src/buildProfile.json; SWARM_NETWORK_PROFILE or --profile, when given, must
// agree with it. Developer ID is selected from Keychain, and notarization uses
// a stored notarytool Keychain profile. No credentials or recovery material
// belong in this repo or command line.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const developerIdIdentity = require('./mac-distribution-identity.cjs');
const checks = require('./mac-release-checks.cjs');

const root = path.resolve(__dirname, '..');
function option(name) {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}
const arch = option('--arch') || 'arm64';
if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported Mac architecture: ${arch}`);
const requestedProfile = option('--profile') || process.env.SWARM_NETWORK_PROFILE || null;
const output = path.join(root, arch === 'x64' ? 'dist-mac-signed-x64' : 'dist-mac-signed');
const buildProfile = JSON.parse(fs.readFileSync(path.join(root, 'src/buildProfile.json'), 'utf8'));
const identity = buildProfile.profiles[buildProfile.profile];
if (!identity) throw new Error(`src/buildProfile.json selects '${buildProfile.profile}', which it does not describe`);
const version = identity.version;
const notaryProfile = process.env.APPLE_KEYCHAIN_PROFILE;
const resume = process.argv.includes('--resume');
const app = path.join(output, arch === 'x64' ? 'mac' : 'mac-arm64', `${identity.executableName}.app`);
// Named per platform: the plain `SWARM-Wallet-<version>-x64.zip` is the Windows
// portable zip's name, and both land on the same release.
const names = checks.releaseFileNames(version, arch);
const dmg = path.join(output, names.dmg);
const zip = path.join(output, names.zip);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function refuse(title, problems) {
  if (problems.length > 0) throw new Error(`${title}:\n- ${problems.join('\n- ')}`);
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build on an Apple-silicon Mac with native arm64 Node.js');
if (process.versions.node.split('.')[0] !== '24') throw new Error('Use Node.js 24 for the wallet');
if (!version) throw new Error('Cannot read the SWARM version from src/buildProfile.json');
if (!notaryProfile) throw new Error('Set APPLE_KEYCHAIN_PROFILE to an owner-configured notarytool profile name');
for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
  if (process.env[key]) throw new Error(`Unset ${key}; notarization must use the Keychain profile`);
}
// electron-builder would sign from a temporary keychain holding this file's
// identity instead, and fall back to an ad hoc signature on arm64 if the
// configured identity is not in it.
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD']) {
  if (process.env[key]) throw new Error(`Unset ${key}; the Developer ID identity must come from the login Keychain`);
}
developerIdIdentity();

// HEAD must describe the built source. The one change the build itself makes —
// scripts/set-build-profile.js selecting the network — is accepted exactly as
// that script writes it, and recorded in the manifest.
const source = checks.inspectSourceTree(root, requestedProfile);
refuse('Refusing to sign this source tree', source.problems);
console.log(`Source: ${checks.describeSourceTree(source)}.`);
console.log(`Building ${identity.productName} ${version} (${source.profile}, app id ${identity.appId}) for ${arch}.`);

try {
  run('xcrun', ['notarytool', 'history', '--keychain-profile', notaryProfile, '--output-format', 'json'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
} catch {
  throw new Error(`Cannot use notarytool Keychain profile ${notaryProfile}; configure it locally before building`);
}
if (resume) {
  for (const file of [app, dmg, zip]) {
    if (!fs.existsSync(file)) throw new Error(`Cannot resume without generated output: ${file}`);
  }
  if (fs.existsSync(path.join(output, 'out'))) throw new Error('Signed release output already finalized');
} else if (fs.existsSync(output)) {
  throw new Error(`${output} exists; archive or remove previous generated output before rebuilding`);
}
for (const file of ['build/electron.js', 'build/index.html', 'build/native.node', 'resources/nym-proxy', 'sdk-source/LICENSE']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing build prerequisite: ${file}`);
}
const mtime = (file) => fs.statSync(path.join(root, file)).mtimeMs;
refuse('The frontend does not match the selected network', checks.frontendProblems({
  profileMtimeMs: mtime('src/buildProfile.json'),
  frontendMtimeMs: mtime('build/index.html'),
}));
// Cheaper to find a native module left over from the other architecture here
// than after electron-builder has had the app notarized.
const lipoArchs = (file) => {
  try {
    return run('lipo', ['-archs', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
};
refuse(`The prebuilt binaries are not all ${arch}`, checks.architectureProblems(arch === 'x64' ? 'x86_64' : 'arm64', {
  'build/native.node': lipoArchs('build/native.node'),
  'resources/nym-proxy': lipoArchs('resources/nym-proxy'),
}));

run('node', ['scripts/check-swarm-sdk-pin.js', 'sdk-source', '--require-real-genesis']);
if (!resume) run('yarn', ['electron-builder', '--mac', `--${arch}`, '--config', 'configs/swarm-mac-developer-id.cjs', '--publish', 'never'],
  { env: { ...process.env, SWARM_MAC_ARCH: arch } });
run('node', ['scripts/check-swarm-macho-arch.js', `mac-${arch}`, output]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
run('xcrun', ['stapler', 'validate', app]);
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
if (!process.argv.includes('--skip-smoke')) {
  run('node', ['scripts/swarm-smoke.js', 'mac'], { env: { ...process.env, SWARM_DIST: output } });
}

// electron-builder notarizes/staples the app before writing this DMG. Submit
// the final DMG as well, then staple its own ticket and rebuild the ZIP.
const result = JSON.parse(run('xcrun', [
  'notarytool', 'submit', dmg, '--keychain-profile', notaryProfile,
  '--wait', '--output-format', 'json',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
if (result.status !== 'Accepted' || !/^[a-f0-9-]{36}$/i.test(result.id || '')) {
  throw new Error(`DMG notarization did not reach Accepted: ${JSON.stringify({ id: result.id, status: result.status })}`);
}
console.log(`DMG notarization accepted: ${result.id}`);
run('xcrun', ['stapler', 'staple', dmg]);
run('xcrun', ['stapler', 'validate', dmg]);
fs.rmSync(zip, { force: true });
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);

// The tree must still be the one the manifest is about to name.
const after = checks.inspectSourceTree(root, requestedProfile);
if (!after.ok || after.commit !== source.commit || after.buildProfileSha256 !== source.buildProfileSha256) {
  refuse('The source tree changed while this release was being built; nothing was finalized',
    after.problems.length > 0 ? after.problems : [`now ${checks.describeSourceTree(after)}`]);
}

const out = path.join(output, 'out');
fs.mkdirSync(out);
for (const file of [dmg, zip]) fs.copyFileSync(file, path.join(out, path.basename(file)));
const packaged = [names.dmg, names.zip].sort();
const checksums = packaged.map((name) => `${sha(path.join(out, name))} *${name}`).join('\n') + '\n';
fs.writeFileSync(path.join(out, names.checksums), checksums);
const binaries = {
  nym_proxy_sha256: sha(path.join(app, 'Contents/Resources/nym-proxy')),
  native_addon_sha256: sha(path.join(app, 'Contents/Resources/app.asar.unpacked/build/native.node')),
};
const manifest = {
  product: identity.productName,
  version,
  app_id: identity.appId,
  network_profile: source.profile,
  platform: `darwin-${arch}`,
  signed: true,
  notarized: true,
  notary_submission_id: result.id,
  source_commit: source.commit,
  source_tree: checks.describeSourceTree(source),
  build_profile_sha256: source.buildProfileSha256,
  sdk_commit: run('git', ['-C', 'sdk-source', 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim(),
  binaries,
  files: packaged.map((name) => ({ name, bytes: fs.statSync(path.join(out, name)).size, sha256: sha(path.join(out, name)) })),
};
fs.writeFileSync(path.join(out, names.manifest), JSON.stringify(manifest, null, 2) + '\n');
console.log(checksums);
console.log(`Signed artifacts, ${names.checksums} and ${names.manifest}: ${out}`);
