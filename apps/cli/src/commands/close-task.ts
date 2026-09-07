import { Console, Effect, FileSystem, Layer, Struct, pipe } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { AppService, ConfigService, FileUtils } from "../services";

const CloseLayer = AppService.layer.pipe(
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const closeTask = pipe(
  Command.make("close", {
    id: pipe(
      Argument.string("id"), //
      Argument.withDescription("Id of the task"),
    ),
  }),
  Command.withDescription("Mark a task as closed"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id }) {
      const config = yield* ConfigService;
      const fs = yield* FileSystem.FileSystem;
      const app = yield* AppService;

      const filePath = yield* config.getTaskFilePath(id);

      if (!(yield* fs.exists(filePath))) {
        process.exitCode = 1;
        return yield* Console.log(`No task with id ${id} found!`);
      }

      const task = yield* app.parseFullTask(filePath);

      if (task.info.closed) {
        return yield* Console.log(`Task ${id} is already closed`);
      }

      yield* app.updateTaskInfo(
        filePath,
        Struct.evolve({
          closed: () => true,
        }),
      );

      return yield* Console.log(`Closed ${id}`);
    }),
  ),
  Command.provide(CloseLayer),
);
