/**
 * What Rewards will accept back from the wallet.
 *
 * The wallet answers one question and should answer it with one thing: a
 * receive address. This module is the second lock on that door. It reads the
 * address out of the answer and refuses an answer that carries anything else —
 * a seed, a viewing key, a balance, a history — even though the wallet is
 * written not to send them. Two extensions are two programs, and a program
 * that trusts the other one's good manners is one edit away from leaking.
 *
 * Pure, so node:test can prove the refusals without a browser.
 */

/** Fields that must never ride along with an address. */
export const FORBIDDEN = [
  "seed",
  "seedPhrase",
  "mnemonic",
  "phrase",
  "ufvk",
  "fvk",
  "viewingKey",
  "spendingKey",
  "key",
  "privateKey",
  "balance",
  "shielded",
  "transparent",
  "history",
  "transfers",
  "walletDir",
];

/** The unified prefixes SWARM uses: `swm1` on mainnet, `swarm1` on testnet. */
const UNIFIED = /^(swm|swarm)1[02-9ac-hj-np-z]{30,}$/;

export function isUnifiedAddress(value) {
  return typeof value === "string" && value.length <= 2048 && UNIFIED.test(value);
}

export function hasForbiddenFields(result) {
  if (!result || typeof result !== "object") return false;
  return FORBIDDEN.some((name) => Object.prototype.hasOwnProperty.call(result, name));
}

/**
 * Reads the answer to `swarm.rewards.address`.
 *
 * @returns {{ok:true, address:string, network:?string} | {ok:false, code:string, message:string}}
 */
export function readAddress(answer) {
  if (!answer || typeof answer !== "object") {
    return { ok: false, code: "no_answer", message: "The SWARM Wallet did not answer. Is it installed?" };
  }
  if (answer.ok !== true) {
    const error = answer.error && typeof answer.error === "object" ? answer.error : {};
    return {
      ok: false,
      code: typeof error.code === "string" ? error.code : "refused",
      message: typeof error.message === "string" ? error.message : "The SWARM Wallet refused.",
    };
  }
  const result = answer.result;
  if (hasForbiddenFields(result)) {
    return {
      ok: false,
      code: "too_much",
      message: "The answer carried more than an address, so it was dropped.",
    };
  }
  const address = result && typeof result.address === "string" ? result.address.trim() : "";
  if (!isUnifiedAddress(address)) {
    return { ok: false, code: "bad_address", message: "That is not a SWARM receive address." };
  }
  const network = result && typeof result.network === "string" ? result.network : null;
  return { ok: true, address, network };
}

/** An address with its middle folded away, as in the wallet. */
export function shortAddress(address, head = 12, tail = 8) {
  const a = String(address || "");
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}
