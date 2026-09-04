import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { initConfig } from "./commands/init-config.js";
import { listTasks } from "./commands/list-tasks.js";
import { mintId } from "./commands/mint-id.js";
import { newTask } from "./commands/new-task.js";
import { previewTask } from "./commands/preview-task.js";
import { showRoot } from "./commands/show-root.js";

const cli = pipe(
  Command.make("tatr"), //
  Command.withSubcommands([initConfig, listTasks, mintId, newTask, previewTask, showRoot]),
);

const main = pipe(
  Command.run(cli, { version: __VERSION__ }), //
  Effect.provide(NodeServices.layer),
);

declare global {
  const __VERSION__: string;
}

NodeRuntime.runMain(main);
