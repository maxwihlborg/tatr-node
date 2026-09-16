import { Console, Effect, FileSystem, Layer, Option, Stream, String, pipe } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AppService, ConfigService, FileUtils, Formatter, Query } from "../services/index.js";

const PruneLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const pruneTasks = pipe(
  Command.make("prune", {
    query: Argument.variadic(Argument.string("query")).pipe(
      Argument.withDescription("Query DSL, which tasks to unlink"),
      Argument.map((q) => Query.normalize(q, " ")),
      Argument.map(Option.liftPredicate(String.isNonEmpty)),
    ),
    status: Flag.choice("status", ["open", "closed", "all"]).pipe(
      Flag.withAlias("s"),
      Flag.withDescription("Which tasks to unlink, by their 'closed' front matter"),
      Flag.optional,
    ),
  }),
  Command.withDescription("Unlink the task files matching a query"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ query, status }) {
      const config = yield* ConfigService;
      const app = yield* AppService;
      const fs = yield* FileSystem.FileSystem;

      if (Option.isNone(query) && Option.isNone(status)) {
        process.exitCode = 1;
        return yield* Console.log("Pass a query or a status, prune unlinks what they match");
      }

      const { taskDir } = yield* config.getContext;
      const wanted = Option.getOrElse(status, () => "open");

      let program = app.listFileInfoIn(taskDir);

      if (wanted !== "all") {
        program = Stream.filter(program, (task) => task.info.closed === (wanted === "closed"));
      }

      if (Option.isSome(query)) {
        program = Stream.filter(program, Query.filter(yield* Query.compileQuery(query.value)));
      }

      const unlinked = yield* pipe(
        program,
        Stream.mapEffect((task) =>
          Effect.andThen(fs.remove(task.file), Console.log(`Unlinked ${task.id}`)),
        ),
        Stream.runCount,
      );

      if (unlinked === 0) {
        yield* Console.log("No task to prune");
      }
    }),
  ),
  Command.provide(PruneLayer),
);
