import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { closeTask } from "./commands/close-task.js";
import { initConfig } from "./commands/init-config.js";
import { listTasks } from "./commands/list-tasks.js";
import { mintId } from "./commands/mint-id.js";
import { newTask } from "./commands/new-task.js";
import { pruneTasks } from "./commands/prune-tasks.js";
import { showConfig } from "./commands/show-config.js";
import { showTask } from "./commands/show-task.js";
import { lspStart } from "./commands/start-lsp.js";
import { mcpStart } from "./commands/start-mcp.js";
import { tagTasks, untagTasks } from "./commands/tag-tasks.js";

const cli = pipe(
  Command.make("tatr"), //
  Command.withSubcommands([
    closeTask,
    initConfig,
    listTasks,
    lspStart,
    mcpStart,
    mintId,
    newTask,
    pruneTasks,
    showConfig,
    showTask,
    tagTasks,
    untagTasks,
  ]),
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
      case "CompileError":
      // writing a task back is an encode, and a task that will not encode is
      // one the caller has to hear about rather than a defect
      case "SchemaError": {
        return abort(err.message);
      }
      case "TaskAlreadyExistError": {
        return abort(`A task with id ${err.id} already exists`);
      }
      case "TaskIdError": {
        return abort(err.message);
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
