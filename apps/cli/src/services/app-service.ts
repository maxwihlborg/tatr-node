import {
  Cause,
  Context,
  String,
  pipe,
  Data,
  Effect,
  Layer,
  Option,
  Stream,
  Struct,
  SchemaError,
  PlatformError,
} from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { TaskInfo, type Task, TaskWithBody } from "../schema.js";
import { ConfigError, ConfigService } from "./config-service.js";
import { FileUtils } from "./file-utils.js";

export class TaskAlreadyExistError extends Data.TaggedError("TaskAlreadyExistError")<{
  readonly id: string;
}> {}

export type TaskParseErrorReason = Data.TaggedEnum<{
  YamlParseError: { cause: SchemaError.SchemaError };
  PlatformError: { cause: PlatformError.PlatformError };
  Invalid: { message: string };
}>;
export const TaskParseErrorReason = Data.taggedEnum<TaskParseErrorReason>();

export class TaskParseError extends Data.TaggedError("TaskParseError")<{
  file: string;
  reason: TaskParseErrorReason;
}> {
  override get message() {
    return `${this.file}: ${TaskParseErrorReason.$match(this.reason, {
      Invalid: (reason) => reason.message,
      YamlParseError: (reason) => reason.cause.message,
      PlatformError: (reason) => reason.cause.message,
    })}`;
  }
}

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

    function listFilesIn(root: string) {
      return fu.glob(config.globPattern, {
        cwd: root,
        absolute: true,
      });
    }

    const listFiles = Stream.unwrap(Effect.map(config.getTaskDir, listFilesIn));

    type State = Data.TaggedEnum<{
      Opening: {};
      Inside: { lines: string[] };
      Done: { matter: string };
    }>;
    const State = Data.taggedEnum<State>();

    function fileLines(file: string) {
      return fs.stream(file).pipe(Stream.decodeText(), Stream.splitLines);
    }

    function extractFrontMatter<E, R>(lines: Stream.Stream<string, E, R>) {
      return lines.pipe(
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
      return Effect.succeed({ file, id: config.taskIdOf(file) }).pipe(
        Effect.bind("stat", () => fs.stat(file)),
        Effect.bind("info", () => {
          return extractFrontMatter(fileLines(file)).pipe(
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

    /** `listFileInfo` for a task dir the caller already knows. */
    /**
     * The front matter of a task the caller already holds the text of, for
     * readers with a copy fresher than the file, such as an editor buffer.
     */
    function parseTask(file: string, text: string) {
      return Effect.succeed({ file, id: config.taskIdOf(file) }).pipe(
        Effect.bind("info", () =>
          pipe(
            Stream.succeed(text),
            Stream.splitLines,
            extractFrontMatter,
            Effect.flatMap(TaskInfo.decodeYaml),
          ),
        ),
        Effect.catch((cause) => new TaskError({ file, cause })),
      );
    }

    function parseFullTask(file: string) {
      type State = Data.TaggedEnum<{
        Open: {};
        Header: {
          content: string;
        };
        Task: {
          id: string;
          file: string;
          info: TaskInfo;
          body: string;
        };
      }>;
      const State = Data.taggedEnum<State>();

      return fs.stream(file).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runFoldEffect(
          (): State => State.Open(),
          (acc, line) => {
            return State.$match(acc, {
              Open: () => {
                if (line !== "---") {
                  return Effect.fail(
                    new TaskParseError({
                      file,
                      reason: TaskParseErrorReason.Invalid({
                        message: "No yaml frontmatter",
                      }),
                    }),
                  );
                }
                return Effect.succeed(
                  State.Header({
                    content: "",
                  }),
                );
              },
              Header: (header) => {
                if (line !== "---") {
                  return Effect.succeed(
                    Struct.evolve(header, {
                      content: String.concat(line + "\n"),
                    }),
                  );
                }
                return Effect.mapBoth(TaskInfo.decodeYaml(header.content), {
                  onSuccess: (info) =>
                    State.Task({
                      id: config.taskIdOf(file),
                      file,
                      info: info,
                      body: "",
                    }),
                  onFailure: (err) =>
                    new TaskParseError({
                      file,
                      reason: TaskParseErrorReason.YamlParseError({
                        cause: err,
                      }),
                    }),
                });
              },
              Task: (b) => {
                return Effect.succeed(
                  Struct.evolve(b, {
                    body: String.concat(line + "\n"),
                  }),
                );
              },
            });
          },
        ),
        Effect.catchTag("PlatformError", (cause) =>
          Effect.fail(
            new TaskParseError({
              file,
              reason: TaskParseErrorReason.PlatformError({
                cause,
              }),
            }),
          ),
        ),
        Effect.filterOrFail(
          State.$is("Task"),
          () =>
            new TaskParseError({
              file,
              reason: TaskParseErrorReason.Invalid({
                message: "No closing frontmatter",
              }),
            }),
        ),
        Effect.map((content) =>
          TaskWithBody.make(
            Struct.evolve(content, {
              body: String.trim,
            }),
          ),
        ),
      );
    }

    const listFileInfo: Stream.Stream<Task, TaskError | ConfigError | Cause.UnknownError> = pipe(
      listFiles,
      Stream.filterMapEffect((file) => Effect.result(readTask(file))),
    );

    interface TaskFields {
      title: string;
      tags: Option.Option<ReadonlyArray<string>>;
      priority: Option.Option<number>;
      body: Option.Option<string>;
    }

    function formatTask(task: TaskFields) {
      return [
        "---",
        `title: ${JSON.stringify(task.title)}`,
        `priority: ${Option.getOrElse(task.priority, () => 50)}`,
        ...Option.match(task.tags, {
          onNone: () => [],
          onSome: (tags) => [`tags: ${tags.join(", ")}`],
        }),
        "---",
        ...Option.match(task.body, {
          onNone: () => [],
          onSome: (body) => ["", body, ""],
        }),
        "\n",
      ].join("\n");
    }

    const saveTask = Effect.fnUntraced(function* (id: string, task: TaskFields) {
      const filePath = yield* config.getTaskFilePath(id);

      yield* Effect.when(Effect.fail(new TaskAlreadyExistError({ id })), fs.exists(filePath));

      yield* fs.writeFileString(filePath, formatTask(task));

      return yield* readTask(filePath);
    });

    return {
      formatTask,
      listFileInfo,
      listFilesIn,
      parseFullTask,
      parseTask,
      readTask,
      saveTask,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
