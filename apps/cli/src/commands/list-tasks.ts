import { Array, Console, Effect, Layer, Option, pipe, Result, Stream, String } from "effect";
import { Stdio } from "effect/Stdio";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AppService, FileUtils, Fzf, Printer, Query } from "../services/index.js";

const ListLayer = Layer.mergeAll(AppService.layer, Printer.layer, Fzf.layer).pipe(
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
    Effect.fnUntraced(function* ({ query, sort, order, interactive }) {
      const printer = yield* Printer;
      const stdio = yield* Stdio;
      const app = yield* AppService;
      const fzf = yield* Fzf;

      if (interactive) {
        return yield* Effect.scoped(
          Effect.flatMap(app.getTaskDir, (dir) => fzf.runInteractive(dir, { query, order })),
        );
      }

      let program = app.listFileInfo;

      if (Option.isSome(query)) {
        const res = yield* Effect.result(Query.compileQuery(query.value));
        if (Result.isFailure(res)) {
          return yield* Console.log(res.failure.message);
        }

        program = Stream.filter(program, Query.filter(res.success));
      }

      if (sort && Option.isSome(order)) {
        const res = yield* Effect.result(Query.compileOrder(order.value));
        if (Result.isFailure(res)) {
          return yield* Console.log(res.failure.message);
        }

        program = pipe(
          Stream.runCollect(program),
          Effect.map((xs) => Stream.fromIterable(Array.sort(xs, res.success))),
          Stream.unwrap,
        );
      }

      yield* pipe(
        program,
        Stream.map((info) => `${printer.showTask(info)}\n`),
        Stream.run(stdio.stdout()),
      );
    }),
  ),
  Command.provide(ListLayer),
);
