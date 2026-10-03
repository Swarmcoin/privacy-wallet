/**
 * The side panel: what this wallet has received and sent.
 *
 * Amounts are shown in full here, not masked. The panel is something a person
 * opens on purpose and can close; the popup opens over whatever they were
 * reading, which is why the popup masks and this does not.
 */

import {
  command,
  el,
  show,
  setText,
  setError,
  shortAddress,
  formatAmount,
  paintNetwork,
  isExplorerUrl,
  openExplorer,
} from "./common.js";

function row(transfer, ticker) {
  const incoming = String(transfer.kind || "").toLowerCase().includes("receiv");
  const wrapper = document.createElement("div");
  wrapper.className = "transfer";

  const top = document.createElement("div");
  top.className = "row between";
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = transfer.pending ? `${transfer.kind} · pending` : transfer.kind || "transfer";
  const value = document.createElement("span");
  value.className = `value ${incoming ? "in" : "out"}`;
  value.textContent = `${incoming ? "+" : "−"}${formatAmount(Math.abs(transfer.amount), ticker)}`;
  top.append(kind, value);

  const middle = document.createElement("div");
  middle.className = "note";
  const when = transfer.datetime ? new Date(transfer.datetime * 1000).toLocaleString() : "";
  const where = transfer.address ? shortAddress(transfer.address) : "";
  middle.textContent = [when, where].filter(Boolean).join(" · ");

  wrapper.append(top, middle);

  if (transfer.memos && transfer.memos.length) {
    const memo = document.createElement("div");
    memo.className = "note";
    memo.textContent = transfer.memos.filter(Boolean).join(" ");
    wrapper.append(memo);
  }

  if (transfer.txid) {
    const txid = document.createElement("div");
    txid.className = "txid";
    txid.textContent = transfer.txid;
    wrapper.append(txid);
    if (isExplorerUrl(transfer.explorerUrl)) {
      const link = document.createElement("button");
      link.className = "link";
      link.textContent = "View in the SWARM explorer";
      link.addEventListener("click", () => openExplorer(transfer.explorerUrl));
      wrapper.append(link);
    }
  }
  return wrapper;
}

async function load() {
  setError("error", null);
  const status = await command("status");
  if (status.ok) paintNetwork(el("network"), status.result.network);
  if (status.ok && !status.result.unlocked) {
    setText("count", "");
    setError("error", { message: "The wallet is locked. Unlock it from the toolbar to see your history." });
    el("list").replaceChildren();
    show(el("empty"), false);
    return;
  }

  const answer = await command("history");
  if (!answer.ok) {
    setError("error", answer.error);
    return;
  }
  const { transfers, ticker } = answer.result;
  setText("count", `${transfers.length} ${transfers.length === 1 ? "entry" : "entries"}`);
  const list = el("list");
  list.replaceChildren(...transfers.map((t) => row(t, ticker)));
  show(el("empty"), transfers.length === 0);
}

el("refresh").addEventListener("click", load);
chrome.runtime.onMessage.addListener((message) => {
  if (message && (message.type === "swarm.locked" || message.type === "swarm.unlocked")) load();
});

load();
