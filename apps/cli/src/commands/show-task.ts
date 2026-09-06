import {
  Console,
  Data,
  Effect,
  FileSystem,
  Layer,
  Path,
  pipe,
  Stdio,
  Stream,
  String,
} from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ConfigService, FileUtils } from "../services";
import { unreachable } from "../lib/functions";

const ShowLayer = ConfigService.layer.pipe(Layer.provide(FileUtils.layer));

export const showTask = pipe(
  Command.make("show", {
    id: pipe(
      Argument.string("id"), //
      Argument.withDescription("Id of the task"),
    ),
    resolvePath: pipe(
      Flag.boolean("resolve-path"),
      Flag.withDescription("Print the path of the task instead of its body"),
    ),
  }),
  Command.withDescription("Print the body of a task, front matter stripped"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, resolvePath }) {
      const config = yield* ConfigService;
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const stdio = yield* Stdio.Stdio;

      const root = yield* config.getTaskDir;

      const filePath = path.resolve(root, `${id}.md`);

      if (!(yield* fs.exists(filePath))) {
        process.exitCode = 1;
        return yield* Console.log(`No task with id ${id} found!`);
      }

      if (resolvePath) {
        return yield* Console.log(filePath);
      } else {
        type State = Data.TaggedEnum<{
          Open: {};
          Skip: {};
          Print: {};
        }>;
        const State = Data.taggedEnum<State>();

        let state: State = State.Open();

        yield* fs.stream(filePath).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => {
            switch (state._tag) {
              case "Print":
                return true;
              case "Open": {
                if (line === "---") {
                  state = State.Skip();
                  return false;
                } else {
                  state = State.Print();
                  return true;
                }
              }
              case "Skip": {
                if (line === "---") {
                  state = State.Print();
                }
                return false;
              }
              default: {
                unreachable(state);
              }
            }
          }),
          Stream.dropWhile((line) => String.isEmpty(line.trim())),
          Stream.map((line) => `${line}\n`),
          Stream.run(stdio.stdout({ endOnDone: true })),
        );
      }
    }),
  ),
  Command.provide(ShowLayer),
);
