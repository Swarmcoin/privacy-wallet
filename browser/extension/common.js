/**
 * The few things every screen needs.
 *
 * Nothing here touches the network, and nothing here holds a key: `command()`
 * hands a name and some parameters to the service worker, which hands them to
 * the host. The screens are views over answers.
 */

/** Asks the host, through the service worker. Never throws. */
export async function command(name, params) {
  try {
    const answer = await chrome.runtime.sendMessage({ type: "swarm.command", command: name, params: params || {} });
    if (!answer) {
      return { ok: false, error: { code: "no_answer", message: "The wallet did not answer. Reopen the popup." } };
    }
    return answer;
  } catch (e) {
    return { ok: false, error: { code: "no_answer", message: String((e && e.message) || e) } };
  }
}

/** The style guide's masked value: the shape of the number, none of the digits. */
export const MASK_CELL = "⬢";

export function formatAmount(value, ticker) {
  const n = Number(value || 0);
  const text = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  return ticker ? `${text} ${ticker}` : text;
}

export function maskAmount(value, ticker) {
  return formatAmount(value, "").replace(/\d/g, MASK_CELL) + (ticker ? ` ${ticker}` : "");
}

/** An address with its middle folded away, for a line that has to fit. */
export function shortAddress(address, head = 12, tail = 8) {
  const a = String(address || "");
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function el(id) {
  return document.getElementById(id);
}

export function show(node, visible) {
  if (!node) return;
  node.classList.toggle("hidden", !visible);
}

export function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text === undefined || text === null ? "" : String(text);
}

/** Shows an error in the named box, or clears it when `error` is null. */
export function setError(id, error) {
  const node = el(id);
  if (!node) return;
  if (!error) {
    node.textContent = "";
    node.classList.add("hidden");
    return;
  }
  node.textContent = typeof error === "string" ? error : error.message || "Something went wrong.";
  node.classList.remove("hidden");
}

/** Copies text and briefly says so on the button that asked. */
export async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(String(text));
    if (button) {
      const was = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = was;
      }, 1200);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * The SWARM explorers a link may open, and nothing else. The host builds the
 * URL; this is the second check, on the side that opens the tab.
 */
const EXPLORERS = ["https://explore.swarm.green/", "https://testnet.explore.swarm.green/"];

export function isExplorerUrl(url) {
  const u = String(url || "");
  return EXPLORERS.some((prefix) => u.startsWith(prefix)) && !/[\s"'<>]/.test(u);
}

/** Opens a SWARM explorer page in a new tab. Anything else is ignored. */
export function openExplorer(url) {
  if (!isExplorerUrl(url)) return false;
  chrome.tabs.create({ url });
  return true;
}

/** Whether the popup should say "test coins" anywhere. */
export function paintNetwork(node, network) {
  if (!node || !network) return;
  node.textContent = network.displayName;
  node.classList.toggle("testnet", !!network.coinsAreTestCoins);
}
