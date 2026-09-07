import { Context, Data, Path, Effect, Layer, FileSystem, pipe, Schema, Option } from "effect";
import { FileUtils } from "./file-utils.js";
import { fromYamlString } from "../lib/schema.js";

export const CONFIG_NAME = "tatr.config.yaml";

/** A task is a markdown file in the task dir named after its id. Local on
 * purpose: the day this comes out of the config, everything that depends on it
 * is already here. */
const TASK_EXT = ".md";

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
    formatter: Schema.OptionFromOptionalKey(Schema.Literal("oxfmt")),
  }),
) {
  static decodeYaml = Schema.decodeEffect(fromYamlString(this));
}

export class ConfigService extends Context.Service<ConfigService>()("@tatr/cli/ConfigService", {
  make: Effect.gen(function* () {
    const path = yield* Path.Path;
    const fu = yield* FileUtils;
    const fs = yield* FileSystem.FileSystem;

    function findConfigPathFrom(rootUri?: string) {
      return Effect.mapError(
        fu.findFile(CONFIG_NAME, { cwd: rootUri }),
        () => new ConfigError(ConfigErrorReason.NotFound({ name: CONFIG_NAME })),
      );
    }

    function readConfigFrom(configPath: string) {
      return Effect.orDie(fs.readFileString(configPath)).pipe(
        Effect.flatMap(TatrConfig.decodeYaml),
        Effect.mapError((cause) => {
          return new ConfigError(
            ConfigErrorReason.Invalid({ path: configPath, cause: cause.message }),
          );
        }),
      );
    }

    function getTaskDirFrom(configPath: string, config: TatrConfig) {
      return pipe(
        Effect.succeed(path.resolve(path.dirname(configPath), config.taskDir)),
        Effect.tap((dirPath) =>
          Effect.when(
            Effect.fail(new ConfigError(ConfigErrorReason.TaskDirNotFound({ path: dirPath }))),
            fs.stat(dirPath).pipe(
              Effect.map((n) => n.type !== "Directory"),
              Effect.orElseSucceed(() => true),
            ),
          ),
        ),
      );
    }

    const findConfigPath = yield* Effect.cached(findConfigPathFrom());
    const getConfig = yield* Effect.cached(Effect.flatMap(findConfigPath, readConfigFrom));
    const getTaskDir = yield* pipe(
      Effect.all([findConfigPath, getConfig]),
      Effect.flatMap(([configPath, config]) => getTaskDirFrom(configPath, config)),
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

    function getTaskDirFromRootUri(rootUri: string) {
      return Effect.Do.pipe(
        Effect.bind("configPath", () => findConfigPathFrom(rootUri)),
        Effect.bind("config", ({ configPath }) => readConfigFrom(configPath)),
        Effect.flatMap(({ configPath, config }) => getTaskDirFrom(configPath, config)),
      );
    }

    function taskFilePathIn(dir: string, id: string) {
      return path.format({ dir, name: id, ext: TASK_EXT });
    }

    function getTaskFilePath(id: string) {
      return Effect.map(getTaskDir, (dir) => taskFilePathIn(dir, id));
    }

    function getTaskFilePathFromRootUri(rootUri: string, id: string) {
      return Effect.map(getTaskDirFromRootUri(rootUri), (dir) => taskFilePathIn(dir, id));
    }

    function taskIdOf(file: string) {
      return path.basename(file, TASK_EXT);
    }

    function taskIdOfFileIn(taskDir: string, file: string): Option.Option<string> {
      if (path.dirname(file) === taskDir && path.extname(file) === TASK_EXT) {
        return Option.some(taskIdOf(file));
      }
      return Option.none();
    }

    function getRootDirFromRootUri(rootUri: string) {
      return Effect.map(findConfigPathFrom(rootUri), path.dirname);
    }

    const globPattern = `*${TASK_EXT}`;

    return {
      getRootDirFromRootUri,
      getTaskDirFromRootUri,
      taskFilePathIn,
      getTaskFilePath,
      getTaskFilePathFromRootUri,
      globPattern,
      taskIdOf,
      taskIdOfFileIn,
      findConfigPath,
      getTaskDir,
      getConfig,
      initConfig,
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}
