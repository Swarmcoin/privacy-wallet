const fs = require("fs");
const { execSync } = require("child_process");
const os = require("os");

if (os.platform() === "darwin") {
  // The exact bytes, so they can be put back as they were. Re-serialising the
  // parsed object dropped package.json's final newline, which left every macOS
  // checkout dirty after `yarn install` — and the signed Mac build refuses a
  // tree HEAD does not describe (scripts/build-mac-distribution.js).
  const original = fs.readFileSync("package.json", "utf8");
  const packageJson = JSON.parse(original);

  if (!packageJson.resolutions || !packageJson.resolutions.fsevents) {
    if (!packageJson.resolutions) packageJson.resolutions = {};
    packageJson.resolutions.fsevents = "2.3.3";

    fs.writeFileSync("package.json", JSON.stringify(packageJson, null, 2));
    console.log("Adding fsevents resolution for macOS, re-running yarn...");
    try {
      execSync("yarn install", { stdio: "inherit" });
    } finally {
      // Remove the temporary fsevents resolution, restore previous state, even
      // when the nested install fails.
      fs.writeFileSync("package.json", original);
    }
  } else {
    console.log("fsevents resolution already present, skipping.");
  }
} else {
  console.log("Not macOS, skipping fsevents resolution.");
}
