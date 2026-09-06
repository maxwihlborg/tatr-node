import { NodeStream } from "@effect/platform-node";
import { Cause, Context, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as find from "empathic/find";
import fg from "fast-glob";

/**
 * A match of `rg --json`, which narrates its search with `begin`/`end`/
 * `summary` events as well. Those decode as nothing and are dropped, as is a
 * match on a path `rg` could not read as utf-8.
 */
const RipgrepMatch = Schema.Struct({
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
});

const decodeMatch = Schema.decodeEffect(Schema.fromJsonString(RipgrepMatch));

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
 * `rg` counts in bytes and editors count in utf-16 code units, which part ways
 * the moment a line holds anything outside ascii.
 */
function characterAt(text: string, byteOffset: number) {
  return Buffer.from(text, "utf8").subarray(0, byteOffset).toString("utf8").length;
}

/** One `rg` match event carries every hit on its line. */
function toMatches(event: typeof RipgrepMatch.Type): Stream.Stream<GrepMatch> {
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
     * searched: an editor's unwritten copy is the caller's problem.
     */
    function grep(pattern: string, dir: string) {
      return spawner
        .streamLines(
          ChildProcess.make("rg", [
            "--json",
            "--fixed-strings",
            // rg answers out of order otherwise, and a jump list should not
            // reshuffle between two runs of the same search
            "--sort=path",
            "--no-messages",
            "--",
            pattern,
            dir,
          ]),
        )
        .pipe(
          Stream.filterMapEffect((line) => Effect.result(decodeMatch(line))),
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
