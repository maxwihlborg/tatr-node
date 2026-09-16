import { Console, Effect, FileSystem, Layer, pipe } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { AppService, ConfigService, FileUtils, Formatter } from "../services";

const RemoveLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const removeTask = pipe(
  Command.make("rm", {
    id: Argument.string("id").pipe(
      Argument.withDescription("Id of the task"), //
    ),
  }),
  Command.withDescription("Unlink one task by its id"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id }) {
      const config = yield* ConfigService;
      const app = yield* AppService;
      const fs = yield* FileSystem.FileSystem;

      const context = yield* config.getContext;
      const resolved = yield* app.resolveTaskIn(context.taskDir, id);

      const task = yield* app.readTask(context.taskDir, resolved.file);

      yield* fs.remove(resolved.file);

      return yield* Console.log(`Removed ${task.id}: ${task.info.title}`);
    }),
  ),
  Command.provide(RemoveLayer),
);
