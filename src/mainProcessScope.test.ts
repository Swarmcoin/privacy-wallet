/**
 * @jest-environment node
 */

/**
 * Every name the main process reads has to be a name it can see.
 *
 * `mainWindow` is a local of `createWindow()` in `public/electron.js`, not a
 * module binding. Every dialog handler there looks the window up for itself
 * with `BrowserWindow.getAllWindows()[0] ?? null`, except, until
 * 0.1.0-mainnet.5, `treasury:pick-signer-file`, which was written as though
 * `mainWindow` were in scope. It is not, so pressing "Register a signer file"
 * in the packaged mainnet.3 and mainnet.4 builds answered
 *
 *     Error invoking remote method 'treasury:pick-signer-file':
 *     ReferenceError: mainWindow is not defined
 *
 * and no picker ever opened. Nothing caught it: `public/` is in
 * `.eslintignore`, so `no-undef` never read the file, and the renderer tests
 * mock the channel rather than calling it.
 *
 * So this test runs that one rule, `no-undef`, over every script in
 * `public/` (the main process, the preload and the modules they require,
 * none of which webpack or the project's ESLint run ever reads) with the
 * globals Node really gives them. It keeps no list of dangerous names: a name
 * used where it is not declared is the same bug in whichever handler it turns
 * up. Against the mainnet.4 source it reports `'mainWindow' is not defined`
 * at 1344:63, the line and column of the packaged app's stack trace.
 */

import fs from "fs";
import path from "path";
import { Linter } from "eslint";

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

/** The scripts Electron runs as they are: plain CommonJS, never bundled. */
const SCRIPTS = fs
  .readdirSync(PUBLIC_DIR)
  .filter((name) => name.endsWith(".js"))
  .sort();

const linter = new Linter();

const CONFIG: Linter.Config = {
  // Electron 40's main process and preload are Node 22 or later, where
  // `fetch` and `AbortController` are real globals; ESLint's `node`
  // environment says so, and says nothing about `window`.
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: "latest", sourceType: "script" },
  rules: { "no-undef": "error" },
};

type Finding = { line: number; column: number; name: string; text: string };

/**
 * A call that can only run when its name exists is not this bug. Near the end
 * of `createWindow`, `if (typeof log === "function") log(...)` names a `log`
 * that is a const of an earlier block, so the guard is always false and the
 * call never runs. That exact shape, on the line itself, is excused; an
 * unguarded use of the same name anywhere else still fails.
 */
function guarded(line: string, name: string): boolean {
  const n = name.replace(/\$/g, "\\$");
  const shapes = [`typeof ${n} === "function"\\)\\s*${n}\\(`, `typeof ${n} === "function" && ${n}\\(`];
  return shapes.some((shape) => new RegExp(shape).test(line));
}

function undeclared(source: string, filename: string): Finding[] {
  const lines = source.split(/\r?\n/);
  const messages = linter.verify(source, CONFIG, { filename });
  // A file the parser cannot read yields one fatal message and no rule runs
  // at all; that must fail loudly rather than pass as "nothing undeclared".
  const fatal = messages.filter((m) => m.fatal);
  if (fatal.length > 0) {
    throw new Error(`${filename} did not parse: ${fatal.map((m) => `${m.line}:${m.column} ${m.message}`).join("; ")}`);
  }
  return messages
    .filter((m) => m.ruleId === "no-undef")
    .map((m) => ({
      line: m.line,
      column: m.column,
      name: /'([^']+)' is not defined/.exec(m.message)?.[1] ?? m.message,
      text: (lines[m.line - 1] ?? "").trim(),
    }))
    .filter((finding) => !guarded(lines[finding.line - 1] ?? "", finding.name));
}

describe("scripts in public/ read only names they can see", () => {
  it("covers the main process and the preload", () => {
    expect(SCRIPTS).toEqual(expect.arrayContaining(["electron.js", "preload.js"]));
  });

  it("catches the shape that shipped in mainnet.3 and mainnet.4", () => {
    const shipped = [
      'const { BrowserWindow, dialog, ipcMain } = require("electron");',
      "function createWindow() {",
      "  const mainWindow = new BrowserWindow({});",
      "  return mainWindow;",
      "}",
      'ipcMain.handle("treasury:pick-signer-file", async () => {',
      '  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });',
      "  return { canceled, filePaths };",
      "});",
    ].join("\n");
    expect(undeclared(shipped, "shipped.js").map((f) => `${f.line}:${f.name}`)).toEqual(["7:mainWindow"]);
  });

  it("excuses a call only behind its own typeof guard", () => {
    expect(undeclared('if (typeof log === "function") log("sandbox off");', "guard.js")).toEqual([]);
    expect(undeclared('if (typeof log !== "function") log("sandbox off");', "guard.js").map((f) => f.name)).toEqual([
      "log",
    ]);
    expect(undeclared('log("sandbox off");', "bare.js").map((f) => f.name)).toEqual(["log"]);
  });

  it.each(SCRIPTS)("public/%s declares every name it reads", (name) => {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8");
    expect(undeclared(source, name).map((f) => `${name}:${f.line}:${f.column} '${f.name}' in: ${f.text}`)).toEqual([]);
  });
});
