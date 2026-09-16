import { Array, Effect, FileSystem, Option, Order, Schema, Stream, Struct } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { Tool, Toolkit } from "effect/unstable/ai";
import { runCollectSorted } from "../lib/functions.js";
import { AppService, ConfigService, Expr, Mint, Query } from "../services/index.js";
import { TaskDetail, TaskSummary, TaskToolError } from "./schema.js";

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

const Id = Schema.String.annotate({
  description: "The id of the task, which is the name of its file without the extension",
});

const Status = Schema.Literals(["open", "closed", "all"]).pipe(
  Schema.withDecodingDefault(Effect.succeed("open")),
  Schema.annotate({
    description: "Which tasks to list, by their 'closed' front matter. Defaults to open",
  }),
);

class ListTasksParams extends Schema.Opaque<ListTasksParams>()(
  Schema.Struct({
    cwd: Schema.OptionFromOptionalKey(Cwd),
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

      return Option.liftPredicate(
        Array.flatMap(clauses, (clause, index) =>
          index === 0 ? clause : [...clause, Expr.Op.Comp({ op: "and" })],
        ),
        (ops) => Array.isReadonlyArrayNonEmpty(ops),
      );
    });
  }
}

export const ListTasks = Tool.make("list_tasks", {
  description:
    "List the tasks of a tatr repo, in the order the repo is configured to list them, " +
    "highest priority first unless it says otherwise. Filters are combined, " +
    "and a task must carry every tag given to match. Bodies are not included, " +
    "ask for a task by id to read one.",
  parameters: ListTasksParams,
  success: Schema.Struct({ tasks: Schema.Array(TaskSummary) }),
  failure: TaskToolError,
});

export const ShowTask = Tool.make("show_task", {
  description:
    "Read one task of a tatr repo by its id, front matter and body, " +
    "along with the files mentioning that id.",
  parameters: Schema.Struct({
    cwd: Schema.OptionFromOptionalKey(Cwd),
    id: Id,
  }),
  success: TaskDetail,
  failure: TaskToolError,
});

export const CreateTask = Tool.make("create_task", {
  description:
    "Create a task in a tatr repo. The id is minted, the file is named after it. " +
    "Priority defaults to 50, and a higher one is more important. " +
    "Pass the files the task came out of, which the repo may map to tags of its own.",
  parameters: Schema.Struct({
    title: Schema.String.annotate({
      description: "The one line the task is known by",
    }),
    cwd: Schema.OptionFromOptionalKey(Cwd),
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
    files: Schema.Array(Schema.String).pipe(
      Schema.optionalKey,
      Schema.annotate({
        description:
          "Absolute paths of the files the task came out of, which the repo's " +
          "'autoTags' may add tags for. 'cwd' is the repo rather than the file, " +
          "so leaving these out misses those tags",
      }),
    ),
  }),
  success: TaskSummary,
  failure: TaskToolError,
});

export const CloseTask = Tool.make("close_task", {
  description:
    "Close a task of a tatr repo by its id, which sets 'closed: true' in its front matter. " +
    "A task that is already closed is left as it is, and answered for as it stands.",
  parameters: Schema.Struct({
    cwd: Schema.OptionFromOptionalKey(Cwd),
    id: Id,
  }),
  success: TaskSummary,
  failure: TaskToolError,
});

export const TaskToolkit = Toolkit.make(ListTasks, ShowTask, CreateTask, CloseTask);

function toToolError(err: {
  readonly _tag: string;
  readonly message?: string;
  readonly id?: string;
}) {
  return new TaskToolError({
    message: err.message ?? `${err._tag}`,
  });
}

export const TaskHandlers = TaskToolkit.toLayer(
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const mint = yield* Mint;
    const app = yield* AppService;
    const fs = yield* FileSystem.FileSystem;

    function contextOf(root: Option.Option<string>) {
      return config.getContextFromRootUri(Option.getOrElse(root, () => process.cwd()));
    }

    function taskDirOf(root: Option.Option<string>) {
      return Effect.map(contextOf(root), (context) => context.taskDir);
    }

    /** What `rg` searches for references is the repo, not the task dir. */
    function rootDirOf(root: Option.Option<string>) {
      return config.getRootDirFromRootUri(Option.getOrElse(root, () => process.cwd()));
    }

    return TaskToolkit.of({
      list_tasks: Effect.fnUntraced(
        function* (params) {
          const { config: cfg, taskDir } = yield* contextOf(params.cwd);
          const ops = yield* ListTasksParams.compile(params);

          let program = app.listFileInfoIn(taskDir);

          if (Option.isSome(ops)) {
            program = Stream.filter(program, Query.filter(ops.value));
          }

          const tasks = yield* runCollectSorted(program, yield* Query.compileOrder(cfg.order));

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

          if (!(yield* fs.exists(file))) {
            return yield* new TaskToolError({
              message: `No task with id ${params.id} found`,
            });
          }

          const references = yield* app.referencesOf(yield* rootDirOf(params.cwd), params.id).pipe(
            Stream.map((match) => match.file),
            runCollectSorted(Order.String),
            Effect.map(Array.dedupe),
            // A repo without `rg` is still a task we can read
            Effect.orElseSucceed(() => []),
          );

          const task = yield* app.parseFullTask(file);

          return TaskDetail.of(task, references);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      create_task: Effect.fnUntraced(
        function* (params) {
          const context = yield* contextOf(params.cwd);

          const task = yield* app.saveTaskIn(context, yield* mint.nextId, {
            title: params.title,
            tags: app.taggedFor(context, params.files ?? [], Option.fromUndefinedOr(params.tags)),
            priority: Option.fromUndefinedOr(params.priority),
            body: Option.fromUndefinedOr(params.body),
          });

          return TaskSummary.of(task);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      close_task: Effect.fnUntraced(
        function* (params) {
          const context = yield* contextOf(params.cwd);
          const file = config.taskFilePathIn(context.taskDir, params.id);

          if (!(yield* fs.exists(file))) {
            return yield* new TaskToolError({
              message: `No task with id ${params.id} found`,
            });
          }

          const task = yield* app.parseFullTask(file);

          if (!task.info.closed) {
            yield* app.updateTaskInfo(
              context,
              file,
              Struct.evolve({
                closed: () => true,
              }),
            );
          }

          return TaskSummary.of(yield* app.readTask(context.taskDir, file));
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),
    });
  }),
);
