/**
 * The six-word session code: the only thing that travels between the two
 * machines by hand.
 *
 * It is two things at once, and that is deliberate:
 *
 * * it is the **passphrase** the proposal and the signatures are encrypted
 *   under (`age`, scrypt recipient, in the addon), so the relay in the middle
 *   holds bytes it cannot read;
 * * a separately domain-separated, iterated hash of it is the **session id**
 *   the relay files those bytes under, so the relay cannot work back from the
 *   path to the key either.
 *
 * The coordinator reads the code off the screen; the second signer types it
 * in. Nothing else crosses.
 *
 * # The wordlist
 *
 * 2048 four-letter pronounceable words, built here rather than shipped as a
 * blob, so the list is auditable in a screenful: every word is
 * consonant-vowel-consonant-vowel drawn from four fixed alphabets whose sizes
 * multiply to exactly 2048. Six words is therefore 66 bits.
 *
 * They are not English. That is on purpose: a code read down a telephone
 * fails on "accept"/"except" and on "their"/"there", and succeeds on "bala"
 * and "dote" because there is nothing to mishear it as.
 */

/** The first consonant: sixteen that do not sound like each other. */
const FIRST_CONSONANTS = "bdfghjklmnprstvz".split("");
/** The first vowel. */
const FIRST_VOWELS = "aeio".split("");
/** The second consonant: eight, chosen to stay pronounceable after any vowel. */
const SECOND_CONSONANTS = "bdklmnrt".split("");
/** The second vowel. */
const SECOND_VOWELS = "aeio".split("");

/** How many words a session code has. */
export const SESSION_CODE_WORDS = 6;

/**
 * The wordlist: 16 × 4 × 8 × 4 = 2048 distinct four-letter words.
 *
 * Built once at module load. `sessionCode.test.ts` asserts the length and the
 * distinctness, because an accidental duplicate would quietly cost a bit of
 * entropy and nothing would fail.
 */
export const SESSION_WORDS: string[] = (() => {
  const words: string[] = [];
  for (const c1 of FIRST_CONSONANTS) {
    for (const v1 of FIRST_VOWELS) {
      for (const c2 of SECOND_CONSONANTS) {
        for (const v2 of SECOND_VOWELS) {
          words.push(`${c1}${v1}${c2}${v2}`);
        }
      }
    }
  }
  return words;
})();

/** How many bits of entropy a code carries, for the page to be able to say so. */
export const SESSION_CODE_BITS = Math.round(Math.log2(SESSION_WORDS.length) * SESSION_CODE_WORDS);

/**
 * Draws one uniformly distributed index below `bound`.
 *
 * Rejection sampling, not `% bound`: the modulo of a 32-bit draw by 2048 is
 * uniform only because 2048 divides 2^32, and a wordlist that later stops
 * being a power of two would silently start favouring its first entries. This
 * is correct for any bound.
 */
function uniformIndex(bound: number, random: (out: Uint32Array) => void): number {
  if (bound <= 0) throw new Error("a wordlist with no words draws no words");
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buffer = new Uint32Array(1);
  for (;;) {
    random(buffer);
    if (buffer[0] < limit) return buffer[0] % bound;
  }
}

/** The platform CSPRNG, injectable so the tests are not a coin flip. */
export type RandomSource = (out: Uint32Array) => void;

const platformRandom: RandomSource = (out) => {
  // Present in Electron's renderer and in jsdom. There is no fallback on
  // purpose: a session code from `Math.random` would be a session code that
  // looks exactly as good as a real one.
  // The cast is a TypeScript detail, not a runtime one: `getRandomValues`
  // is declared over `ArrayBufferView<ArrayBuffer>`, and a plain
  // `Uint32Array` is typed over `ArrayBufferLike`, which also admits a
  // `SharedArrayBuffer` this code never makes.
  globalThis.crypto.getRandomValues(out as Uint32Array<ArrayBuffer>);
};

/** Makes a fresh session code. */
export function newSessionCode(random: RandomSource = platformRandom): string {
  const words: string[] = [];
  for (let i = 0; i < SESSION_CODE_WORDS; i += 1) {
    words.push(SESSION_WORDS[uniformIndex(SESSION_WORDS.length, random)]);
  }
  return words.join(" ");
}

/**
 * Puts a typed code into the one form the id and the key are derived from.
 *
 * The addon normalises identically (`normalise_code` in
 * `native/src/treasury.rs`). Both sides must agree or the second machine
 * fetches from a path the first never wrote to.
 */
export function normaliseSessionCode(code: string): string {
  return code.trim().split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** What is wrong with a typed code, or `null` if nothing is. */
export function sessionCodeProblem(code: string): string | null {
  const normalised = normaliseSessionCode(code);
  if (normalised.length === 0) return "Type the six-word code from the other machine.";
  const words = normalised.split(" ");
  if (words.length !== SESSION_CODE_WORDS) {
    return `A session code is ${SESSION_CODE_WORDS} words; this is ${words.length}.`;
  }
  const known = new Set(SESSION_WORDS);
  const strangers = words.filter((word) => !known.has(word));
  if (strangers.length > 0) {
    return `Not part of a session code: ${strangers.join(", ")}. Check the spelling.`;
  }
  return null;
}

/** Whether a typed code is one this build could have produced. */
export function isSessionCode(code: string): boolean {
  return sessionCodeProblem(code) === null;
}
