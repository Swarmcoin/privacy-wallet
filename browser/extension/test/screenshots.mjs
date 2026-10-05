/**
 * Screenshots of the price display, from test/popup-harness.html.
 *
 *   node test/screenshots.mjs [--live] [path\to\msedge.exe]
 *
 * Serves this extension folder on 127.0.0.1 (a random port, this process
 * only), opens each state in a headless Edge with a throwaway profile, and
 * writes test/screenshots/<page>-<state>.png. Nothing is registered, no
 * wallet is opened, and the harness answers the price relay itself, so no
 * request leaves the machine. With --live, two more shots read the real relay
 * (https://wallet.swarm.green/api/price/swm, one GET each, read-only).
 */
import http from "node:http";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(here, "screenshots");
const args = process.argv.slice(2);
const live = args.includes("--live");
const edge = args.find((a) => !a.startsWith("--")) || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const SHOTS = [
  ["popup", "fresh", 700],
  ["popup", "masked", 700],
  ["popup", "down", 700],
  ["popup", "ageing", 700],
  ["popup", "stale", 700],
  ["popup", "unavailable", 700],
  ["popup", "off", 560],
  ["popup", "testnet", 560],
  ["popup", "send", 560],
  ["popup", "confirm", 560],
  ["settings", "fresh", 1250],
  ["popup", "page", 1400],
  ["popup", "page-30d", 1400],
  ["popup", "page-hover", 1400],
  ["popup", "page-off", 560],
  ...(live
    ? [
        ["popup", "live", 760],
        ["popup", "page-live", 1400],
      ]
    : []),
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch (_) {
    res.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await mkdir(out, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "swarm-price-harness-"));

function shoot(page, state, height) {
  const file = path.join(out, `${page}-${state}.png`);
  const url = `http://127.0.0.1:${port}/test/popup-harness.html?page=${page}&state=${state}`;
  const width = page === "popup" ? 360 : 720;
  const args = [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-extensions",
    "--disable-sync",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--force-device-scale-factor=2",
    `--window-size=${width},${height}`,
    "--virtual-time-budget=4000",
    `--screenshot=${file}`,
    url,
  ];
  return new Promise((resolve, reject) => {
    execFile(edge, args, { timeout: 60_000 }, (err) => (err ? reject(err) : resolve(file)));
  });
}

try {
  for (const [page, state, height] of SHOTS) {
    console.log(await shoot(page, state, height));
  }
} finally {
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
