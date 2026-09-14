import { Layer, Logger, pipe } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { Command } from "effect/unstable/cli";
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

export const mcpStart = pipe(
  Command.make("mcp"),
  Command.withDescription("Start the MCP server for agents"),
  Command.withHandler(() => Layer.launch(McpLayer)),
);
