import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { listTasks } from "./commands/list-tasks.js";
import { newTask } from "./commands/new-task.js";

const cli = pipe(
  Command.make("tatr"), //
  Command.withSubcommands([listTasks, newTask]),
);

const main = pipe(
  Command.run(cli, { version: __VERSION__ }), //
  Effect.provide(NodeServices.layer),
);

declare global {
  const __VERSION__: string;
}

NodeRuntime.runMain(main);
