import { Context, Effect, Layer, Option, Path } from "effect";
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
      options: { query: Option.Option<string>; order: Option.Option<string> },
    ) {
      return Effect.gen(function* () {
        const path = yield* Path.Path;

        // --log-level none: the child's skipped-file logs go to fzf's stderr,
        // which is our terminal, and would garble the UI
        const reload = [
          "FORCE_COLOR=1",
          shellQuote(process.argv[0]!),
          shellQuote(path.resolve(process.argv[1]!)),
          "ls",
          "--log-level=none",
          ...mapOption(options.order, (n) => [`--order=${shellQuote(n)}`]),
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
              ...mapOption(options.query, (q) => ["--query", q]),
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

    return {
      runInteractive,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
