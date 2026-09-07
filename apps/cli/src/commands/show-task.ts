import { Console, Effect, FileSystem, Layer, pipe } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { unreachable } from "../lib/functions";
import { AppService, ConfigService, FileUtils, Printer } from "../services";

const ShowLayer = Layer.mergeAll(AppService.layer, Printer.layer).pipe(
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const showTask = pipe(
  Command.make("show", {
    id: pipe(
      Argument.string("id"), //
      Argument.withDescription("Id of the task"),
    ),
    format: pipe(
      Flag.choice("format", ["body", "json", "agent", "filepath"]),
      Flag.withAlias("f"),
      Flag.withDescription("Output format"),
      Flag.withDefault("body"),
    ),
  }),
  Command.withDescription("Print the body of a task, front matter stripped"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, format }) {
      const config = yield* ConfigService;
      const fs = yield* FileSystem.FileSystem;
      const app = yield* AppService;
      const printer = yield* Printer;

      const filePath = yield* config.getTaskFilePath(id);

      if (!(yield* fs.exists(filePath))) {
        process.exitCode = 1;
        return yield* Console.log(`No task with id ${id} found!`);
      }

      // Before the parse: where a task lives is answerable even when what it
      // holds is not, and that is the answer an editor jumping to it wants.
      if (format === "filepath") {
        return yield* Console.log(filePath);
      }

      const task = yield* app.parseFullTask(filePath);

      switch (format) {
        case "body": {
          return yield* Console.log(task.body.trim());
        }
        case "json": {
          return yield* Console.log(JSON.stringify(task));
        }
        case "agent": {
          return yield* Console.log(printer.agentTask(task));
        }
        default: {
          unreachable(format);
        }
      }
    }),
  ),
  Command.provide(ShowLayer),
);
