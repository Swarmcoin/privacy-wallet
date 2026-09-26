/**
 * Creating or restoring the wallet.
 *
 * The recovery phrase is handed over by the host exactly once, lives in this
 * page's memory while the person writes it down, and is cleared when they
 * confirm. It is never put in `chrome.storage`, never sent anywhere, and the
 * page asks for one word back before it lets them leave: a backup nobody has
 * checked is a backup that is usually wrong.
 */

import { command, el, show, setText, setError, copyToClipboard, paintNetwork } from "./common.js";

const STEPS = ["choose", "warn", "seed", "confirm", "restore", "done"];

/** The phrase, only while this page is open. */
let seedWords = [];
let checkIndex = 0;

function step(name) {
  for (const s of STEPS) show(el(`step-${s}`), s === name);
}

function forgetSeed() {
  seedWords = [];
  setText("seed", "");
}

async function paintNetworkBadge() {
  const status = await command("status");
  if (status.ok) paintNetwork(el("network"), status.result.network);
}

async function create() {
  const button = el("warn-go");
  button.disabled = true;
  button.textContent = "Creating…";
  setError("warn-error", null);
  const answer = await command("wallet.create");
  button.disabled = false;
  button.textContent = "I have paper ready";
  if (!answer.ok) {
    setError("warn-error", answer.error);
    return;
  }
  seedWords = String(answer.result.seed).trim().split(/\s+/);
  setText("seed", seedWords.join(" "));
  setText("seed-birthday", String(answer.result.birthday));
  step("seed");
}

function askForWord() {
  checkIndex = Math.floor(Math.random() * seedWords.length);
  setText("confirm-ask", `Type word number ${checkIndex + 1}.`);
  el("confirm-word").value = "";
  setError("confirm-error", null);
  step("confirm");
}

async function finish() {
  forgetSeed();
  await command("sync.start");
  const addresses = await command("addresses");
  if (addresses.ok) setText("done-address", addresses.result.unified || "");
  step("done");
}

async function restore() {
  const button = el("restore-go");
  const seed = el("restore-seed").value.trim().replace(/\s+/g, " ");
  const birthdayText = el("restore-birthday").value.trim();
  const birthday = birthdayText === "" ? undefined : Number(birthdayText);
  if (birthdayText !== "" && !Number.isFinite(birthday)) {
    setError("restore-error", { message: "The birthday is a block number, or leave it empty." });
    return;
  }
  button.disabled = true;
  button.textContent = "Restoring…";
  setError("restore-error", null);
  const answer = await command("wallet.restore", { seed, birthday });
  button.disabled = false;
  button.textContent = "Restore";
  if (!answer.ok) {
    setError("restore-error", answer.error);
    return;
  }
  el("restore-seed").value = "";
  setText("done-note", "It is scanning the chain from your birthday block. That can take a while the first time.");
  await finish();
}

el("choose-create").addEventListener("click", () => step("warn"));
el("choose-restore").addEventListener("click", () => step("restore"));
el("warn-back").addEventListener("click", () => step("choose"));
el("warn-go").addEventListener("click", create);
el("seed-copy").addEventListener("click", (e) => copyToClipboard(seedWords.join(" "), e.target));
el("seed-next").addEventListener("click", askForWord);
el("confirm-again").addEventListener("click", () => step("seed"));
el("confirm-check").addEventListener("click", async () => {
  const typed = el("confirm-word").value.trim().toLowerCase();
  if (typed !== String(seedWords[checkIndex] || "").toLowerCase()) {
    setError("confirm-error", { message: "That is not the word. Check your copy and try again." });
    return;
  }
  await finish();
});
el("restore-back").addEventListener("click", () => step("choose"));
el("restore-go").addEventListener("click", restore);
el("done-copy").addEventListener("click", (e) => copyToClipboard(el("done-address").textContent, e.target));

// The phrase must not outlive the page, even if the tab is only hidden.
window.addEventListener("pagehide", forgetSeed);

paintNetworkBadge();
step(window.location.hash === "#restore" ? "restore" : "choose");
