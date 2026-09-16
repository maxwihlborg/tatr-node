#!/usr/bin/env -S node --experimental-strip-types
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Path, Schema } from "effect";
import { Prompt } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** What `npm stage list --json` answers with, per npm's own `logStageItem`. */
class StageItem extends Schema.Opaque<StageItem>()(
  Schema.Struct({
    id: Schema.String,
    packageName: Schema.String,
    version: Schema.String,
    tag: Schema.String,
    status: Schema.optionalKey(Schema.String),
  }),
) {
  static decodeJsonArray = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(this)));
}

const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;

  // npm run from the repo root dies on the root manifest's `devEngines`, so
  // every call is made from the package being published.
  const cwd = path.dirname(import.meta.dirname);

  const staged = yield* StageItem.decodeJsonArray(
    yield* spawner.string(
      ChildProcess.make("npm", ["stage", "list", "--json"], {
        cwd,
      }),
    ),
  );

  if (staged.length === 0) {
    return yield* Console.log("Nothing staged.");
  }

  const chosen =
    staged.length === 1
      ? staged[0]!
      : yield* Prompt.run(
          Prompt.Select({
            message: "Which staged version?",
            choices: staged.map((one) => ({
              title: `${one.packageName}@${one.version}`,
              description: [one.tag, one.status].filter(Boolean).join(", "),
              value: one,
            })),
          }),
        );

  const otp = yield* Prompt.run(
    Prompt.String({
      message: `One time password to approve ${chosen.packageName}@${chosen.version}`,
      validate: (value) =>
        /^\d{6}$/.test(value.trim()) ? Effect.succeed(value.trim()) : Effect.fail("Six digits"),
    }),
  );

  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("npm", ["stage", "approve", chosen.id, "--otp", otp], {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );

  if (exitCode !== 0) {
    process.exitCode = 1;
  }
});

NodeRuntime.runMain(Effect.provide(program, NodeServices.layer));
