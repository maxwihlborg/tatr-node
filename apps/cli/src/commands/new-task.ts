import { Console, Effect, Layer, Option, pipe, Stdio, Stream, String } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AppService, ConfigService, FileUtils, Formatter, Mint } from "../services/index.js";
import { unreachable } from "../lib/functions.js";

const NewLayer = Layer.mergeAll(AppService.layer, Mint.layer).pipe(
  Layer.provide(Formatter.layer),
  Layer.provideMerge(ConfigService.layer),
  Layer.provide(FileUtils.layer),
);

export const newTask = pipe(
  Command.make("new", {
    title: Argument.atLeast(Argument.string("title"), 1).pipe(
      Argument.withDescription("Title of the task"),
      Argument.map((words) => words.join(" ")),
    ),
    tags: Flag.atLeast(Flag.string("tag"), 1).pipe(
      Flag.withAlias("t"),
      Flag.withDescription("Tag the task, repeatable"),
      Flag.optional,
    ),
    priority: Flag.integer("priority").pipe(
      Flag.withAlias("p"),
      Flag.withDescription("Priority of the task"),
      Flag.optional,
    ),
    id: Flag.string("id").pipe(
      Flag.withDescription("Id of the task"), //
      Flag.optional,
    ),
    body: Flag.string("body").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Body of the task"),
      Flag.optional,
    ),
    fromStdin: Flag.boolean("stdin").pipe(
      Flag.withDescription("Read the body from stdin"),
    ),
    format: Flag.choice("format", ["filename", "id"]).pipe(
      Flag.withAlias("f"),
      Flag.withDescription("What to print for the created task"),
      Flag.withDefault("filename"),
    ),
  }),
  Command.withDescription("Create a task in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, title, tags, priority, body, fromStdin, format }) {
      const app = yield* AppService;
      const config = yield* ConfigService;
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
          tags,
          priority,
          body: fromStdin ? Option.orElse(yield* readStdin, () => body) : body,
        },
      );

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
