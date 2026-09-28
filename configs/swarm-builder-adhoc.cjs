// The unsigned CI Mac packages with an ad hoc signature.
//
// `identity: null` in swarm-builder.cjs skips signing altogether. electron-builder
// then rewrites Info.plist and renames the executable after Electron's own
// linker signature was made, so every Mach-O in the bundle carries a signature
// that no longer matches the bundle. A quarantined download of such an app is
// refused by macOS as "damaged" with "You should eject the disk image", and
// Apple silicon will not run unsigned arm64 code at all.
//
// An ad hoc signature ("-") signs every Mach-O in the bundle consistently with
// no Apple identity. It is not Developer ID and not notarized: Gatekeeper still
// asks the user to allow the app once (Control-click > Open, or System
// Settings > Privacy & Security > Open Anyway), but the app is no longer
// reported as damaged. The owner's Developer ID build keeps using
// swarm-mac-developer-id.cjs.
const base = require("./swarm-builder.cjs");

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    identity: "-",
  },
};
