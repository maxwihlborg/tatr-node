import { Console, Effect, Layer, pipe } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ConfigService, FileUtils } from "../services/index.js";

const InitLayer = ConfigService.layer.pipe(Layer.provide(FileUtils.layer));

export const initConfig = pipe(
  Command.make("init", {
    taskDir: Flag.string("task-dir").pipe(
      Flag.withDescription("Where to store tasks, relative to the config file"),
      Flag.withDefault("./tasks"),
    ),
    force: Flag.boolean("force").pipe(
      Flag.withDescription(`Overwrite an existing config`),
    ),
  }),
  Command.withDescription("Create a tatr.config.yaml in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ taskDir, force }) {
      const config = yield* ConfigService;

      const created = yield* config.initConfig({ taskDir, force });

      yield* Console.log(created.configPath);
      yield* Console.log(created.taskDir);
    }),
  ),
  Command.provide(InitLayer),
);
