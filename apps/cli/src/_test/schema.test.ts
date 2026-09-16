import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { TaskInfo } from "../schema";

const decode = Schema.decodeUnknownEffect(TaskInfo);

function tagsOf(tags: string) {
  return Effect.runSync(Effect.map(decode({ title: "t", tags }), (info) => info.tags));
}

function failure(tags: string) {
  return Effect.runSync(Effect.flip(Effect.asVoid(decode({ title: "t", tags })))).message;
}

describe("TaskInfo tags", () => {
  it("folds case and padding before it judges the charset", () => {
    expect(tagsOf("  Foo-Bar_1 , CLI ")).toEqual(["foo-bar_1", "cli"]);
  });

  it("refuses what no query could name", () => {
    expect(failure("in progress")).toContain("a tag of a-z, 0-9, '-' and '_'");
    expect(failure("foo!")).toContain("a tag of a-z, 0-9, '-' and '_'");
  });

  // Writing is where a bad tag has to be caught, since that is the path a
  // `--tag` flag and the mcp tools reach the file through.
  it("refuses one on the way out as well", () => {
    const encode = Schema.encodeEffect(TaskInfo);

    expect(
      Effect.runSync(
        Effect.flip(
          Effect.asVoid(
            encode(
              TaskInfo.make(
                { title: "t", priority: 50, closed: false, tags: ["a b"] },
                { disableChecks: true },
              ),
            ),
          ),
        ),
      ).message,
    ).toContain("a tag of a-z, 0-9, '-' and '_'");
  });
});
