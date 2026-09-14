import { Layer, Logger } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { AppService, ConfigService, FileUtils, Formatter, Mint } from "../services/index.js";
import { TaskHandlers, TaskToolkit } from "./tools.js";

/**
 * The protocol owns stdout, and reading a task with bad front matter logs about
 * it, so the log goes to stderr or the first unreadable task garbles the stream.
 */
const McpLayer = McpServer.toolkit(TaskToolkit).pipe(
  Layer.provide(TaskHandlers),
  Layer.provide(Layer.mergeAll(AppService.layer, Mint.layer)),
  Layer.provide(Formatter.layer),
  Layer.provide(ConfigService.layer),
  Layer.provide(FileUtils.layer),
  Layer.provide(
    McpServer.layerStdio({
      name: "tatr",
      version: __VERSION__,
      protocols: [McpProtocol.v2025_06_18],
    }),
  ),
  Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)),
);

export const run = Layer.launch(McpLayer);
