import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { initConfig } from "./commands/init-config.js";
import { listTasks } from "./commands/list-tasks.js";
import { mintId } from "./commands/mint-id.js";
import { newTask } from "./commands/new-task.js";
import { showRoot } from "./commands/show-root.js";
import { showTask } from "./commands/show-task.js";
import { lspStart } from "./lsp/index.js";

const cli = pipe(
  Command.make("tatr"), //
  Command.withSubcommands([initConfig, listTasks, lspStart, mintId, newTask, showRoot, showTask]),
);

function abort(message: string) {
  return Effect.flatMap(Console.error(message), () =>
    Effect.sync(() => {
      process.exitCode = 1;
    }),
  );
}

const main = pipe(
  Command.run(cli, { version: __VERSION__ }),
  Effect.catch((err) => {
    switch (err._tag) {
      case "ConfigError":
      case "CompileError": {
        return abort(err.message);
      }
      case "TaskAlreadyExistError": {
        return abort(`A task with id ${err.id} already exists`);
      }
      case "TaskError": {
        return abort(`Could not read ${err.file}`);
      }
      case "TaskParseError": {
        return abort(err.message);
      }
    }

    return Effect.die(err);
  }),
  Effect.provide(NodeServices.layer),
);

declare global {
  const __VERSION__: string;
}

NodeRuntime.runMain(main);
