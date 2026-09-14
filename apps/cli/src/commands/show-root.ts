import { Console, Effect, Layer, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { ConfigService, FileUtils } from "../services/index.js";

const RootLayer = ConfigService.layer.pipe(Layer.provide(FileUtils.layer));

export const showRoot = pipe(
  Command.make("root"),
  Command.withDescription("Print the task dir of the enclosing repo"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const config = yield* ConfigService;

      yield* Console.log((yield* config.getContext).taskDir);
    }),
  ),
  Command.provide(RootLayer),
);
