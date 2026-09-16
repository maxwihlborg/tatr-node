import { Effect, Layer, pipe } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { AppService, ConfigService, Editor, FileUtils, Formatter } from "../services/index.js";

const OpenLayer = Layer.mergeAll(AppService.layer, Editor.layer).pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const openTask = pipe(
  Command.make("open", {
    id: pipe(
      Argument.string("id"), //
      Argument.withDescription("Id of the task"),
    ),
  }),
  Command.withDescription("Open a task in $VISUAL or $EDITOR"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id }) {
      const config = yield* ConfigService;
      const app = yield* AppService;
      const editor = yield* Editor;

      const context = yield* config.getContext;
      const resolved = yield* app.resolveTaskIn(context.taskDir, id);

      yield* editor.open(resolved.file);
    }),
  ),
  Command.provide(OpenLayer),
);
