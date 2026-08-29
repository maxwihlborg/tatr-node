import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { listTasks } from "./commands/list-tasks.js";

const cli = pipe(
  Command.make("tatr"), //
  Command.withSubcommands([listTasks]),
);

const main = pipe(
  Command.run(cli, { version: "0.0.0" }), //
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(main);
