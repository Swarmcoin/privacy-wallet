/**
 * The one door this wallet opens to another extension.
 *
 * SWARM Rewards pays to an address the person owns, so it has to learn one
 * address. That is the whole conversation: one sender, one question, one
 * answer. Everything else that arrives on `onMessageExternal` is dropped
 * without being looked at further.
 *
 * The rules, written as predicates so node:test can hold them to account the
 * way `lib/sender.js` is held to account:
 *
 *   - the sender's id is exactly the SWARM Rewards id, compared whole;
 *   - the sender is one of that extension's own pages, proved by its origin or
 *     its url, not by whether it has a tab: the Rewards page is a tab like the
 *     wallet's own settings page (see `lib/sender.js`). A content script would
 *     carry the web page's origin instead, and is refused by that same test;
 *   - the message is exactly `{ type: "swarm.rewards.address" }`, with no
 *     command, no parameters, nothing else riding along.
 *
 * What may be answered is decided elsewhere (the wallet must be unlocked and
 * the person must have said yes once in the popup); this file only decides
 * whether the question is even admissible.
 */

/**
 * SWARM Rewards, pinned by id.
 *
 * The id is the hash of the public key in that extension's manifest, so it is
 * the same on every machine and cannot be taken by another build.
 */
export const REWARDS_EXTENSION_ID = "gjmgdanakkpkgpmecnecoliifonlapnb";

/** The only message type this wallet answers from outside. */
export const REWARDS_ADDRESS_REQUEST = "swarm.rewards.address";

/** Is this the SWARM Rewards extension itself, on one of its own pages? */
export function isRewardsSender(sender, allowedId = REWARDS_EXTENSION_ID) {
  if (!sender || typeof sender !== "object") return false;
  if (typeof allowedId !== "string" || allowedId.length === 0) return false;
  if (sender.id !== allowedId) return false;
  const base = `chrome-extension://${allowedId}`;
  // Anything that claims a different origin or a different page is dropped,
  // which is where a content script on a web page falls.
  if (typeof sender.origin === "string" && sender.origin !== base) return false;
  if (typeof sender.url === "string" && !sender.url.startsWith(`${base}/`)) return false;
  // And the sender has to prove where it comes from; an id alone is not proof.
  return sender.origin === base || (typeof sender.url === "string" && sender.url.startsWith(`${base}/`));
}

/** Is this the one question, and nothing but the question? */
export function isAddressRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  if (message.type !== REWARDS_ADDRESS_REQUEST) return false;
  const keys = Object.keys(message);
  return keys.length === 1 && keys[0] === "type";
}

/** Both of the above: whether the service worker should even consider answering. */
export function mayAnswerRewards(sender, message, allowedId = REWARDS_EXTENSION_ID) {
  return isRewardsSender(sender, allowedId) && isAddressRequest(message);
}

/**
 * The answer, built field by field.
 *
 * Nothing is spread or forwarded: the object that leaves this extension is
 * assembled here from two strings, so a new field in the host's `addresses`
 * reply can never become a new field on the wire.
 */
export function addressAnswer(unified, networkId) {
  return { ok: true, result: { address: String(unified), network: networkId ? String(networkId) : null } };
}
