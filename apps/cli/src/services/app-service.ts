import { Cause, Context, Data, Effect, Layer, Stream, Struct } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { TaskInfo, type Task } from "../schema.js";
import { FileUtils } from "./file-utils.js";

export class AppService extends Context.Service<AppService>()("@tatr/cli/AppService", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fu = yield* FileUtils;
    const path = yield* Path.Path;

    const getTaskDir = yield* Effect.cached(fu.findDir("tasks"));

    const listFiles = Stream.unwrap(
      Effect.map(getTaskDir, (root) =>
        fu.glob("*.md", {
          cwd: root,
          absolute: true,
        }),
      ),
    );

    type State = Data.TaggedEnum<{
      Opening: {};
      Inside: { lines: string[] };
      Done: { matter: string };
    }>;
    const state = Data.taggedEnum<State>();

    function extractFrontMatter(file: string) {
      return fs.stream(file).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.scanEffect(state.Opening(), (acc: State, line) => {
          return state.$match(acc, {
            Opening: () => {
              if (line !== "---") {
                return Effect.fail(new Cause.NoSuchElementError());
              }
              return Effect.succeed(state.Inside({ lines: [] }));
            },
            Inside: (s) => {
              if (line !== "---") {
                return Effect.succeed(
                  Struct.evolve(s, {
                    lines: (ls) => ls.concat(line),
                  }),
                );
              }
              return Effect.succeed(state.Done({ matter: s.lines.join("\n") }));
            },
            Done: () => Effect.die("unreachable"),
          });
        }),
        Stream.filter(state.$is("Done")),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption),
        Effect.map((n) => n.matter),
      );
    }

    const listFileInfo = Stream.Do.pipe(
      Stream.bind("file", () => listFiles),
      Stream.let("id", ({ file }) => path.basename(file, ".md")),
      Stream.bindEffect("stat", ({ file }) => fs.stat(file)),
      Stream.filterMapEffect((ctx) => {
        return extractFrontMatter(ctx.file).pipe(
          Effect.flatMap(TaskInfo.decodeYaml),
          Effect.map((info) => ({
            ...ctx,
            info,
          })),
          Effect.tapErrorTag("PlatformError", (err) => {
            return Effect.logError(err);
          }),
          Effect.tapErrorTag("NoSuchElementError", () => {
            return Effect.logError(
              `${path.relative(process.cwd(), ctx.file)}: No frontmatter`, //
            );
          }),
          Effect.tapErrorTag("SchemaError", (err) => {
            return Effect.logError(
              `${path.relative(process.cwd(), ctx.file)}: Invalid frontmatter\n\n${err.message}\n`,
            );
          }),
          Effect.result,
        );
      }),
    ) satisfies Stream.Stream<Task, any, any>;

    return {
      getTaskDir,
      listFileInfo,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
