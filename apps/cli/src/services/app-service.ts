import {
  Array,
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
import { matchingIds } from "../lib/abbrev.js";
import { normalizeCrock32 } from "../lib/schema.js";
import { idAt } from "../lib/marker.js";
import { TaskInfo, type Task, TaskWithBody } from "../schema.js";
import { ConfigService, type TatrContext } from "./config-service.js";
import { Formatter } from "./formatter.js";
import { FileUtils } from "./file-utils.js";

export class TaskAlreadyExistError extends Data.TaggedError("TaskAlreadyExistError")<{
  readonly id: string;
}> {}

export class TaskIdError extends Data.TaggedError("TaskIdError")<{
  readonly id: string;
  readonly candidates: ReadonlyArray<{ id: string; title: string }>;
}> {
  override get message() {
    if (this.candidates.length === 0) {
      return `No task with id ${this.id} found!`;
    }
    return [
      `${this.id} is ambiguous, it could be any of:`,
      ...this.candidates.map((n) => `  ${n.id}: ${n.title}`),
    ].join("\n");
  }
}

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

/** What a task reads as when its front matter does not: a row that sorts above
 * everything else and says what is wrong with it. */
function broken(message: string) {
  return TaskInfo.make({
    title: `!! BROKEN, ${message} !!`,
    priority: 999,
    tags: [],
    closed: false,
  });
}

export class AppService extends Context.Service<AppService>()("@tatr/cli/AppService", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fu = yield* FileUtils;
    const path = yield* Path.Path;
    const config = yield* ConfigService;
    const formatter = yield* Formatter;

    function listFilesIn(root: string) {
      return fu.glob(config.globPattern, {
        cwd: root,
        absolute: true,
      });
    }

    /**
     * The tags a task gets for having come out of `origins`, unioned with the
     * ones already given. Relative to the config, never the cwd — the lsp and
     * the mcp server answer for a repo they are not standing in — and matched
     * by `relative`, so a rule stops at a segment and `apps/cli` has nothing to
     * say about `apps/cli-legacy`.
     */
    function taggedFor(
      context: TatrContext,
      origins: ReadonlyArray<string>,
      given: Option.Option<ReadonlyArray<string>>,
    ): Option.Option<ReadonlyArray<string>> {
      const root = path.dirname(context.configPath);
      const rules = Object.entries(context.config.autoTags.rules);

      const auto = origins.flatMap((origin) => {
        const file = path.relative(root, path.resolve(origin));

        return rules.flatMap(([rule, tags]) =>
          path.relative(rule, file).startsWith("..") ? [] : tags,
        );
      });

      return Option.liftPredicate(
        Array.dedupe([...Option.getOrElse(given, () => []), ...auto]),
        Array.isReadonlyArrayNonEmpty,
      );
    }

    function listTaskIdsIn(taskDir: string) {
      return Stream.runCollect(Stream.map(listFilesIn(taskDir), config.taskIdOf));
    }

    /**
     * An id as typed, which may be any suffix long enough to name one task.
     * Closed tasks count, or closing one would quietly hand its abbreviation
     * to something else.
     */
    const resolveTaskIn = Effect.fnUntraced(function* (taskDir: string, input: string) {
      const exact = config.taskFilePathIn(taskDir, input);

      if (normalizeCrock32(input) === input && (yield* fs.exists(exact))) {
        return { id: input, file: exact };
      }

      const matches = matchingIds(yield* listTaskIdsIn(taskDir), input);

      if (matches.length === 1) {
        const id = matches[0]!;
        return { id, file: config.taskFilePathIn(taskDir, id) };
      }

      return yield* new TaskIdError({
        id: input,
        candidates: yield* Effect.forEach(matches, (id) =>
          Effect.map(readTask(taskDir, config.taskFilePathIn(taskDir, id)), (task) => ({
            id,
            title: task.info.title,
          })),
        ),
      });
    });

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

    function readTask(taskDir: string, file: string): Effect.Effect<Task, TaskError> {
      return Effect.succeed({ file, id: config.taskIdOf(file) }).pipe(
        Effect.bind("stat", () => fs.stat(file)),
        Effect.bind("info", () => {
          return extractFrontMatter(fileLines(file)).pipe(
            Effect.flatMap(TaskInfo.decodeYaml),
            Effect.catchTag("NoSuchElementError", () =>
              Effect.succeed(broken("MISSING FRONTMATTER")),
            ),
            Effect.catchTag("SchemaError", () => Effect.succeed(broken("INVALID FRONTMATTER"))),
            Effect.tapErrorTag("PlatformError", (err) => {
              return Effect.logError(`${path.relative(taskDir, file)}: ${err.message}`);
            }),
          );
        }),
        Effect.catch((cause) => new TaskError({ file, cause })),
      );
    }

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
        Effect.map((content) => TaskWithBody.make(content)),
      );
    }

    function referencesOf(root: string, id: string) {
      return Stream.filter(fu.grep(id, root), (match) =>
        Option.contains(idAt(match.text, match.character), id),
      );
    }

    function listFileInfoIn(taskDir: string): Stream.Stream<Task, TaskError | Cause.UnknownError> {
      return pipe(
        listFilesIn(taskDir),
        Stream.filterMapEffect((file) => Effect.result(readTask(taskDir, file))),
      );
    }

    interface TaskFields {
      title: string;
      tags: Option.Option<ReadonlyArray<string>>;
      priority: Option.Option<number>;
      body: Option.Option<string>;
    }

    function formatTask(task: TaskFields) {
      return Effect.map(
        TaskInfo.encodeYaml({
          title: task.title,
          priority: Option.getOrElse(task.priority, () => 50),
          closed: false,
          tags: Option.getOrElse(task.tags, () => []),
        }),
        (matter) =>
          [
            "---",
            matter.trimEnd(),
            "---",
            ...Option.match(task.body, {
              onNone: () => [],
              onSome: (body) => ["", body.trim(), ""],
            }),
            "\n",
          ].join("\n"),
      );
    }

    const saveTaskIn = Effect.fnUntraced(function* (
      context: TatrContext,
      id: string,
      task: TaskFields,
    ) {
      const filePath = config.taskFilePathIn(context.taskDir, id);

      yield* Effect.when(Effect.fail(new TaskAlreadyExistError({ id })), fs.exists(filePath));

      yield* formatTask(task).pipe(
        Effect.flatMap((text) => formatter.format(context, filePath, text)),
        Effect.flatMap((text) => fs.writeFileString(filePath, text)),
      );

      return yield* readTask(context.taskDir, filePath);
    });

    const updateTaskInfo = Effect.fnUntraced(function* (
      context: TatrContext,
      file: string,
      update: (info: TaskInfo) => TaskInfo,
    ) {
      const task = yield* parseFullTask(file);

      yield* TaskInfo.encodeYaml(update(task.info)).pipe(
        Effect.map((matter) => ["---", matter.trimEnd(), "---", task.body].join("\n")),
        Effect.flatMap((text) => formatter.format(context, file, text)),
        Effect.flatMap((text) => fs.writeFileString(file, text)),
      );
    });

    return {
      formatTask,
      listFileInfoIn,
      listFilesIn,
      listTaskIdsIn,
      parseFullTask,
      parseTask,
      readTask,
      referencesOf,
      resolveTaskIn,
      taggedFor,
      saveTaskIn,
      updateTaskInfo,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
