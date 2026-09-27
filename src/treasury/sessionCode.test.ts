import {
  SESSION_CODE_BITS,
  SESSION_CODE_WORDS,
  SESSION_WORDS,
  isSessionCode,
  newSessionCode,
  normaliseSessionCode,
  sessionCodeProblem,
} from "./sessionCode";

describe("the wordlist", () => {
  it("is exactly 2048 words, so six of them are 66 bits", () => {
    expect(SESSION_WORDS).toHaveLength(2048);
    expect(SESSION_CODE_BITS).toBe(66);
  });

  it("has no duplicates — a duplicate would cost entropy and fail nothing", () => {
    expect(new Set(SESSION_WORDS).size).toBe(SESSION_WORDS.length);
  });

  it("is all four-letter lower-case words, so a code can be read aloud", () => {
    for (const word of SESSION_WORDS) {
      expect(word).toMatch(/^[a-z]{4}$/);
    }
  });
});

describe("making a code", () => {
  it("draws six words from the list", () => {
    const code = newSessionCode();
    const words = code.split(" ");
    expect(words).toHaveLength(SESSION_CODE_WORDS);
    for (const word of words) expect(SESSION_WORDS).toContain(word);
  });

  it("uses every bit of the draw, rejecting values that would bias the list", () => {
    // 0x100000000 is above the rejection limit for a 2048-word list only if
    // the list is not a power of two; for 2048 the limit is the whole range,
    // so the first draw is always taken. Feeding a sequence proves the index
    // is the draw and not a hash of it.
    const draws = [0, 1, 2047, 2048, 4095, 0xffffffff];
    let i = 0;
    const code = newSessionCode((out) => {
      out[0] = draws[i % draws.length];
      i += 1;
    });
    expect(code.split(" ")).toEqual([
      SESSION_WORDS[0],
      SESSION_WORDS[1],
      SESSION_WORDS[2047],
      SESSION_WORDS[0],
      SESSION_WORDS[2047],
      SESSION_WORDS[0xffffffff % 2048],
    ]);
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newSessionCode()));
    expect(codes.size).toBe(200);
  });
});

describe("reading a typed code", () => {
  it("normalises case, runs of spaces and edges, so both machines derive one id", () => {
    expect(normaliseSessionCode("  Bala   DOTE  koba nemi rate vibo ")).toBe(
      "bala dote koba nemi rate vibo",
    );
  });

  it("accepts a code this build could have made", () => {
    const code = newSessionCode();
    expect(isSessionCode(code)).toBe(true);
    expect(isSessionCode(code.toUpperCase())).toBe(true);
    expect(sessionCodeProblem(code)).toBeNull();
  });

  it("says how many words are missing rather than just refusing", () => {
    const five = SESSION_WORDS.slice(0, 5).join(" ");
    expect(sessionCodeProblem(five)).toBe("A session code is 6 words; this is 5.");
  });

  it("names the word it does not recognise, so a typo can be found", () => {
    const code = `${SESSION_WORDS.slice(0, 5).join(" ")} zzzz`;
    expect(sessionCodeProblem(code)).toContain("zzzz");
    expect(sessionCodeProblem(code)).toContain("Check the spelling");
  });

  it("asks for the code rather than complaining about an empty one", () => {
    expect(sessionCodeProblem("   ")).toContain("Type the six-word code");
  });
});
