"use strict";

// The SWARM-specific config is the source of truth for app ID, version,
// artwork, licences and storage. Only the direct-download Mac signing path is
// overridden here; the generic upstream/MAS configuration is never used.
// Used only by scripts/build-mac-distribution.js (docs/MAC-DISTRIBUTION.md).
const base = require("./swarm-builder.cjs");
const developerIdIdentity = require("../scripts/mac-distribution-identity.cjs");
const arch = process.env.SWARM_MAC_ARCH || "arm64";
if (!["arm64", "x64"].includes(arch)) throw new Error(`Unsupported SWARM_MAC_ARCH: ${arch}`);

// Named per platform, as scripts/mac-release-checks.cjs releaseFileNames()
// expects: the plain `SWARM-Wallet-<version>-x64.zip` of the base config is the
// Windows portable zip's name, and both land on the same release.
const artifactName = "SWARM-Wallet-${version}-mac-${arch}.${ext}";

module.exports = {
  ...base,
  directories: { ...base.directories, output: arch === "x64" ? "dist-mac-signed-x64" : "dist-mac-signed" },
  // Without this, electron-builder answers an identity it cannot find by
  // signing an arm64 app ad hoc and carrying on — the signature Gatekeeper
  // reports as "damaged". A distribution build must stop instead.
  forceCodeSigning: true,
  afterSign: "./scripts/verify-mac-signed-app.cjs",
  mac: {
    ...base.mac,
    artifactName,
    target: [{ target: "dmg", arch: [arch] }, { target: "zip", arch: [arch] }],
    // electron-builder selects the Developer ID certificate type itself and
    // rejects the "Developer ID Application:" prefix in an explicit identity.
    identity: developerIdIdentity().replace(/^Developer ID Application:\s*/, ""),
    hardenedRuntime: true,
    gatekeeperAssess: true,
    entitlements: "./configs/entitlements.swarm-mac.plist",
    entitlementsInherit: "./configs/entitlements.swarm-mac.plist",
    // @electron/osx-sign already signs every binary file it finds in the
    // bundle (native.node, keytar.node, the Electron frameworks and helpers);
    // the helper is named as well so it can never be skipped. The afterSign
    // hook checks every Mach-O in the bundle, not just these.
    binaries: ["Contents/Resources/nym-proxy"],
    notarize: true,
  },
  dmg: { ...base.dmg, artifactName },
};
