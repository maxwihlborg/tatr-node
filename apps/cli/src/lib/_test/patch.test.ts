import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import { applyPatch, type PatchOp, spansOf } from "../patch";

const WRAPPED = [
  "The formatter reflows on every write, which is what made positions",
  "unusable. It does not touch anchors.",
  "",
  "A second paragraph, left alone.",
].join("\n");

function run(body: string, ...ops: ReadonlyArray<PatchOp>) {
  const out = applyPatch(body, ops);

  return Result.isSuccess(out) ? out.success : out.failure.message;
}

describe("spansOf", () => {
  it("matches an anchor that the formatter wrapped", () => {
    expect(spansOf(WRAPPED, "what made positions unusable")).toHaveLength(1);
    expect(spansOf(WRAPPED, "reflows on every\n\n   write")).toHaveLength(1);
  });

  it("spans a paragraph break, since that is whitespace too", () => {
    expect(spansOf(WRAPPED, "touch anchors. A second")).toHaveLength(1);
  });

  it("ends on the last character the anchor spelled", () => {
    const span = spansOf(WRAPPED, "positions")[0]!;

    expect(WRAPPED.slice(span.start, span.end)).toBe("positions");
  });

  it("counts every occurrence, and never overlaps", () => {
    expect(spansOf("a a a", "a")).toHaveLength(3);
    expect(spansOf("aaaa", "aa")).toHaveLength(2);
    expect(spansOf(WRAPPED, "nothing here")).toHaveLength(0);
    expect(spansOf(WRAPPED, "   ")).toHaveLength(0);
  });
});

describe("applyPatch", () => {
  it("replaces across a line break", () => {
    expect(run(WRAPPED, { op: "replace", old_string: "made positions unusable", new_string: "X" })).toContain(
      "which is what X",
    );
  });

  it("inserts before and after an anchor verbatim", () => {
    expect(run("one\n\ntwo", { op: "insert_before", anchor: "two", text: "mid\n\n" })).toBe(
      "one\n\nmid\n\ntwo",
    );
    expect(run("one\n\ntwo", { op: "insert_after", anchor: "one", text: "\n\nmid" })).toBe(
      "one\n\nmid\n\ntwo",
    );
  });

  it("prepends and appends without inventing separators", () => {
    expect(run("body", { op: "prepend", text: "top\n\n" })).toBe("top\n\nbody");
    expect(run("body", { op: "append", text: "\n\nend" })).toBe("body\n\nend");
  });

  it("replaces a range, leaving the closing anchor in place", () => {
    const body = "# One\n\ndrop me\n\n# Two\n\nkeep";

    expect(run(body, { op: "replace_range", from: "# One", to: "# Two", new_string: "" })).toBe(
      "# Two\n\nkeep",
    );
  });

  it("takes the ops in order, each seeing the last", () => {
    expect(
      run(
        "a",
        { op: "append", text: "b" },
        { op: "replace", old_string: "ab", new_string: "c" },
      ),
    ).toBe("c");
  });

  it("refuses an anchor that is not unique, and says how many", () => {
    expect(run("a a", { op: "replace", old_string: "a", new_string: "b" })).toBe(
      'patch[0] replace: "a" matched 2 times',
    );
    expect(run("a a", { op: "insert_after", anchor: "zzz", text: "!" })).toBe(
      'patch[0] insert_after: "zzz" matched nothing',
    );
  });

  it("takes every occurrence with replace_all", () => {
    expect(run("a a a", { op: "replace", old_string: "a", new_string: "b", replace_all: true })).toBe(
      "b b b",
    );
  });

  it("aborts the whole patch when one op fails", () => {
    expect(
      run(
        "keep",
        { op: "append", text: " more" },
        { op: "replace", old_string: "missing", new_string: "x" },
      ),
    ).toBe('patch[1] replace: "missing" matched nothing');
  });
});
