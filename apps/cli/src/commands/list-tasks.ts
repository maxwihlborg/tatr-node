import { Array, Console, Effect, Layer, Option, Path, pipe, Result, String, Stream } from "effect";
import { Stdio } from "effect/Stdio";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { AppService, FileUtils, Printer, Query } from "../services/index.js";

const ListLayer = Layer.mergeAll(AppService.layer, Printer.layer).pipe(
  Layer.provide(FileUtils.layer),
);

function shellQuote(value: string) {
  return `'${value.replaceAll("'", globalThis.String.raw`'\''`)}'`;
}

/**
 * Runs fzf as a live-query front end: fzf does no matching of its own
 * (`--disabled`), every keystroke re-invokes this same binary with the typed
 * query, and the debounce is the conventional `sleep` inside the reload.
 */
function runInteractive(
  taskDir: string,
  options: { query: Option.Option<string>; order: Option.Option<string> },
) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    // --log-level none: the child's skipped-file logs go to fzf's stderr,
    // which is our terminal, and would garble the UI
    const reload = [
      "FORCE_COLOR=1",
      shellQuote(process.argv[0]!),
      shellQuote(path.resolve(process.argv[1]!)),
      "ls",
      "--log-level=none",
      ...Option.match(options.order, {
        onNone: () => [],
        onSome: (n) => [`--order=${shellQuote(n)}`],
      }),
      "{q}",
      "||",
      "true",
    ].join(" ");

    const handle = yield* spawner.spawn(
      ChildProcess.make(
        "fzf",
        [
          "--ansi",
          "--disabled",
          "--layout=reverse",
          "--prompt",
          "tasks> ",
          ...Option.match(options.query, {
            onSome: (q) => ["--query", q],
            onNone: () => [],
          }),
          "--bind",
          `start:reload(${reload})`,
          "--bind",
          `change:reload(sleep 0.15; ${reload})`,
        ],
        {
          // fzf reads keys from /dev/tty, so it needs no stdin of its own
          stdin: "ignore",
          stdout: "inherit", // todo
          stderr: "inherit",
          detached: false,
          cwd: taskDir,
        },
      ),
    );

    yield* handle.exitCode;
  });
}

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

      if (interactive) {
        return yield* Effect.scoped(
          Effect.flatMap(app.getTaskDir, (dir) => runInteractive(dir, { query, order })),
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
