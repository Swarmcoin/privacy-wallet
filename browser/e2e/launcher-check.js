"use strict";

/**
 * Checks the piece Chromium owns: the .cmd launcher named in the host manifest.
 *
 * Chromium on Windows starts a host whose path is not an .exe by running
 * `cmd.exe /d /s /c "<path>"` with stdin and stdout redirected
 * (chrome/browser/extensions/api/messaging/launch_context_win.cc,
 * `LaunchNativeHostViaCmd`). This does the same thing to the same file, reads
 * the manifest the installer wrote, and asks the host for its status.
 *
 * It catches the failure that is invisible in every other test: a launcher
 * that prints something. One stray character on stdout is read by the browser
 * as a message length and the port dies.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { FrameReader, encodeMessage } = require("../host/src/framing");

const MANIFEST = path.join(__dirname, "..", "install", "green.swarm.wallet_host.json");

function main() {
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

  const comspec = process.env.COMSPEC || "cmd.exe";
  const child = spawn(comspec, ["/d", "/s", "/c", `"${manifest.path}"`], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsVerbatimArguments: true,
  });

  const reader = new FrameReader();
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
