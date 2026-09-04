import { Console, Context, Effect, Layer, Option, Path, pipe, Stream, String } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { shellQuote } from "../lib/functions";

export class Fzf extends Context.Service<Fzf>()("@tatr/cli/Fzf", {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    function mapOption<A>(
      arg: Option.Option<A>,
      fn: (a: A) => ReadonlyArray<string>,
    ): ReadonlyArray<string> {
      return Option.match(arg, {
        onNone: () => [],
        onSome: (a) => fn(a),
      });
    }

    function runInteractive(
      taskDir: string,
      options: {
        query: Option.Option<string>;
        order: Option.Option<string>;
        status: "open" | "closed" | "all";
      },
    ) {
      return Effect.gen(function* () {
        const path = yield* Path.Path;

        // --log-level none: the child's skipped-file logs go to fzf's stderr,
        // which is our terminal, and would garble the UI
        const reload = [
          shellQuote(process.argv[0]!),
          shellQuote(path.resolve(process.argv[1]!)),
          "ls",
          "--color",
          "--log-level=none",
          `--status=${options.status}`,
          ...mapOption(options.order, (n) => [`--order=${shellQuote(n)}`]),
          "{q}",
          // a query that does not compile is reported on stderr, show it in
          // the list instead of over the ui
          "2>&1",
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
              ...mapOption(options.query, (q) => ["--query", q]),
              "--bind",
              `start:reload(${reload})`,
              "--bind",
              `change:reload(sleep 0.15; ${reload})`,
            ],
            {
              // fzf reads keys from /dev/tty, so it needs no stdin of its own
              stdin: "ignore",
              stdout: "pipe", // todo
              stderr: "inherit",
              detached: false,
              cwd: taskDir,
            },
          ),
        );

        const out = yield* pipe(
          handle.stdout,
          Stream.decodeText(),
          Stream.mkString,
          Effect.map((line) =>
            Option.map(Option.liftPredicate(line.trim(), String.isNonEmpty), (n) =>
              n.slice(0, n.indexOf(":")),
            ),
          ),
        );

        if (Option.isNone(out)) {
          process.exitCode = 1;
        } else {
          yield* Console.log(out.value);
        }
      });
    }

    return {
      runInteractive,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
