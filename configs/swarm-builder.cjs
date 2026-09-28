const upstream = require("../package.json").build;
const buildProfile = require("../src/buildProfile.json");

// Packaging for the SWARM wallet: unsigned, portable builds for Windows, Linux
// and macOS. It changes identity, artwork and what the installer touches —
// never behaviour.
//
// PROFILE-AWARE, since 2026-09-26. Everything below that names the product used
// to be a literal: "SWARM Wallet (Testnet)", app id `green.swarm.wallet.testnet`,
// version read out of src/version.ts. So the first mainnet build — which
// carried the real mainnet genesis — installed as "SWARM Wallet (Testnet)"
// 0.1.0-testnet.9 and nobody could tell from the machine which network they
// had. The identity now comes from src/buildProfile.json, the one file
// `scripts/set-build-profile.js` writes from the workflows' `network_profile`
// input, and the renderer reads the same record for the About box.
//
// THE APP IDS ARE DELIBERATELY DIFFERENT. `green.swarm.wallet.testnet` and
// `green.swarm.wallet` are two applications to Windows, macOS and Linux alike:
// the mainnet wallet installs BESIDE an existing testnet one, gets its own
// uninstall entry, its own shortcut and its own keychain entry, and neither
// upgrade path touches the other. That is intended. A single id would have made
// the mainnet installer silently replace a testnet install whose wallet files
// it cannot open.
//
// `productName` carries whatever parentheses the profile gives it;
// `executableName` never does, so the file on disk, the process name the
// launcher looks for and the window's own title stay easy to quote.
//
// The icons are the style guide's hive bee, rendered by
// scripts/make-swarm-icon.js. Changing the mark means re-running that script.
//
// Nothing here registers a `zcash:` handler on any platform. This is not a
// wallet for the public Zcash network and must not become the machine's
// default for its payment links.

const PROFILE_ID = buildProfile.profile;
const IDENTITY = buildProfile.profiles[PROFILE_ID];
if (!IDENTITY) {
  throw new Error(
    `src/buildProfile.json selects '${PROFILE_ID}', which it does not describe. ` +
      `On offer: ${Object.keys(buildProfile.profiles).join(", ")}.`,
  );
}

const PRODUCT = IDENTITY.productName;
const EXECUTABLE = IDENTITY.executableName;
// The version every artifact is named after, read from the single place the
// application already states it — the same record the About box shows.
// package.json still carries upstream's 2.0.26, which is how the first packages
// came out named "2.0.26", a number that says nothing about which SWARM build
// someone downloaded.
const VERSION = IDENTITY.version;

// Both MIT licences travel with every binary. The SDK's comes from the
// pinned-revision checkout the workflow makes for scripts/check-swarm-sdk-pin.js,
// so the text shipped is the text of the revision that was compiled.
const licences = [
  { from: "LICENSE", to: "licenses/Zingo-PC-LICENSE.txt" },
  { from: "sdk-source/LICENSE", to: "licenses/Zingolib-LICENSE.txt" },
];

// The treasury fund policies, staged read-only beside the binary.
//
// They are data the build carries, not data it fetches: a policy decides
// where a fund's money may go, and a policy the running application could be
// talked into replacing would be no policy at all. The Treasury page puts
// every one of them through the addon's `treasury_policy_verify`, which
// recomputes the redeem script, the script hash, the address and the
// fingerprint — so a file edited after packaging is refused on the machine
// that reads it rather than believed.
//
// Shipped on every platform, including the ones where the page is hidden:
// what decides whether the page appears is the build profile, and a build
// that carried the policies only sometimes would make "the page is missing"
// and "the policies are missing" into the same symptom.
const treasuryPolicies = [{ from: "resources/treasury", to: "treasury" }];

