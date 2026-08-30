import { Cause, Context, Data, Effect, Layer, Option, Stream, Struct } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { TaskInfo, type Task } from "../schema.js";
import { FileUtils } from "./file-utils.js";

export class TaskAlreadyExistError extends Data.TaggedError("TaskAlreadyExistError")<{
  readonly id: string;
}> {}

export class AppService extends Context.Service<AppService>()("@tatr/cli/AppService", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fu = yield* FileUtils;
    const path = yield* Path.Path;

    const getTaskDir = yield* Effect.cached(
      Effect.flatMap(
        Effect.mapError(
          fu.findDir(".git"),
          () => new Cause.NoSuchElementError("Not in a git repository!"),
        ),
        (gitDir) =>
          fu.findDir("tasks", {
            last: path.dirname(gitDir),
          }),
      ),
    );

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

    const saveTask = Effect.fnUntraced(function* (task: {
      id: string;
      title: string;
      tags: Option.Option<ReadonlyArray<string>>;
      priority: Option.Option<number>;
      body: Option.Option<string>;
    }) {
      const taskPath = path.join(yield* getTaskDir, `${task.id}.md`);

      yield* Effect.when(
        Effect.fail(new TaskAlreadyExistError({ id: task.id })),
        fs.exists(taskPath),
      );

      yield* fs.writeFileString(
        taskPath,
        [
          "---",
          `title: ${task.title}`,
          `priority: ${Option.getOrElse(task.priority, () => 100)}`,
          ...Option.match(task.tags, {
            onNone: () => [],
            onSome: (tags) => [`tags: ${tags.join(", ")}`],
          }),
          "---",
          ...Option.match(task.body, {
            onNone: () => [],
            onSome: (body) => ["", body, ""],
          }),
        ].join("\n"),
      );
    });

    return {
      getTaskDir,
      listFileInfo,
      saveTask,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
