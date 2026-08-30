import { Console, Effect, Layer, pipe } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AppService, FileUtils, Mint } from "../services/index.js";

const NewLayer = Layer.mergeAll(AppService.layer, Mint.layer).pipe(Layer.provide(FileUtils.layer));

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
    body: Flag.string("body").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Body of the task"),
      Flag.optional,
    ),
  }),
  Command.withDescription("Create a task in the repo"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ title, tags, priority, body }) {
      const app = yield* AppService;
      const mint = yield* Mint;

      const id = yield* mint.nextId;

      yield* app.saveTask({ id, title, tags, priority, body });
      yield* Console.log(id);
    }),
  ),
  Command.provide(NewLayer),
);
