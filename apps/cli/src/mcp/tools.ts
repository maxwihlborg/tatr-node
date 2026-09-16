import { Array, Effect, Option, Order, Result, Schema, Stream, Struct } from "effect";
import type { NonEmptyReadonlyArray } from "effect/Array";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { runCollectSorted } from "../lib/functions.js";
import { applyPatch } from "../lib/patch.js";
import {
  AppService,
  ConfigService,
  Expr,
  Mint,
  Query,
  type TatrContext,
} from "../services/index.js";
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
  success: TaskDetail,
  failure: TaskToolError,
});

const Anchor = (what: string) =>
  Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      `${what} Whitespace is elastic, so a run of it matches a run of any length and ` +
      "an anchor carries across the line the formatter wrapped it at. Must match the " +
      "current body exactly once.",
  });

const Patch = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("replace"),
    old_string: Anchor("Text to replace."),
    new_string: Schema.String.annotate({
      description: "Replacement text. Empty string deletes the match",
    }),
    replace_all: Schema.Boolean.pipe(
      Schema.optionalKey,
      Schema.annotate({
        description: "Replace every occurrence instead of requiring a unique match",
      }),
    ),
  }),
  Schema.Struct({
    op: Schema.Literal("insert_before"),
    anchor: Anchor("Text to insert before."),
    text: Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        "Written directly before the anchor, verbatim. Include separators, e.g. '\\n\\n'",
    }),
  }),
  Schema.Struct({
    op: Schema.Literal("insert_after"),
    anchor: Anchor("Text to insert after."),
    text: Schema.String.check(Schema.isMinLength(1)).annotate({
      description: "Written directly after the anchor, verbatim. Include separators, e.g. '\\n\\n'",
    }),
  }),
  Schema.Struct({
    op: Schema.Literal("prepend"),
    text: Schema.String.check(Schema.isMinLength(1)).annotate({
      description: "Written at the very start of the body, verbatim. Include separators",
    }),
  }),
  Schema.Struct({
    op: Schema.Literal("append"),
    text: Schema.String.check(Schema.isMinLength(1)).annotate({
      description: "Written at the very end of the body, verbatim. Include separators",
    }),
  }),
  Schema.Struct({
    op: Schema.Literal("replace_range"),
    from: Anchor("Text the range starts at, inclusive."),
    to: Anchor("Text the range ends at, exclusive — it stays where it is. Matched after 'from'."),
    new_string: Schema.String.annotate({
      description: "Text replacing the range. Empty string deletes it",
    }),
  }),
]);

export const UpdateTask = Tool.make("update_task", {
  description:
    "Change a task of a tatr repo that already exists. Every field but the id is " +
    "optional and an absent one is left as it is. 'body' replaces the whole body; " +
    "'patch' edits it in place instead, which is what to reach for rather than " +
    "re-sending prose that is not changing. Closing a task is 'close_task', not this.",
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
    patch: Schema.Array(Patch).pipe(
      Schema.check(Schema.isLengthBetween(1, 50)),
      Schema.optionalKey,
      Schema.annotate({
        description:
          "Edits applied to the current body, in order and atomically — one failing op " +
          "aborts the whole save. Given in place of 'body', never alongside it. Prefer " +
          "'replace_range' for anything large: two short anchors each sit inside a line, " +
          "where one long 'old_string' is bound to cross several",
      }),
    ),
  }),
  success: TaskDetail,
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
  success: TaskDetail,
  failure: TaskToolError,
}).addDependency(McpSchema.McpServerClient);

export const TaskToolkit = Toolkit.make(ListTasks, ShowTask, CreateTask, UpdateTask, CloseTask);

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
     * A task as every tool that reads or writes one answers with it: the body
     * included, because the formatter rewrites what was sent and the text that
     * landed is what the next patch has to anchor against.
     */
    const detailOf = Effect.fnUntraced(function* (
      cwd: Option.Option<string>,
      id: string,
      file: string,
    ) {
      const references = yield* app.referencesOf(yield* rootDirOf(cwd), id).pipe(
        Stream.map((match) => match.file),
        runCollectSorted(Order.String),
        Effect.map(Array.dedupe),
        // A repo without `rg` is still a task we can read
        Effect.orElseSucceed(() => []),
      );

      return TaskDetail.of(yield* app.parseFullTask(file), references);
    });

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

          return yield* detailOf(params.cwd, id, file);
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

          return yield* detailOf(params.cwd, task.id, task.file);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      update_task: Effect.fnUntraced(
        function* (params) {
          if (params.body !== undefined && params.patch !== undefined) {
            return yield* new TaskToolError({
              message: "Pass 'body' to replace the whole of it or 'patch' to edit it, not both",
            });
          }

          const context = yield* contextOf(params.cwd);
          const { id, file } = yield* resolveTask(context, params.id);
          const task = yield* app.parseFullTask(file);

          // The ops see the body without the blank line the front matter leaves
          // behind, so `prepend` means what it says and every anchor lines up
          // with what `show_task` handed over.
          const patched =
            params.patch === undefined ? undefined : applyPatch(task.body.trim(), params.patch);

          if (patched !== undefined && Result.isFailure(patched)) {
            return yield* new TaskToolError({ message: patched.failure.message });
          }

          yield* app.updateTask(context, file, () => ({
            info: {
              ...task.info,
              title: params.title ?? task.info.title,
              priority: params.priority ?? task.info.priority,
              tags: params.tags ?? task.info.tags,
            },
            body:
              patched !== undefined
                ? bodyOf(patched.success)
                : params.body === undefined
                  ? task.body
                  : bodyOf(params.body),
          }));

          return yield* detailOf(params.cwd, id, file);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),

      close_task: Effect.fnUntraced(
        function* (params) {
          const context = yield* contextOf(params.cwd);
          const { id, file } = yield* resolveTask(context, params.id);

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

          return yield* detailOf(params.cwd, id, file);
        },
        Effect.catch((err) => Effect.fail(toToolError(err))),
      ),
    });
  }),
);
