import { Console, Effect, Layer, Option, pipe, Stdio, Stream, String } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { formatFlag, tagFlag } from "../common/flags.js";
import { unreachable } from "../lib/functions.js";
import {
  AppService,
  ConfigService,
  Editor,
  FileUtils,
  Formatter,
  Mint,
} from "../services/index.js";

const NewLayer = Layer.mergeAll(AppService.layer, Editor.layer, Mint.layer).pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const newTask = pipe(
  Command.make("new", {
    title: Argument.atLeast(Argument.String("title"), 1).pipe(
      Argument.withDescription("Title of the task"),
      Argument.map((words) => words.join(" ")),
    ),
    tags: Flag.optional(tagFlag({ description: "Tag the task, repeatable" })),
    priority: Flag.Int("priority").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("Priority of the task"),
      Flag.optional,
    ),
    id: Flag.String("id").pipe(
      Flag.withDescription("Id of the task"), //
      Flag.optional,
    ),
    body: Flag.String("body").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Body of the task"),
      Flag.optional,
    ),
    fromStdin: Flag.Boolean("stdin").pipe(
      Flag.withDescription("Read the body from stdin"),
      Flag.withDefault(false),
    ),
    files: Flag.atLeast(Flag.String("file"), 1).pipe(
      Flag.withDescription("A file the task came out of, for autoTags, repeatable"),
      Flag.optional,
    ),
    format: formatFlag({ values: ["id", "filename"] }).pipe(
      Flag.withDescription("What to print for the created task"), //
    ),
    open: Flag.Boolean("open").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Open the task in $VISUAL or $EDITOR once it is written"),
      Flag.withDefault(false),
    ),
  }),
  Command.withDescription("Create a task in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({
      id,
      title,
      tags,
      priority,
      body,
      fromStdin,
      format,
      open,
      files,
    }) {
      const app = yield* AppService;
      const config = yield* ConfigService;
      const editor = yield* Editor;
      const mint = yield* Mint;
      const stdio = yield* Stdio.Stdio;

      const context = yield* config.getContext;

      const readStdin = pipe(
        stdio.stdin,
        Stream.decodeText(),
        Stream.mkString,
        Effect.map((text) => Option.liftPredicate(text.trim(), String.isNonEmpty)),
      );

      const task = yield* app.saveTaskIn(
        context,
        yield* Effect.catch(Effect.fromOption(id), () => mint.nextId),
        {
          title,
          tags: app.taggedFor(
            context,
            Option.getOrElse(files, () => []),
            tags,
          ),
          priority,
          body: fromStdin ? Option.orElse(yield* readStdin, () => body) : body,
        },
      );

      // After the write and the formatter, and before the line naming it, so
      // what an editor leaves on the screen is not the last thing printed
      if (open) {
        yield* editor.open(task.file);
      }

      switch (format) {
        case "filename": {
          return yield* Console.log(task.file);
        }
        case "id": {
          return yield* Console.log(task.id);
        }
        default: {
          unreachable(format);
        }
      }
    }),
  ),
  Command.provide(NewLayer),
);
