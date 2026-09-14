import { describe, expect, it } from "@effect/vitest";
import { matchingIds, shortestUniqueSuffixes } from "../abbrev";

const IDS = ["DAM5X5AZMNQPG", "DAM611Z0WJMNW", "DAM5061CH6FPR", "DAN8FCTYGDP6M"];

describe("abbrev", () => {
  it("cuts each id where its tail stops being shared", () => {
    const unique = shortestUniqueSuffixes(IDS);

    expect(Object.fromEntries(unique)).toEqual({
      DAM5X5AZMNQPG: 1,
      DAM611Z0WJMNW: 1,
      DAM5061CH6FPR: 1,
      DAN8FCTYGDP6M: 1,
    });
  });

  it("lengthens a suffix only as far as the collision goes", () => {
    const unique = shortestUniqueSuffixes(["0000000000AXY", "0000000000BXY", "000000000CDXY"]);

    expect([...unique.values()]).toEqual([3, 3, 3]);
  });

  it("spells ids that fold together in full", () => {
    const unique = shortestUniqueSuffixes(["000000000000O", "0000000000000"]);

    expect([...unique.values()]).toEqual([13, 13]);
  });

  it("matches a suffix the way the decoder folds", () => {
    expect(matchingIds(IDS, "pg")).toEqual(["DAM5X5AZMNQPG"]);
    expect(matchingIds(IDS, "6m")).toEqual(["DAN8FCTYGDP6M"]);
    // Crockford's `O` for `0` and `I` for `1`, either case.
    expect(matchingIds(["DAM5X5AZMN0P1"], "opi")).toEqual(["DAM5X5AZMN0P1"]);
  });

  it("answers with every candidate an ambiguous abbreviation reaches", () => {
    expect(matchingIds(IDS, "m")).toEqual(["DAN8FCTYGDP6M"]);
    expect(matchingIds(["00000000000AB", "0000000000CAB"], "ab")).toHaveLength(2);
  });

  it("reaches nothing on an empty abbreviation", () => {
    expect(matchingIds(IDS, "")).toEqual([]);
  });
});
