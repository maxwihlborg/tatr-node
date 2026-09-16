import { Array, Console, Effect, Layer, Option, pipe, Schema, Stream, String } from "effect";
import { Stdio } from "effect/Stdio";
import { Command, Flag } from "effect/unstable/cli";
import {
  AppService,
  FileUtils,
  Formatter,
  Fzf,
  Printer,
  Query,
  ConfigService,
} from "../services/index.js";
import { formatFlag, queryArgument, statusFlag } from "../common/flags.js";
import { shortestUniqueSuffixes } from "../lib/abbrev.js";
import { unreachable } from "../lib/functions.js";
import { Task } from "../schema.js";

const ListLayer = Layer.mergeAll(AppService.layer, Printer.layer, Fzf.layer).pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const listTasks = pipe(
  Command.make("ls", {
    query: queryArgument({ description: "Query DSL" }),
    interactive: Flag.Boolean("fzf").pipe(Flag.withDefault(false)),
    color: Flag.Boolean("color").pipe(
      Flag.withDescription("Colourise the output, --no-color to disable"),
      Flag.withDefault(false),
    ),
    format: formatFlag({ values: ["pretty", "json", "vimgrep", "filepath"] }),
    status: Flag.withDefault(
      statusFlag({
        description: "Which tasks to list, by their 'closed' front matter",
      }),
      "open",
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withAlias("a"),
      Flag.withDescription("Closed tasks too, the same as --status all"),
      Flag.withDefault(false),
    ),
    sort: Flag.Boolean("sort").pipe(Flag.withDefault(true)),
    order: Flag.atLeast(Flag.String("order"), 1).pipe(
      Flag.withAlias("o"),
      Flag.withDescription("How to order the tasks, defaults to the config's 'order'"),
      Flag.optional,
    ),
  }),
  Command.withDescription("List tasks in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({
      query,
      sort,
      order: orderFlag,
      format,
      status: statusFlag,
      all,
      interactive,
    }) {
      const printer = yield* Printer;
      const stdio = yield* Stdio;
      const config = yield* ConfigService;
      const app = yield* AppService;
      const fzf = yield* Fzf;

      const status = all ? "all" : statusFlag;
      const { config: cfg, taskDir } = yield* config.getContext;

      const order = pipe(
        Option.orElse(orderFlag, () => Option.some(cfg.order)),
        Option.map((n) => Query.normalize(n, ", ")),
        Option.flatMap(Option.liftPredicate(String.isNonEmpty)),
      );

      if (interactive) {
        return yield* Effect.scoped(fzf.runInteractive(taskDir, { query, order, status }));
      }

      let program = app.listFileInfoIn(taskDir);

      if (status !== "all") {
        const closed = status === "closed";
        program = Stream.filter(program, (task) => task.info.closed === closed);
      }

      if (Option.isSome(query)) {
        program = Stream.filter(program, Query.filter(yield* Query.compileQuery(query.value)));
      }

      if (sort && Option.isSome(order)) {
        const compare = yield* Query.compileOrder(order.value);

        program = pipe(
          Stream.runCollect(program),
          Effect.map((xs) => Stream.fromIterable(Array.sort(xs, compare))),
          Stream.unwrap,
        );
      }

      switch (format) {
        case "pretty": {
          // Over every id in the dir, not just the listed ones: an abbreviation
          // the query happened to filter out of view still has to reach its own
          // task.
          const unique = shortestUniqueSuffixes(yield* app.listTaskIdsIn(taskDir));

          return yield* pipe(
            program,
            Stream.map((info) => `${printer.showTask(info, unique.get(info.id))}\n`),
            Stream.run(stdio.stdout({ endOnDone: true })),
          );
        }
        case "json": {
          return yield* pipe(
            Stream.runCollect(program),
            Effect.flatMap(Schema.encodeEffect(Schema.toCodecJson(Schema.Array(Task)))),
            Effect.flatMap((tasks) => Console.log(JSON.stringify(tasks))),
          );
        }
        case "vimgrep": {
          return yield* pipe(
            program,
            // relative to where the command ran, which is what an editor's
            // :grep expects to be able to jump from
            Stream.map((info) => `${printer.vimgrep(process.cwd(), info)}\n`),
            Stream.run(stdio.stdout({ endOnDone: true })),
          );
        }
        case "filepath": {
          return yield* pipe(
            program,
            Stream.map((info) => `${info.file}\n`),
            Stream.run(stdio.stdout({ endOnDone: true })),
          );
        }
        default: {
          unreachable(format);
        }
      }
    }),
  ),
  Command.provide(ListLayer),
);
