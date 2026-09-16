import { describe, expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Option } from "effect";
import { AutoTags } from "../../lib/auto-tags.js";
import { Markers } from "../../lib/marker.js";
import { AppService } from "../app-service.js";
import { ConfigService, TatrConfig, type TatrContext } from "../config-service.js";
import { FileUtils } from "../file-utils.js";
import { Formatter } from "../formatter.js";

const TestLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provide(ConfigService.layer),
  Layer.provide(FileUtils.layer),
  Layer.provideMerge(NodeServices.layer),
);

/** A repo of one task, in a directory that goes away with the test. */
const withTask = Effect.fnUntraced(function* (body: Option.Option<string>) {
  const fs = yield* FileSystem.FileSystem;
  const app = yield* AppService;
  const taskDir = yield* fs.makeTempDirectoryScoped();

  const context: TatrContext = {
    configPath: `${taskDir}/tatr.config.yaml`,
    taskDir,
    config: TatrConfig.make({
      taskDir: ".",
      formatter: Option.none(),
      order: [],
      markers: new Markers({}),
      autoTags: new AutoTags({}),
    }),
  };

  const task = yield* app.saveTaskIn(context, "DABPE001081G8", {
    title: "A task",
    tags: Option.some(["one"]),
    priority: Option.none(),
    body,
  });

  return { context, file: task.file, read: () => fs.readFileString(task.file) };
});

describe("updateTask", () => {
  it.effect("leaves a file it changes nothing in byte for byte", () =>
    Effect.gen(function* () {
      const app = yield* AppService;
      const { context, file, read } = yield* withTask(Option.some("The body."));
      const before = yield* read();

      yield* app.updateTask(context, file, (task) => task);

      expect(yield* read()).toBe(before);
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );

  it.effect("writes a replaced body the way a created one is written", () =>
    Effect.gen(function* () {
      const app = yield* AppService;
      const written = yield* withTask(Option.some("The body."));
      const expected = yield* withTask(Option.some("Something else."));

      yield* app.updateTask(written.context, written.file, (task) => ({
        info: task.info,
        body: "\nSomething else.\n",
      }));

      // Trailing whitespace aside: `formatTask` ends a new file with blank
      // lines a rewrite has no reason to reproduce, and the formatter that runs
      // over both takes them off anyway.
      expect((yield* written.read()).trimEnd()).toBe((yield* expected.read()).trimEnd());
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );

  it.effect("appends under what is already there", () =>
    Effect.gen(function* () {
      const app = yield* AppService;
      const { context, file, read } = yield* withTask(Option.some("The body."));

      yield* app.updateTask(context, file, (task) => ({
        info: task.info,
        body: `${task.body.trimEnd()}\n\nA correction.\n`,
      }));

      expect(yield* read()).toContain("The body.\n\nA correction.\n");
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );

  it.effect("keeps front matter keys outside the schema", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const app = yield* AppService;
      const { context, file, read } = yield* withTask(Option.some("The body."));

      yield* fs.writeFileString(file, (yield* read()).replace("title:", "author: max\ntitle:"));

      yield* app.updateTask(context, file, (task) => ({
        info: { ...task.info, title: "Renamed" },
        body: task.body,
      }));

      const after = yield* read();

      expect(after).toContain("author: max");
      expect(after).toContain("title: Renamed");
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
  );
});
