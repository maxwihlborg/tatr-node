import { Array, Console, Effect, Layer, Option, Stream, String, pipe } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { Task } from "../schema.js";
import { AppService, ConfigService, FileUtils, Formatter, Query } from "../services/index.js";

const TagLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

const query = Argument.variadic(Argument.string("query")).pipe(
  Argument.withDescription("Query DSL, which tasks to rewrite"),
  Argument.map((q) => Query.normalize(q, " ")),
  Argument.map(Option.liftPredicate(String.isNonEmpty)),
);

const tags = Flag.atLeast(Flag.string("tag"), 1).pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Tag to move, repeatable"),
  Flag.map(Array.map((tag) => tag.trim().toLowerCase())),
);

const status = Flag.choice("status", ["open", "closed", "all"]).pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Which tasks to rewrite, by their 'closed' front matter"),
  Flag.optional,
);

interface Rewrite {
  moved(task: Task): ReadonlyArray<string>;
  next(current: ReadonlyArray<string>): ReadonlyArray<string>;
  report(id: string, moved: ReadonlyArray<string>): string;
}

interface TagMoveCommandParams {
  readonly query: Option.Option<string>;
  readonly status: Option.Option<"open" | "closed" | "all">;
}

const rewriteTags = Effect.fnUntraced(function* (params: TagMoveCommandParams, rewrite: Rewrite) {
  const config = yield* ConfigService;
  const app = yield* AppService;

  if (Option.isNone(params.query) && Option.isNone(params.status)) {
    process.exitCode = 1;
    return yield* Console.log("Pass a query or a status, tags move on what they match");
  }

  const context = yield* config.getContext;
  const wanted = Option.getOrElse(params.status, () => "open");

  let program = app.listFileInfoIn(context.taskDir);

  if (wanted !== "all") {
    program = Stream.filter(program, (task) => task.info.closed === (wanted === "closed"));
  }

  if (Option.isSome(params.query)) {
    program = Stream.filter(program, Query.filter(yield* Query.compileQuery(params.query.value)));
  }

  const written = yield* pipe(
    program,
    Stream.filter((task) => rewrite.moved(task).length > 0),
    Stream.mapEffect((task) =>
      app
        .updateTaskInfo(context, task.file, (info) => ({
          ...info,
          tags: rewrite.next(info.tags),
        }))
        .pipe(Effect.andThen(Console.log(rewrite.report(task.id, rewrite.moved(task))))),
    ),
    Stream.runCount,
  );

  if (written === 0) {
    yield* Console.log("No task to rewrite");
  }
});

export const tagTasks = pipe(
  Command.make("tag", { query, tags, status }),
  Command.withDescription("Add tags to every task matching a query"),
  Command.withHandler((params) =>
    rewriteTags(params, {
      moved: (task) => Array.difference(params.tags, task.info.tags),
      next: (current) => Array.union(current, params.tags),
      report: (id, added) => `Tagged ${id} with ${added.join(", ")}`,
    }),
  ),
  Command.provide(TagLayer),
);

export const untagTasks = pipe(
  Command.make("untag", { query, tags, status }),
  Command.withDescription("Remove tags from every task matching a query"),
  Command.withHandler((params) =>
    rewriteTags(params, {
      moved: (task) => Array.intersection(params.tags, task.info.tags),
      next: (current) => Array.difference(current, params.tags),
      report: (id, removed) => `Untagged ${id} from ${removed.join(", ")}`,
    }),
  ),
  Command.provide(TagLayer),
);
