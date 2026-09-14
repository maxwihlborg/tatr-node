import { Array, Console, Effect, Layer, Option, pipe, Schema, Stream, String } from "effect";
import { Stdio } from "effect/Stdio";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AppService, FileUtils, Formatter, Fzf, Printer, Query, ConfigService } from "../services/index.js";
import { unreachable } from "../lib/functions.js";
import { Task } from "../schema.js";

const ListLayer = Layer.mergeAll(AppService.layer, Printer.layer, Fzf.layer).pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const listTasks = pipe(
  Command.make("ls", {
    query: Argument.variadic(Argument.string("query")).pipe(
      Argument.withDescription("Query DSL"),
      Argument.map((q) => Query.normalize(q, " ")),
      Argument.map(Option.liftPredicate(String.isNonEmpty)),
    ),
    interactive: Flag.boolean("fzf"),
    color: Flag.boolean("color").pipe(
      Flag.withDescription("Colourise the output, --no-color to disable"),
    ),
    format: Flag.choice("format", ["json", "vimgrep", "filepath"]).pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Output format"),
      Flag.optional,
    ),
    status: Flag.choice("status", ["open", "closed", "all"]).pipe(
      Flag.withAlias("s"),
      Flag.withDescription("Which tasks to list, by their 'closed' front matter"),
      Flag.withDefault("open"),
    ),
    sort: Flag.boolean("sort").pipe(Flag.withDefault(true)),
    order: Flag.atLeast(Flag.string("order"), 1).pipe(
      Flag.withAlias("o"),
      Flag.withDescription("How to order the tasks, defaults to the config's 'order'"),
      Flag.optional,
    ),
  }),
  Command.withDescription("List tasks in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ query, sort, order: orderFlag, format, status, interactive }) {
      const printer = yield* Printer;
      const stdio = yield* Stdio;
      const config = yield* ConfigService;
      const app = yield* AppService;
      const fzf = yield* Fzf;

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

      if (Option.isSome(format)) {
        switch (format.value) {
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
            unreachable(format.value);
          }
        }
      }

      yield* pipe(
        program,
        Stream.map((info) => `${printer.showTask(info)}\n`),
        Stream.run(stdio.stdout({ endOnDone: true })),
      );
    }),
  ),
  Command.provide(ListLayer),
);
