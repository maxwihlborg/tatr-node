import { Cause, Context, pipe, Data, Effect, Layer, Option, Stream, Struct } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { TaskInfo, type Task } from "../schema.js";
import { ConfigError, ConfigService } from "./config-service.js";
import { FileUtils } from "./file-utils.js";

export class TaskAlreadyExistError extends Data.TaggedError("TaskAlreadyExistError")<{
  readonly id: string;
}> {}

export class TaskError extends Data.TaggedError("TaskError")<{
  readonly file: string;
  readonly cause: unknown;
}> {}

export class AppService extends Context.Service<AppService>()("@tatr/cli/AppService", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fu = yield* FileUtils;
    const path = yield* Path.Path;
    const config = yield* ConfigService;

    const listFiles = Stream.unwrap(
      Effect.map(config.getTaskDir, (root) =>
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
    const State = Data.taggedEnum<State>();

    function extractFrontMatter(file: string) {
      return fs.stream(file).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.scanEffect(State.Opening(), (acc: State, line) => {
          return State.$match(acc, {
            Opening: () => {
              if (line !== "---") {
                return Effect.fail(new Cause.NoSuchElementError());
              }
              return Effect.succeed(State.Inside({ lines: [] }));
            },
            Inside: (s) => {
              if (line !== "---") {
                return Effect.succeed(
                  Struct.evolve(s, {
                    lines: (ls) => ls.concat(line),
                  }),
                );
              }
              return Effect.succeed(State.Done({ matter: s.lines.join("\n") }));
            },
            Done: () => Effect.die("unreachable"),
          });
        }),
        Stream.filter(State.$is("Done")),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption),
        Effect.map((n) => n.matter),
      );
    }

    function readTask(file: string): Effect.Effect<Task, TaskError> {
      return Effect.succeed({ file, id: path.basename(file, ".md") }).pipe(
        Effect.bind("stat", () => fs.stat(file)),
        Effect.bind("info", () => {
          return extractFrontMatter(file).pipe(
            Effect.flatMap(TaskInfo.decodeYaml),
            Effect.tapErrorTag("PlatformError", (err) => {
              return Effect.logError(err);
            }),
            Effect.tapErrorTag("NoSuchElementError", () => {
              return Effect.logError(`${path.relative(process.cwd(), file)}: No frontmatter`);
            }),
            Effect.tapErrorTag("SchemaError", (err) => {
              return Effect.logError(
                `${path.relative(process.cwd(), file)}: Invalid frontmatter\n\n${err.message}\n`,
              );
            }),
          );
        }),
        Effect.catch((cause) => new TaskError({ file, cause })),
      );
    }

    const listFileInfo: Stream.Stream<Task, TaskError | ConfigError | Cause.UnknownError> = pipe(
      listFiles,
      Stream.filterMapEffect((file) => Effect.result(readTask(file))),
    );

    const saveTask = Effect.fnUntraced(function* (
      id: string,
      task: {
        title: string;
        tags: Option.Option<ReadonlyArray<string>>;
        priority: Option.Option<number>;
        body: Option.Option<string>;
      },
    ) {
      const filePath = path.join(yield* config.getTaskDir, `${id}.md`);

      yield* Effect.when(Effect.fail(new TaskAlreadyExistError({ id })), fs.exists(filePath));

      yield* fs.writeFileString(
        filePath,
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

      return yield* readTask(filePath);
    });

    return {
      listFileInfo,
      readTask,
      saveTask,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
