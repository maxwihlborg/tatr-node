import { Context, Effect, Layer, Option, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createRequire } from "node:module";
import { ConfigError, ConfigErrorReason, type TatrContext } from "./config-service.js";

export class Formatter extends Context.Service<Formatter>()("@tatr/cli/Formatter", {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const path = yield* Path.Path;

    /** From the repo rather than from this bundle, which is what
     * `import.meta.resolve` would do — it takes no parent to resolve against. */
    function oxfmtCli(context: TatrContext) {
      return Effect.try(() =>
        path.join(
          path.dirname(createRequire(context.configPath).resolve("oxfmt")),
          "cli.js",
        ),
      );
    }

    function invalid(context: TatrContext, cause: string) {
      return new ConfigError(
        ConfigErrorReason.Invalid({ path: context.configPath, cause: `formatter: ${cause}` }),
      );
    }

    /**
     * Through the cli rather than the `oxfmt` api: only the cli resolves
     * `.oxfmtrc.json`, and it resolves it by walking up from the file it is
     * told about, so a task is formatted the way its own repo formats tasks.
     */
    const runOxfmt = Effect.fnUntraced(function* (
      context: TatrContext,
      file: string,
      text: string,
    ) {
      const cli = yield* oxfmtCli(context);

      const handle = yield* spawner.spawn(
        ChildProcess.make(process.execPath, [cli, "--stdin-filepath", file], {
          stdin: Stream.make(new TextEncoder().encode(text)),
          stdout: "pipe",
          stderr: "pipe",
        }),
      );

      // before the exit code, or a task long enough to fill the pipe buffer
      // would wedge the child waiting for someone to read it
      const formatted = yield* Stream.mkString(Stream.decodeText(handle.stdout));
      const exitCode = yield* handle.exitCode;

      if (exitCode !== 0) {
        const stderr = yield* Stream.mkString(Stream.decodeText(handle.stderr));
        return yield* invalid(context, `oxfmt exited ${exitCode}\n\n${stderr.trim()}`);
      }

      return formatted;
    });

    function format(context: TatrContext, file: string, text: string) {
      return Option.match(context.config.formatter, {
        onNone: () => Effect.succeed(text),
        onSome: () =>
          Effect.scoped(runOxfmt(context, file, text)).pipe(
            Effect.catchTag("PlatformError", (err) => invalid(context, err.message)),
            Effect.catchTag("UnknownError", (err) => invalid(context, `${err.cause}`)),
          ),
      });
    }

    return { format };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
