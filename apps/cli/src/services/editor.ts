import { Config, Context, Data, Effect, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { shellQuote } from "../lib/functions.js";

export class EditorError extends Data.TaggedError("EditorError")<{
  readonly editor: Option.Option<string>;
  readonly exitCode: number;
}> {
  override get message() {
    return Option.match(this.editor, {
      onNone: () => "No editor to open with, set $VISUAL or $EDITOR",
      onSome: (editor) => `${editor} exited with ${this.exitCode}`,
    });
  }
}

const editorCommand = Config.NonEmptyString("VISUAL").pipe(
  Config.orElse(() => Config.NonEmptyString("EDITOR")),
  Config.option,
);

export class Editor extends Context.Service<Editor>()("@tatr/cli/Editor", {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const open = Effect.fnUntraced(function* (file: string) {
      const editor = yield* editorCommand;

      if (Option.isNone(editor)) {
        return yield* new EditorError({ editor, exitCode: 1 });
      }

      // `$EDITOR` is a command line rather than a program — `code -w` has to
      // reach `code` with an argument — and a shell already splits one.
      const exitCode = yield* spawner.exitCode(
        ChildProcess.make(`${editor.value} ${shellQuote(file)}`, {
          shell: true,
          // An editor owns the terminal for as long as it runs
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      );

      if (exitCode !== 0) {
        return yield* new EditorError({ editor, exitCode });
      }
    });

    return { open };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
