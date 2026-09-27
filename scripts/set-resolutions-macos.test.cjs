"use strict";

// set-resolutions-macos.js (the postinstall hook) run as if on macOS, on any
// machine: node --test scripts/set-resolutions-macos.test.cjs
//
// On macOS it adds a temporary fsevents resolution to package.json and runs a
// nested `yarn install`. It used to write package.json back re-serialised,
// without its final newline, which left every Mac checkout dirty after
// `yarn install` — and the signed Mac build refuses a tree HEAD does not
// describe (scripts/build-mac-distribution.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

/** set-resolutions-macos.js, run as if on macOS, with the nested `yarn install` replaced by `onInstall`. */
function runResolutionsHook(t, onInstall) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-resolutions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
  fs.writeFileSync(
    path.join(dir, "as-darwin.cjs"),
    [
      'const os = require("os");',
      'os.platform = () => "darwin";',
      'const cp = require("child_process");',
      "cp.execSync = () => {",
      '  const fs = require("fs");',
      '  fs.writeFileSync("during-install.json", fs.readFileSync("package.json"));',
      `  ${onInstall}`,
      "};",
    ].join("\n"),
  );
  const run = spawnSync(process.execPath, ["-r", "./as-darwin.cjs", path.join(root, "set-resolutions-macos.js")], {
    cwd: dir,
    encoding: "utf8",
  });
  return { dir, run };
}

test("the macOS install hook leaves package.json byte-for-byte as it found it", (t) => {
  const { dir, run } = runResolutionsHook(t, "");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "during-install.json"), "utf8")).resolutions.fsevents, "2.3.3");
  assert.equal(fs.readFileSync(path.join(dir, "package.json"), "utf8"), fs.readFileSync(path.join(root, "package.json"), "utf8"));
});

test("the macOS install hook restores package.json when the nested install fails", (t) => {
  const { dir, run } = runResolutionsHook(t, 'throw new Error("yarn install failed");');
  assert.notEqual(run.status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "package.json"), "utf8"), fs.readFileSync(path.join(root, "package.json"), "utf8"));
});
