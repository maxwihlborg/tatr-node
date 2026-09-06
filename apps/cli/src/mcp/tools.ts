import { Array, Effect, FileSystem, Option, Schema, Stream } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { Tool, Toolkit } from "effect/unstable/ai";
import { runCollectSorted } from "../lib/functions.js";
import { TaskWithBody } from "../schema.js";
import { AppService, ConfigService, Expr, Mint, Query } from "../services/index.js";
import { TaskSummary, TaskToolError } from "./schema.js";

/**
 * Where to look. A server is started once and asked about whatever repo the
 * agent is working in, so the caller says which that is rather than the process
 * deciding for it.
 */
const Cwd = Schema.String.annotate({
  description:
    "Absolute path of the directory to resolve tatr.config.yaml from, " +
    "normally the repo you are working in. Defaults to where the server was started.",
});

const Status = Schema.Literals(["open", "closed", "all"]).pipe(
  Schema.withDecodingDefault(Effect.succeed("open")),
  Schema.annotate({
    description: "Which tasks to list, by their 'closed' front matter. Defaults to open",
  }),
);

class ListTasksParams extends Schema.Opaque<ListTasksParams>()(
  Schema.Struct({
    cwd: Schema.OptionFromOptional(Cwd),
    tags: Schema.Array(Schema.String).pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Only tasks carrying every one of these tags, matched case insensitively",
      }),
    ),
    minPriority: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Only tasks at this priority or above",
      }),
    ),
    maxPriority: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Only tasks at this priority or below",
      }),
    ),
    status: Status,
    limit: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Keep only this many of the most important tasks",
      }),
    ),
  }),
) {
  /**
   * The filters as the query the cli would have been given, so one stack
   * machine answers both. Nothing to filter on reads as nothing, rather than as
   * a query matching everything.
   *
   * `Comp` pops its right operand first, so a clause reads `prio <op> value`.
   */
  static compile(
    params: ListTasksParams,
  ): Effect.Effect<Option.Option<NonEmptyReadonlyArray<Expr.Op>>, TaskToolError> {
    return Effect.gen(function* () {
      if (
        params.minPriority !== undefined &&
        params.maxPriority !== undefined &&
        params.minPriority > params.maxPriority
      ) {
        return yield* new TaskToolError({
          message:
            `minPriority ${params.minPriority} is above ` +
            `maxPriority ${params.maxPriority}, so no task can match`,
        });
      }

      const clauses: Expr.Op[][] = [];

      if (params.status !== "all") {
        clauses.push([
          Expr.Op.Closed(),
          Expr.Op.Bool({ value: true }),
          Expr.Op.Comp({ op: params.status === "closed" ? "eq" : "neq" }),
        ]);
      }

      if (params.minPriority !== undefined) {
        clauses.push([
          Expr.Op.Prio(),
          Expr.Op.Int({ value: params.minPriority }),
          Expr.Op.Comp({ op: "gte" }),
        ]);
      }

      if (params.maxPriority !== undefined) {
        clauses.push([
          Expr.Op.Prio(),
          Expr.Op.Int({ value: params.maxPriority }),
          Expr.Op.Comp({ op: "lte" }),
        ]);
      }

      for (const tag of params.tags ?? []) {
        clauses.push([Expr.Op.Tag({ tag: tag.trim().toLowerCase() })]);
      }

      const ops = Array.flatMap(clauses, (clause, index) =>
        index === 0 ? clause : [...clause, Expr.Op.Comp({ op: "and" })],
      );

      return Option.liftPredicate(ops, (xs) => Array.isReadonlyArrayNonEmpty(xs));
    });
  }
}

export const ListTasks = Tool.make("list_tasks", {
  description:
    "List the tasks of a tatr repo, highest priority first. Filters are combined, " +
    "and a task must carry every tag given to match. Bodies are not included, " +
    "ask for a task by id to read one.",
  parameters: ListTasksParams,
  success: Schema.Struct({ tasks: Schema.Array(TaskSummary) }),
  failure: TaskToolError,
});

export const ShowTask = Tool.make("show_task", {
  description: "Read one task of a tatr repo by its id, front matter and body.",
  parameters: Schema.Struct({
    cwd: Schema.OptionFromOptional(Cwd),
    id: Schema.String.annotate({
      description: "The id of the task, which is the name of its file without the extension",
    }),
  }),
  success: TaskWithBody,
  failure: TaskToolError,
});

export const CreateTask = Tool.make("create_task", {
  description:
    "Create a task in a tatr repo. The id is minted, the file is named after it. " +
    "Priority defaults to 50, and a higher one is more important.",
  parameters: Schema.Struct({
    title: Schema.String.annotate({
      description: "The one line the task is known by",
    }),
    cwd: Schema.OptionFromOptional(Cwd),
    tags: Schema.Array(Schema.String).pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Tags of the task, lowercased when it is read back",
      }),
    ),
    priority: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Priority of the task, 50 when left out",
      }),
    ),
    body: Schema.String.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Markdown body, written under the front matter",
      }),
    ),
  }),
  success: TaskSummary,
  failure: TaskToolError,
});

export const TaskToolkit = Toolkit.make(ListTasks, ShowTask, CreateTask);

/** Every reason a tool has to give up, as the one sentence the agent is shown. */
function toToolError(err: {
  readonly _tag: string;
  readonly message?: string;
  readonly id?: string;
}) {
  return new TaskToolError({ message: err.message ?? `${err._tag}` });
}

export const TaskHandlers = TaskToolkit.toLayer(
  Effect.gen(function* () {
    const app = yield* AppService;
    const config = yield* ConfigService;
    const fs = yield* FileSystem.FileSystem;
    const mint = yield* Mint;

    const order = yield* Query.compileOrder(["-priority", "title"]);

    function taskDirOf(root: Option.Option<string>) {
      return config.getTaskDirFromRootUri(Option.getOrElse(root, () => process.cwd()));
    }

    return {
      list_tasks: Effect.fnUntraced(
        function* (params) {
          const taskDir = yield* taskDirOf(params.cwd);
          const ops = yield* ListTasksParams.compile(params);

          let program = app
            .listFilesIn(taskDir)
            .pipe(Stream.filterMapEffect((file) => Effect.result(app.readTask(file))));

          if (Option.isSome(ops)) {
            program = Stream.filter(program, Query.filter(ops.value));
          }

          const tasks = yield* runCollectSorted(program, order);

          return {
            tasks: Array.map(
              params.limit === undefined ? tasks : Array.take(tasks, params.limit),
              TaskSummary.of,
            ),
          };
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      show_task: Effect.fnUntraced(
        function* (params) {
          const taskDir = yield* taskDirOf(params.cwd);
          const file = config.taskFilePathIn(taskDir, params.id);

          // Said plainly, rather than as the failure to open a file the agent
          // never asked for by name
          if (!(yield* fs.exists(file))) {
            return yield* new TaskToolError({
              message: `No task with id ${params.id} found`,
            });
          }

          return yield* app.parseFullTask(file);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      create_task: Effect.fnUntraced(
        function* (params) {
          const taskDir = yield* taskDirOf(params.cwd);

          const task = yield* app.saveTaskIn(taskDir, yield* mint.nextId, {
            title: params.title,
            tags: Option.fromUndefinedOr(params.tags),
            priority: Option.fromUndefinedOr(params.priority),
            body: Option.fromUndefinedOr(params.body),
          });

          return TaskSummary.of(task);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),
    };
  }),
);
