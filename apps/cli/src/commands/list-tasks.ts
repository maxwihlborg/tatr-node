import {
  Array,
  Console,
  Effect,
  Layer,
  Option,
  pipe,
  Result,
  Schema,
  Stream,
  String,
} from "effect";
import { Stdio } from "effect/Stdio";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AppService, FileUtils, Fzf, Printer, Query, ConfigService } from "../services/index.js";
import { unreachable } from "../lib/functions.js";
import { Task } from "../schema.js";

const ListLayer = Layer.mergeAll(AppService.layer, Printer.layer, Fzf.layer).pipe(
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
    // unused: colorette reads process.argv itself, this only teaches the
    // parser about '--color' and '--no-color'
    color: Flag.boolean("color").pipe(
      Flag.withDescription("Colourise the output, --no-color to disable"),
    ),
    format: Flag.choice("format", ["json", "vimgrep", "filepath"]).pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Output format"),
      Flag.optional,
    ),
    status: Flag.choice("status", ["open", "closed", "all"]).pipe(
      Flag.withDescription("Which tasks to list, by their 'closed' front matter"),
      Flag.withDefault("open"),
    ),
    sort: Flag.boolean("sort").pipe(Flag.withDefault(true)),
    order: Flag.atLeast(Flag.string("order"), 1).pipe(
      Flag.withDescription("How to order the tasks"),
      Flag.withDefault(["-priority", "title"]),
      Flag.map((order) => Query.normalize(order, ", ")),
      Flag.map(Option.liftPredicate(String.isNonEmpty)),
    ),
  }),
  Command.withDescription("List tasks in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ query, sort, order, format, status, interactive }) {
      const printer = yield* Printer;
      const stdio = yield* Stdio;
      const config = yield* ConfigService;
      const app = yield* AppService;
      const fzf = yield* Fzf;

      if (interactive) {
        return yield* Effect.scoped(
          Effect.flatMap(config.getTaskDir, (dir) =>
            fzf.runInteractive(dir, { query, order, status }),
          ),
        );
      }

      let program = app.listFileInfo;

      if (status !== "all") {
        const closed = status === "closed";
        program = Stream.filter(program, (task) => task.info.closed === closed);
      }

      if (Option.isSome(query)) {
        const res = yield* Effect.result(Query.compileQuery(query.value));
        if (Result.isFailure(res)) {
          process.exitCode = 1;
          return yield* Console.log(res.failure.message);
        }

        program = Stream.filter(program, Query.filter(res.success));
      }

      if (sort && Option.isSome(order)) {
        const res = yield* Effect.result(Query.compileOrder(order.value));
        if (Result.isFailure(res)) {
          process.exitCode = 1;
          return yield* Console.log(res.failure.message);
        }

        program = pipe(
          Stream.runCollect(program),
          Effect.map((xs) => Stream.fromIterable(Array.sort(xs, res.success))),
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
              Stream.map((info) => `${printer.vimgrep(info)}\n`),
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
