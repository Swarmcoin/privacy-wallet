/**
 * @jest-environment node
 */

/**
 * The Linux package names its own binary: AppArmor profile, postinst, postrm.
 *
 * Up to 0.1.0-mainnet.7 `resources/swarm/linux/apparmor/swarm-wallet` said
 * `profile swarm-wallet "/opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet"`
 * for both packages, and the postinstall copied it into /etc/apparmor.d. The
 * mainnet binary is /opt/SWARM Wallet/SWARM Wallet, so its profile attached to
 * nothing, and on Ubuntu 24.04+ and Debian 13+ Chromium's zygote dies at
 * launch without one.
 *
 * The three files are templates now, filled in by electron-builder per build.
 * These render them exactly as it does (`renderTemplate` is its
 * `writeConfigFile` rule, unknown macros included) for both build identities
 * and hold the result to where each package installs, with the same
 * `checkDeb` that `scripts/check-swarm-deb.js` runs on the built .deb in CI.
 */
import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const deb = require("../scripts/check-swarm-deb.js");

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const profiles = JSON.parse(read("src/buildProfile.json")).profiles as Record<
  string,
  { productName: string; executableName: string }
>;

/** What electron-builder hands the templates (FpmTarget `createScripts`). */
function templateOptions(identity: { productName: string; executableName: string }) {
  return {
    executable: identity.executableName,
    sanitizedProductName: deb.sanitizeFileName(identity.productName),
    productFilename: deb.sanitizeFileName(identity.executableName),
  };
}

/** What such a package installs, as `dpkg-deb -c` would list it. */
function listingFor(identity: { productName: string; executableName: string }): Set<string> {
  const { appDir, binary } = deb.expectedLayout(identity);
  return new Set([
    appDir,
    binary,
    `${appDir}/chrome-sandbox`,
    `${appDir}/resources`,
    `${appDir}/resources/apparmor-profile`,
    `${appDir}/resources/green.swarm.wallet.policy`,
  ]);
}

function rendered(identity: { productName: string; executableName: string }) {
  const options = templateOptions(identity);
  return {
    profile: deb.renderTemplate(read("resources/swarm/linux/apparmor/swarm-wallet"), options),
    postinst: deb.renderTemplate(read("scripts/swarm-deb-postinstall.sh"), options),
    postrm: deb.renderTemplate(read("scripts/swarm-deb-postremove.sh"), options),
  };
}

describe("the .deb's AppArmor profile and maintainer scripts", () => {
  it.each(Object.keys(profiles))("name the %s build's own binary", (id) => {
    const identity = profiles[id];
    const files = rendered(identity);
    const { binary } = deb.expectedLayout(identity);
    expect(deb.profileTarget(files.profile)).toBe(binary);
    expect(deb.checkDeb({ identity, listing: listingFor(identity), ...files })).toEqual([]);
  });

  it("puts the mainnet binary where a mainnet package installs it", () => {
    expect(deb.expectedLayout(profiles["swarm-mainnet"]).binary).toBe("/opt/SWARM Wallet/SWARM Wallet");
    expect(deb.expectedLayout(profiles["swarm-testnet"]).binary).toBe(
      "/opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet",
    );
  });

  it("gives the two packages different names outside /opt, so both can be installed", () => {
    const names = Object.values(profiles).map((identity) => {
      const { postinst } = rendered(identity);
      const exec = /printf '%s' '([^']+)'/.exec(postinst)?.[1] ?? "";
      return exec.replace(/ /g, "-").toLowerCase();
    });
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("swarm-wallet");
  });

  it("refuses the files mainnet.7 shipped, on a mainnet package", () => {
    const identity = profiles["swarm-mainnet"];
    const problems: string[] = deb.checkDeb({
      identity,
      listing: listingFor(identity),
      profile:
        'profile swarm-wallet "/opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet" flags=(unconfined) {\n  userns,\n}\n',
      postinst:
        "for candidate in '/opt/SWARM Wallet' '/opt/SWARM Wallet (Testnet)'; do\n  APP_DIR=\"$candidate\"\ndone\n",
      postrm: "rm -f '/usr/share/polkit-1/actions/green.swarm.wallet.policy'\n",
    });
    expect(problems.join("\n")).toMatch(/attaches to "\/opt\/SWARM Wallet \(Testnet\)\/SWARM Wallet Testnet"/);
    expect(problems.join("\n")).toMatch(
      /postinst names \/opt\/SWARM Wallet \(Testnet\), which the package does not install/,
    );
  });

  it("refuses upstream's Zingo PC scripts", () => {
    const identity = profiles["swarm-mainnet"];
    const problems: string[] = deb.checkDeb({
      identity,
      listing: listingFor(identity),
      ...rendered(identity),
      postinst: read("scripts/postinstall.sh"),
    });
    expect(problems.join("\n")).toMatch(/Zingo PC/);
  });

  it("reads a dpkg-deb listing with spaces, parentheses and links", () => {
    const listing = deb.parseListing(
      [
        "drwxr-xr-x root/root         0 2026-09-28 00:00 ./opt/SWARM Wallet (Testnet)/",
        "-rwxr-xr-x root/root 190000000 2026-09-28 00:00 ./opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet",
        "lrwxrwxrwx root/root         0 2026-09-28 00:00 ./usr/bin/x -> /opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet",
      ].join("\n"),
    );
    expect([...listing]).toEqual([
      "/opt/SWARM Wallet (Testnet)",
      "/opt/SWARM Wallet (Testnet)/SWARM Wallet Testnet",
      "/usr/bin/x",
    ]);
  });

  it("uses no macro electron-builder would refuse", () => {
    // `renderTemplate` throws on an unknown macro, as the packager does: a
    // shell variable written with braces around letters only would stop the
    // build at the packaging step, an hour in.
    for (const identity of Object.values(profiles)) expect(() => rendered(identity)).not.toThrow();
    expect(() => deb.renderTemplate("${APPDIR}", templateOptions(profiles["swarm-mainnet"]))).toThrow(
      "Macro APPDIR is not defined",
    );
  });
});
