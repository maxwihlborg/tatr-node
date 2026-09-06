import { NodeStream } from "@effect/platform-node";
import { Cause, Context, Effect, Layer, Order, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as find from "empathic/find";
import fg from "fast-glob";

/**
 * A match of `rg --json`, which narrates its search with `begin`/`end`/
 * `summary` events as well. Those decode as nothing and are dropped, as is a
 * match on a path `rg` could not read as utf-8.
 */
class RipgrepMatch extends Schema.Opaque<RipgrepMatch>()(
  Schema.Struct({
    type: Schema.Literal("match"),
    data: Schema.Struct({
      path: Schema.Struct({ text: Schema.String }),
      lines: Schema.Struct({ text: Schema.String }),
      line_number: Schema.Int,
      submatches: Schema.Array(
        Schema.Struct({
          match: Schema.Struct({ text: Schema.String }),
          start: Schema.Int,
        }),
      ),
    }),
  }),
) {
  static decodeJson = Schema.decodeEffect(Schema.fromJsonString(this));
}

export interface GrepMatch {
  readonly file: string;
  /** 0-based, the way an editor counts */
  readonly line: number;
  /** 0-based and in utf-16 code units, the way an editor counts */
  readonly character: number;
  readonly length: number;
  /** the whole line the match sits on, for callers that judge it in context */
  readonly text: string;
}

/**
 * Where a match sits, for callers who want the same search to read the same
 * way twice. `rg` searches in parallel and answers in whatever order it
 * finishes, which is worth keeping: sorting a handful of matches costs
 * nothing next to searching one file at a time.
 */
export const byLocation = Order.combineAll<GrepMatch>([
  Order.mapInput(Order.String, (match) => match.file),
  Order.mapInput(Order.Number, (match) => match.line),
  Order.mapInput(Order.Number, (match) => match.character),
]);

/**
 * `rg` counts in bytes and editors count in utf-16 code units, which part ways
 * the moment a line holds anything outside ascii.
 */
function characterAt(text: string, byteOffset: number) {
  return Buffer.from(text, "utf8").subarray(0, byteOffset).toString("utf8").length;
}

/** One `rg` match event carries every hit on its line. */
function toMatches(event: RipgrepMatch): Stream.Stream<GrepMatch> {
  return Stream.map(Stream.fromIterable(event.data.submatches), (submatch) => ({
    file: event.data.path.text,
    line: event.data.line_number - 1,
    character: characterAt(event.data.lines.text, submatch.start),
    length: submatch.match.text.length,
    text: event.data.lines.text,
  }));
}

export class FileUtils extends Context.Service<FileUtils>()("@tatr/cli/FileUtils", {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    function glob(source: fg.Pattern | fg.Pattern[], options?: fg.Options) {
      return NodeStream.fromReadable<string>({
        evaluate: () => fg.globStream(source, options),
      });
    }

    function findDir(name: string, options?: find.Options) {
      return Effect.mapError(
        Effect.suspend(() => Effect.fromNullishOr(find.dir(name, options))),
        () => new Cause.NoSuchElementError(`'${name}' not found`),
      );
    }

    function findFile(name: string, options?: find.Options) {
      return Effect.mapError(
        Effect.suspend(() => Effect.fromNullishOr(find.file(name, options))),
        () => new Cause.NoSuchElementError(`'${name}' not found`),
      );
    }

    /**
     * Every literal occurrence of `pattern` under `dir`, found by `ripgrep` so
     * that whatever the repo ignores stays ignored. Only what is on disk is
     * searched.
     */
    function grep(pattern: string, dir: string) {
      return spawner
        .streamLines(
          ChildProcess.make("rg", [
            "--json",
            "--fixed-strings",
            "--no-messages",
            "--",
            pattern,
            dir,
          ]),
        )
        .pipe(
          Stream.filterMapEffect((line) => Effect.result(RipgrepMatch.decodeJson(line))),
          Stream.flatMap(toMatches),
        );
    }

    return {
      findFile,
      findDir,
      glob,
      grep,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
