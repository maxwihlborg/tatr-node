import { Console, Effect, FileSystem, Layer, Option, Stream, pipe } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { queryArgument, statusFlag } from "../common/flags.js";
import { AppService, ConfigService, FileUtils, Formatter, Query } from "../services/index.js";

const PruneLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const pruneTasks = pipe(
  Command.make("prune", {
    query: queryArgument({ description: "Query DSL, which tasks to unlink" }),
    status: Flag.optional(
      statusFlag({ description: "Which tasks to unlink, by their 'closed' front matter" }),
    ),
  }),
  Command.withDescription("Unlink the task files matching a query or a --status, one is required"),
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
