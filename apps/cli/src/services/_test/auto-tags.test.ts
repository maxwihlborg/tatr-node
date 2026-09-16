import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { AutoTags } from "../../lib/auto-tags.js";
import { AppService } from "../app-service.js";
import { ConfigService, TatrConfig, type TatrContext } from "../config-service.js";
import { FileUtils } from "../file-utils.js";
import { Formatter } from "../formatter.js";
import { Markers } from "../../lib/marker.js";

const TestLayer = AppService.layer.pipe(
  Layer.provide(Formatter.layer),
  Layer.provide(ConfigService.layer),
  Layer.provide(FileUtils.layer),
  Layer.provide(NodeServices.layer),
);

function contextWith(rules: Record<string, ReadonlyArray<string>>): TatrContext {
  return {
    configPath: "/repo/tatr.config.yaml",
    taskDir: "/repo/tasks",
    config: TatrConfig.make({
      taskDir: "tasks",
      formatter: Option.none(),
      order: [],
      markers: new Markers({}),
      autoTags: new AutoTags(rules),
    }),
  };
}

const tags = (
  rules: Record<string, ReadonlyArray<string>>,
  origins: ReadonlyArray<string>,
  given: Option.Option<ReadonlyArray<string>> = Option.none(),
) =>
  Effect.map(AppService, (app) => app.taggedFor(contextWith(rules), origins, given)).pipe(
    Effect.map(Option.getOrElse(() => [] as ReadonlyArray<string>)),
    Effect.provide(TestLayer),
  );

describe("autoTags", () => {
  it.effect("tags a file by the rule covering it", () =>
    Effect.gen(function* () {
      expect(yield* tags({ "apps/cli": ["cli"] }, ["/repo/apps/cli/src/index.ts"])).toEqual([
        "cli",
      ]);
    }),
  );

  it.effect("stops a prefix at a segment", () =>
    Effect.gen(function* () {
      expect(yield* tags({ "apps/cli": ["cli"] }, ["/repo/apps/cli-legacy/x.ts"])).toEqual([]);
    }),
  );

  it.effect("unions every rule that fires, and both origins", () =>
    Effect.gen(function* () {
      const rules = { apps: ["app"], "apps/cli": ["cli"], "apps/nvim": ["nvim", "app"] };

      expect(yield* tags(rules, ["/repo/apps/cli/x.ts"])).toEqual(["app", "cli"]);
      expect(yield* tags(rules, ["/repo/apps/cli/x.ts", "/repo/apps/nvim/y.lua"])).toEqual([
        "app",
        "cli",
        "nvim",
      ]);
    }),
  );

  it.effect("unions with the tags already given, deduped", () =>
    Effect.gen(function* () {
      const given = Option.some(["cli", "urgent"]);

      expect(yield* tags({ "apps/cli": ["cli"] }, ["/repo/apps/cli/x.ts"], given)).toEqual([
        "cli",
        "urgent",
      ]);
    }),
  );

  it.effect("says nothing for a path outside the repo, or matching no rule", () =>
    Effect.gen(function* () {
      expect(yield* tags({ "apps/cli": ["cli"] }, ["/elsewhere/apps/cli/x.ts"])).toEqual([]);
      expect(yield* tags({ "apps/cli": ["cli"] }, ["/repo/packages/core/x.ts"])).toEqual([]);
      expect(yield* tags({}, ["/repo/apps/cli/x.ts"])).toEqual([]);
    }),
  );

  it.effect("leaves the given tags alone with no origin", () =>
    Effect.gen(function* () {
      expect(yield* tags({ "apps/cli": ["cli"] }, [], Option.some(["typed"]))).toEqual(["typed"]);
    }),
  );
});
