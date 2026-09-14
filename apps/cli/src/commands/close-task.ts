import { Console, Effect, Layer, Struct, pipe } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { AppService, ConfigService, FileUtils, Formatter } from "../services";

const CloseLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
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
      const app = yield* AppService;

      const context = yield* config.getContext;
      const resolved = yield* app.resolveTaskIn(context.taskDir, id);
      const filePath = resolved.file;

      const task = yield* app.parseFullTask(filePath);

      if (task.info.closed) {
        return yield* Console.log(`Task ${resolved.id} is already closed`);
      }

      yield* app.updateTaskInfo(
        context,
        filePath,
        Struct.evolve({
          closed: () => true,
        }),
      );

      return yield* Console.log(`Closed ${resolved.id}`);
    }),
  ),
  Command.provide(CloseLayer),
);
