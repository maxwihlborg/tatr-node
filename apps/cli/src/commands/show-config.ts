import { Console, Effect, Layer, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { ConfigService, FileUtils, TatrConfig } from "../services/index.js";

const ConfigLayer = ConfigService.layer.pipe(Layer.provide(FileUtils.layer));

export const showConfig = pipe(
  Command.make("config"),
  Command.withDescription("Print the config of the enclosing repo as json, defaults filled in"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const config = yield* ConfigService;

      yield* Console.log(yield* TatrConfig.encodeJson(yield* config.getConfig));
    }),
  ),
  Command.provide(ConfigLayer),
);
