import { Array, Console, Effect, Layer, Stream, pipe } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { Task } from "../schema.js";
import { AppService, ConfigService, FileUtils, Formatter, Query } from "../services/index.js";

const TagLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

const query = Argument.atLeast(Argument.string("query"), 1).pipe(
  Argument.withDescription("Query DSL, which tasks to rewrite"),
  Argument.map((q) => Query.normalize(q, " ")),
);

const tags = Flag.atLeast(Flag.string("tag"), 1).pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Tag to move, repeatable"),
  Flag.map(Array.map((tag) => tag.trim().toLowerCase())),
);

const status = Flag.choice("status", ["open", "closed", "all"]).pipe(
  Flag.withDescription("Which tasks to rewrite, by their 'closed' front matter"),
  Flag.withDefault("open"),
);

interface Rewrite {
  moved(task: Task): ReadonlyArray<string>;
  next(current: ReadonlyArray<string>): ReadonlyArray<string>;
  report(id: string, moved: ReadonlyArray<string>): string;
}

interface TagMoveCommandParams {
  readonly query: string;
  readonly status: "open" | "closed" | "all";
}

/**
 * Bulk writes over whatever the query matches — the same query `ls` takes, so
 * running that first shows exactly what is about to be rewritten.
 */
const rewriteTags = Effect.fnUntraced(function* (params: TagMoveCommandParams, rewrite: Rewrite) {
  const config = yield* ConfigService;
  const app = yield* AppService;

  const context = yield* config.getContext;
  const ops = yield* Query.compileQuery(params.query);

  let program = Stream.filter(app.listFileInfoIn(context.taskDir), Query.filter(ops));

  if (params.status !== "all") {
    const closed = params.status === "closed";
    program = Stream.filter(program, (task) => task.info.closed === closed);
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