module.exports = {
  ...upstream,
  productName: PRODUCT,
  executableName: EXECUTABLE,
  appId: IDENTITY.appId,
  artifactName: "SWARM-Wallet-${version}-${arch}.${ext}",
  extraMetadata: {
    version: VERSION,
    main: "build/electron.js",
    name: IDENTITY.packageName,
    productName: PRODUCT,
    description: IDENTITY.description,
    // Which SWARM network this package is for, inside the package. The main
    // process reads it before any renderer module exists, to decide where a
    // fresh profile starts (public/electron.js, SWARM_BUILD_CHAIN).
    swarmNetworkProfile: PROFILE_ID,
  },
  // This is the unsigned integration baseline. The separate
  // swarm-mac-developer-id.cjs config enables direct-download Mac signing and
  // notarization after the pinned native components have been built.
  afterSign: null,
  afterAllArtifactBuild: null,
  win: {
    ...upstream.win,
    icon: "./resources/swarm/icon.ico",
    target: ["zip", "nsis"],
    azureSignOptions: null,
    // True so electron-builder rewrites the executable's version resource —
    // without it the file's Properties dialog keeps Electron's own
    // ProductName and FileDescription. Editing the resource is rcedit's job
    // and pulls in no signing: `signExts: []` and the null Azure options are
    // what keep the signing pipeline out, and CSC_IDENTITY_AUTO_DISCOVERY is
    // false in the workflow.
    signAndEditExecutable: true,
    signExts: [],
    protocols: [],
    extraResources: [...upstream.win.extraResources, ...licences, ...treasuryPolicies],
  },
  // A single file a person double-clicks. The portable zip stays — it is
  // what someone who will not run an unsigned installer can still inspect
  // and unpack — but unzipping eighty files of Chromium runtime and being
  // asked to find the right .exe among them is not an installation.
  //
  // Per-user, so there is no administrator prompt on top of the SmartScreen
  // one; no directory chooser, because oneClick means there are no
  // questions; and the wallet is left alone on uninstall, because the
  // application is replaceable and the coins are not.
  nsis: {
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: PRODUCT,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    artifactName: "SWARM-Wallet-${version}-win-x64-setup.${ext}",
  },
  linux: {
    ...upstream.linux,
    icon: "./resources/swarm/icons",
    target: ["AppImage", "deb"],
    category: "Office;Finance",
    // Upstream ships a polkit policy, an AppArmor profile and a `zcash:` URI
    // wrapper, all named and pathed for Zingo PC. The policy is ours; the
    // AppArmor profile is generated for this build's own install path by
    // electron-builder (`deb.appArmorProfile` below) — a copy would match
    // nothing and the crashes it prevents on Ubuntu 24.04+ would come back.
    // The wrapper is dropped with the protocol handler.
    extraResources: [
      { from: "resources/nym-proxy", to: "nym-proxy" },
      { from: "resources/swarm/linux/green.swarm.wallet.policy", to: "green.swarm.wallet.policy" },
      ...licences,
      ...treasuryPolicies,
    ],
    mimeTypes: [],
    desktop: {
      entry: {
        Name: PRODUCT,
        Comment: IDENTITY.description,
        GenericName: "Wallet",
        Type: "Application",
        StartupNotify: true,
        Categories: "Office;Finance;",
        Keywords: `swarm;wallet;${IDENTITY.artifactSuffix};`,
      },
    },
  },
  deb: {
    ...upstream.deb,
    // All three are templates electron-builder fills in with this build's
    // install directory and executable when it packages the .deb, so the
    // mainnet and the testnet package each name their own binary. The
    // profile ships as resources/apparmor-profile. Until 0.1.0-mainnet.8 the
    // profile was a static extraResource naming the testnet's binary, which
    // on the mainnet package matched nothing. scripts/check-swarm-deb.js
    // holds the built .deb to it in CI.
    appArmorProfile: "resources/swarm/linux/apparmor/swarm-wallet",
    afterInstall: "scripts/swarm-deb-postinstall.sh",
    afterRemove: "scripts/swarm-deb-postremove.sh",
    artifactName: "SWARM-Wallet-${version}-${arch}.${ext}",
  },
  appImage: {
    ...upstream.appImage,
    artifactName: "SWARM-Wallet-${version}-${arch}.${ext}",
  },
  mac: {
    ...upstream.mac,
    // electron-builder converts this to an icns on the runner, which is the
    // only place the conversion tooling exists.
    icon: "./resources/swarm/icon-1024.png",
    target: ["dmg", "zip"],
    // Unsigned local/CI test build. `identity: null` stops electron-builder
    // from silently selecting a development identity for this baseline.
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    entitlements: null,
    entitlementsInherit: null,
    protocols: [],
    extendInfo: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "SWARM Wallet uses the camera only to read payment QR codes. Images are processed on this device and never stored or sent.",
    },
    extraResources: [{ from: "resources/nym-proxy", to: "nym-proxy" }, ...licences, ...treasuryPolicies],
  },
  dmg: {
    ...upstream.dmg,
    artifactName: "SWARM-Wallet-${version}-${arch}.${ext}",
  },
  // The App Store target has no meaning without an Apple account, and leaving
  // it configured invites an accidental `--mas` build that fails late.
  mas: undefined,
};
