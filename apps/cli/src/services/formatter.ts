import { Context, Effect, Layer, Option, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createRequire } from "node:module";
import { unreachable } from "../lib/functions.js";
import { ConfigError, ConfigErrorReason, type TatrContext } from "./config-service.js";

/** The two calls made of it, rather than prettier's own types: it is the
 * formatted repo's dependency and not one of ours to import from. */
interface Prettier {
  resolveConfig(file: string): Promise<Record<string, unknown> | null>;
  format(source: string, options: Record<string, unknown>): Promise<string>;
}

export class Formatter extends Context.Service<Formatter>()("@tatr/cli/Formatter", {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const path = yield* Path.Path;

    /** From the repo rather than from this bundle, which is what
     * `import.meta.resolve` would do — it takes no parent to resolve against. */
    function requireFrom(context: TatrContext) {
      return Effect.try(() => createRequire(context.configPath));
    }

    function oxfmtCli(context: TatrContext) {
      return Effect.map(requireFrom(context), (require) =>
        path.join(path.dirname(require.resolve("oxfmt")), "cli.js"),
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

    /**
     * Prettier needs no subprocess: `resolveConfig` does the walk up from the
     * file that oxfmt only does from its cli, so the whole thing is two calls
     * against the repo's own copy.
     */
    const runPrettier = Effect.fnUntraced(function* (
      context: TatrContext,
      file: string,
      text: string,
    ) {
      const require = yield* requireFrom(context);
      const prettier = yield* Effect.try(() => require("prettier") as Prettier);

      return yield* Effect.tryPromise(async () => {
        const config = await prettier.resolveConfig(file);

        return prettier.format(text, { ...config, filepath: file });
      });
    });

    function run(
      context: TatrContext,
      formatter: "oxfmt" | "prettier",
      file: string,
      text: string,
    ) {
      switch (formatter) {
        case "oxfmt": {
          return Effect.scoped(runOxfmt(context, file, text));
        }
        case "prettier": {
          return runPrettier(context, file, text);
        }
        default: {
          return unreachable(formatter);
        }
      }
    }

    function format(context: TatrContext, file: string, text: string) {
      return Option.match(context.config.formatter, {
        onNone: () => Effect.succeed(text),
        onSome: (formatter) =>
          run(context, formatter, file, text).pipe(
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
