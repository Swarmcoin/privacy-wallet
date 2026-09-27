"use strict";

/**
 * Checks the piece Chromium owns: the launcher named in the host manifest.
 *
 * Chromium on Windows starts a host in one of two ways, and the file extension
 * alone decides which
 * (chrome/browser/extensions/api/messaging/launch_context_win.cc):
 *
 *  - **`.exe`** — `LaunchNativeExeDirectly`: started with no shell anywhere in
 *    the pipe. This is the single-file host built by `host/sea`.
 *  - **anything else** — `LaunchNativeHostViaCmd`: `cmd.exe /d /s /c "<path>"`
 *    with stdin and stdout redirected. This is the `.cmd` launcher.
 *
 * This reads a manifest, takes the same branch Chromium would for the path
 * inside it, and asks the host for its status.
 *
 *     node browser/e2e/launcher-check.js [--manifest <path>]
 *
 * It catches the failure that is invisible in every other test: a launcher
 * that prints something. One stray character on stdout is read by the browser
 * as a message length and the port dies. It also counts the answers: a bundled
 * host that managed to start itself twice would answer twice, and the second
 * answer would be read as a length prefix.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { FrameReader, encodeMessage } = require("../host/src/framing");

const DEFAULT_MANIFEST = path.join(__dirname, "..", "install", "green.swarm.wallet_host.json");

function manifestFromArgs() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--manifest");
  if (at < 0) return DEFAULT_MANIFEST;
  if (!argv[at + 1]) {
    process.stdout.write("FAILED: --manifest needs a path\n");
    process.exit(1);
  }
  return path.resolve(argv[at + 1]);
}

function main() {
  const MANIFEST = manifestFromArgs();
  if (!fs.existsSync(MANIFEST)) {
    process.stdout.write(`FAILED: no host manifest at ${MANIFEST}. Run the installer first.\n`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  process.stdout.write(`host manifest: ${MANIFEST}\n`);
  process.stdout.write(`  name:            ${manifest.name}\n`);
  process.stdout.write(`  type:            ${manifest.type}\n`);
  process.stdout.write(`  path:            ${manifest.path}\n`);
  process.stdout.write(`  allowed_origins: ${manifest.allowed_origins.join(", ")}\n`);

  const problems = [];
  if (manifest.type !== "stdio") problems.push("type must be 'stdio'");
  if (!path.isAbsolute(manifest.path)) problems.push("path must be absolute");
  if (!fs.existsSync(manifest.path)) problems.push(`path does not exist: ${manifest.path}`);
  if (manifest.allowed_origins.length !== 1) problems.push("allowed_origins must name exactly one extension");
  if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(manifest.allowed_origins[0])) {
    problems.push(`allowed_origins entry is malformed: ${manifest.allowed_origins[0]}`);
  }
  if (problems.length) {
    process.stdout.write(`FAILED: ${problems.join("; ")}\n`);
    process.exit(1);
  }

  // The branch Chromium takes, taken here for the same reason: an .exe host is
  // started directly, everything else goes through cmd.exe.
  const directly = path.extname(manifest.path).toLowerCase() === ".exe";
  process.stdout.write(`  launched:        ${directly ? "directly (.exe)" : "through cmd.exe"}\n`);
  const comspec = process.env.COMSPEC || "cmd.exe";
  const child = directly
    ? spawn(manifest.path, [], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn(comspec, ["/d", "/s", "/c", `"${manifest.path}"`], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsVerbatimArguments: true,
      });

  const reader = new FrameReader();
  let answers = 0;
  let answered = false;
  const stderr = [];
  child.stderr.on("data", (c) => stderr.push(String(c)));

  child.stdout.on("data", (chunk) => {
    reader.push(chunk);
    for (const frame of reader.read()) {
      if (!frame.ok) {
        process.stdout.write(`FAILED: the launcher wrote something that is not a framed message (${frame.code}).\n`);
        child.kill();
        process.exit(1);
      }
      answered = true;
      answers += 1;
      if (answers > 1) {
        process.stdout.write(`FAILED: one request, ${answers} answers — the host is running twice.\n`);
        child.kill();
        process.exit(1);
      }
      const answer = frame.value;
      if (!answer.ok) {
        process.stdout.write(`FAILED: status returned ${answer.error.code}: ${answer.error.message}\n`);
        child.kill();
        process.exit(1);
      }
      const s = answer.result;
      process.stdout.write("\nthe launcher answered over the framing Chromium uses:\n");
      process.stdout.write(`  host ${s.hostVersion} on Node ${s.node}, core ${s.core}\n`);
      process.stdout.write(`  network ${s.network.displayName} via ${s.network.server}\n`);
      process.stdout.write(`  wallet exists: ${s.walletExists}, unlocked: ${s.unlocked}\n`);
      process.stdout.write(`  network block: ${s.serverHeight === null ? `unreachable (${s.serverError})` : s.serverHeight}\n`);
      process.stdout.write(`  device auth: ${s.deviceAuth}\n`);
      child.stdin.end();
    }
    if (reader.fatal) {
      process.stdout.write(`FAILED: ${reader.fatal.code}\n`);
      child.kill();
      process.exit(1);
    }
  });

  child.on("exit", (code) => {
    process.stdout.write(`launcher exited ${code} after stdin closed\n`);
    if (!answered) {
      process.stdout.write("FAILED: the launcher never answered\n");
      if (stderr.length) process.stdout.write(stderr.join(""));
      process.exit(1);
    }
    process.stdout.write("PASSED\n");
  });

  child.stdin.write(encodeMessage({ id: 1, command: "status", params: {} }));

  const bail = setTimeout(() => {
    process.stdout.write("FAILED: the launcher did not answer within 60s\n");
    if (stderr.length) process.stdout.write(stderr.join(""));
    child.kill();
    process.exit(1);
  }, 60000);
  child.on("exit", () => clearTimeout(bail));
}

main();
