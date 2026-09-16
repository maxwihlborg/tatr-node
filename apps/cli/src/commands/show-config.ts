import { Console, Effect, Layer, pipe, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { ConfigService, FileUtils, TatrConfig } from "../services/index.js";

const ConfigLayer = ConfigService.layer.pipe(Layer.provide(FileUtils.layer));

class ConfigOutput extends Schema.Opaque<ConfigOutput>()(
  Schema.Struct({
    config: TatrConfig,
    root: Schema.String,
  }),
) {
  static encodeJson = Schema.encodeEffect(Schema.fromJsonString(this, { space: 2 }));
}

export const showConfig = pipe(
  Command.make("config"),
  Command.withDescription("Print the config of the enclosing repo as json, defaults filled in"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const config = yield* ConfigService;
      const context = yield* config.getContext;

      yield* Console.log(
        yield* ConfigOutput.encodeJson({ config: context.config, root: context.taskDir }),
      );
    }),
  ),
  Command.provide(ConfigLayer),
);
