import { Context, Data, Path, Effect, Layer, FileSystem, pipe, Schema } from "effect";
import { FileUtils } from "./file-utils.js";
import { fromYamlString } from "../lib/schema.js";

export const CONFIG_NAME = "tatr.config.yaml";

export type ConfigErrorReason = Data.TaggedEnum<{
  AlreadyExist: { path: string };
  Invalid: { path: string; cause: string };
  NotFound: { name: string };
  TaskDirNotFound: { path: string };
}>;

export const ConfigErrorReason = Data.taggedEnum<ConfigErrorReason>();

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly reason: ConfigErrorReason;
  readonly message: string;
}> {
  constructor(reason: ConfigErrorReason) {
    super({
      reason,
      message: ConfigErrorReason.$match(reason, {
        NotFound: ({ name }) => `No '${name}' found here or in any parent directory`,
        Invalid: ({ path, cause }) => `${path} is not a valid ${CONFIG_NAME}\n\n${cause}\n`,
        AlreadyExist: ({ path }) => `${path} already exists, pass --force to overwrite it`,
        TaskDirNotFound: ({ path }) => `Task dir ${path} is not a directory, run 'tatr init' first`,
      }),
    });
  }
}

export class TatrConfig extends Schema.Opaque<TatrConfig>()(
  Schema.Struct({
    taskDir: Schema.String,
  }),
) {
  static decodeYaml = Schema.decodeEffect(fromYamlString(this));
}

export class ConfigService extends Context.Service<ConfigService>()("@tatr/cli/ConfigService", {
  make: Effect.gen(function* () {
    const path = yield* Path.Path;
    const fu = yield* FileUtils;
    const fs = yield* FileSystem.FileSystem;

    const findConfigPath = yield* pipe(
      fu.findFile(CONFIG_NAME),
      Effect.mapError(() => new ConfigError(ConfigErrorReason.NotFound({ name: CONFIG_NAME }))),
      Effect.cached,
    );

    const getConfig = yield* pipe(
      findConfigPath,
      Effect.flatMap((configPath) =>
        Effect.orDie(fs.readFileString(configPath)).pipe(
          Effect.flatMap(TatrConfig.decodeYaml),
          Effect.mapError((cause) => {
            return new ConfigError(
              ConfigErrorReason.Invalid({ path: configPath, cause: cause.message }),
            );
          }),
        ),
      ),
      Effect.cached,
    );

    const getTaskDir = yield* Effect.Do.pipe(
      Effect.bind("configPath", () => findConfigPath),
      Effect.bind("config", () => getConfig),
      Effect.map(({ configPath, config }) =>
        path.resolve(path.dirname(configPath), config.taskDir),
      ),
      Effect.tap((dirPath) =>
        Effect.when(
          Effect.fail(new ConfigError(ConfigErrorReason.TaskDirNotFound({ path: dirPath }))),
          fs.stat(dirPath).pipe(
            Effect.map((n) => n.type !== "Directory"),
            Effect.orElseSucceed(() => true),
          ),
        ),
      ),
      Effect.cached,
    );

    const initConfig = Effect.fnUntraced(function* (options: { taskDir: string; force: boolean }) {
      const root = yield* Effect.orElseSucceed(
        Effect.map(fu.findDir(".git"), (gitDir) => path.dirname(gitDir)),
        () => process.cwd(),
      );

      const configPath = path.join(root, CONFIG_NAME);

      yield* Effect.when(
        Effect.fail(new ConfigError(ConfigErrorReason.AlreadyExist({ path: configPath }))),
        options.force ? Effect.succeed(false) : fs.exists(configPath),
      );

      const taskDir = path.resolve(root, options.taskDir);

      yield* fs.makeDirectory(taskDir, { recursive: true });
      yield* fs.writeFileString(configPath, `taskDir: ${options.taskDir}\n`);

      return { configPath, taskDir };
    });

    return {
      findConfigPath,
      getTaskDir,
      getConfig,
      initConfig,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
