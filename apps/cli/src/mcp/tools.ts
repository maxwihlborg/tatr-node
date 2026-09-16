import { Array, Effect, Option, Order, Schema, Stream, Struct } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { runCollectSorted } from "../lib/functions.js";
import type { TaskInfo, TaskWithBody } from "../schema.js";
import { AppService, ConfigService, Expr, Mint, Query, type TatrContext } from "../services/index.js";
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
  description:
    "The id of the task, which is the name of its file without the extension. " +
    "Any suffix long enough to name one task works too, and one that names " +
    "several asks the operator which was meant",
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
}).addDependency(McpSchema.McpServerClient);

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

export const UpdateTask = Tool.make("update_task", {
  description:
    "Change a task of a tatr repo that already exists. Every field but the id is " +
    "optional and an absent one is left as it is. 'body' replaces the whole body, " +
    "so use 'append_task' to add to one rather than re-sending what is not changing. " +
    "Closing a task is 'close_task', not this.",
  parameters: Schema.Struct({
    cwd: Schema.OptionFromOptionalKey(Cwd),
    id: Id,
    title: Schema.String.pipe(
      Schema.optionalKey,
      Schema.annotate({ description: "The one line the task is known by" }),
    ),
    priority: Schema.Int.pipe(
      Schema.optionalKey,
      Schema.annotate({ description: "Priority of the task, a higher one is more important" }),
    ),
    tags: Schema.Array(Schema.String).pipe(
      Schema.optionalKey,
      Schema.annotate({
        description:
          "Tags of the task, replacing the ones it carries rather than adding to them. " +
          "Read the current ones out of 'show_task' first",
      }),
    ),
    body: Schema.String.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Markdown body, replacing the whole of the current one",
      }),
    ),
  }),
  success: TaskSummary,
  failure: TaskToolError,
}).addDependency(McpSchema.McpServerClient);

export const AppendTask = Tool.make("append_task", {
  description:
    "Add to the end of a task's body, which is what writing to a task usually is: " +
    "a measurement, what landed, a correction. Leaves everything above it untouched, " +
    "so nothing already written has to be re-sent.",
  parameters: Schema.Struct({
    cwd: Schema.OptionFromOptionalKey(Cwd),
    id: Id,
    body: Schema.String.annotate({
      description: "Markdown to write under what the task already says",
    }),
  }),
  success: TaskSummary,
  failure: TaskToolError,
}).addDependency(McpSchema.McpServerClient);

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
}).addDependency(McpSchema.McpServerClient);

export const TaskToolkit = Toolkit.make(
  ListTasks,
  ShowTask,
  CreateTask,
  UpdateTask,
  AppendTask,
  CloseTask,
);

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

    function contextOf(root: Option.Option<string>) {
      return config.getContextFromRootUri(Option.getOrElse(root, () => process.cwd()));
    }

    /** What `rg` searches for references is the repo, not the task dir. */
    function rootDirOf(root: Option.Option<string>) {
      return config.getRootDirFromRootUri(Option.getOrElse(root, () => process.cwd()));
    }

    /**
     * An id as the caller spelled it, which may be any suffix long enough to
     * name one task. Several matches are a question for whoever is driving the
     * server rather than a guess, and a client that cannot be asked gets the
     * candidates in the failure instead.
     */
    const resolveTask = Effect.fnUntraced(function* (context: TatrContext, id: string) {
      return yield* app.resolveTaskIn(context.taskDir, id).pipe(
        Effect.catchTag("TaskIdError", (err) => {
          if (err.candidates.length === 0) {
            return new TaskToolError({ message: `No task with id ${id} found` });
          }

          const listed = err.candidates.map((n) => `${n.id}: ${n.title}`);

          return McpServer.elicit({
            message: [`${id} names more than one task, which was meant?`, ...listed].join("\n"),
            schema: Schema.Struct({
              id: Schema.Literals(err.candidates.map((n) => n.id)).annotate({
                title: "Task",
                description: `Which task ${id} was meant to name`,
              }),
            }),
          }).pipe(
            Effect.map((chosen) => ({
              id: chosen.id,
              file: config.taskFilePathIn(context.taskDir, chosen.id),
            })),
            Effect.catchTag(
              "ElicitationDeclined",
              () => new TaskToolError({ message: [`${id} is ambiguous:`, ...listed].join("\n") }),
            ),
          );
        }),
      );
    });

    /**
     * `parseFullTask` hands back a body that starts with the blank line after
     * the closing `---`, so anything replacing one is spelled the same way or
     * the file comes out unlike what `create_task` writes.
     */
    function bodyOf(text: string) {
      return `\n${text.trim()}\n`;
    }

    /** Rewrite a task that has to already exist, and answer with what it became. */
    const writeTask = Effect.fnUntraced(function* (
      cwd: Option.Option<string>,
      id: string,
      update: (task: TaskWithBody) => { info: TaskInfo; body: string },
    ) {
      const context = yield* contextOf(cwd);
      const { file } = yield* resolveTask(context, id);

      yield* app.updateTask(context, file, update);

      return TaskSummary.of(yield* app.readTask(context.taskDir, file));
    });

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
          const { id, file } = yield* resolveTask(yield* contextOf(params.cwd), params.id);

          const references = yield* app.referencesOf(yield* rootDirOf(params.cwd), id).pipe(
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

      update_task: Effect.fnUntraced(
        function* (params) {
          return yield* writeTask(params.cwd, params.id, (task) => ({
            info: {
              ...task.info,
              title: params.title ?? task.info.title,
              priority: params.priority ?? task.info.priority,
              tags: params.tags ?? task.info.tags,
            },
            body: params.body === undefined ? task.body : bodyOf(params.body),
          }));
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      append_task: Effect.fnUntraced(
        function* (params) {
          return yield* writeTask(params.cwd, params.id, (task) => ({
            info: task.info,
            body:
              task.body.trim() === ""
                ? bodyOf(params.body)
                : `${task.body.trimEnd()}\n${bodyOf(params.body)}`,
          }));
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      close_task: Effect.fnUntraced(
        function* (params) {
          const context = yield* contextOf(params.cwd);
          const { file } = yield* resolveTask(context, params.id);

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
