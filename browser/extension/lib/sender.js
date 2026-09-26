/**
 * Who may ask the service worker for a wallet command.
 *
 * Only this extension's own screens: the toolbar popup, the side panel, and
 * the onboarding and settings pages. Two of those open in ordinary tabs, so
 * "has a tab" is not a reason to refuse; what matters is where the page comes
 * from. A content script carries the web page's origin, another extension
 * carries a different id, and both are dropped. Pure, so it can be tested with
 * node:test outside a browser.
 *
 * @param {object} sender  chrome.runtime.MessageSender
 * @param {string} runtimeId  chrome.runtime.id
 * @returns {boolean}
 */
export function isOwnPage(sender, runtimeId) {
  if (!sender || !runtimeId || sender.id !== runtimeId) return false;
  const base = `chrome-extension://${runtimeId}`;
  if (typeof sender.origin === "string" && sender.origin === base) return true;
  if (typeof sender.url === "string" && sender.url.startsWith(`${base}/`)) return true;
  return false;
}
