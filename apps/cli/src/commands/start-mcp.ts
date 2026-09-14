import { Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";

export const mcpStart = pipe(
  Command.make("mcp"),
  Command.withDescription("Start the MCP server for agents"),
  Command.withHandler(() =>
    Effect.flatMap(
      Effect.promise(() => import("../mcp/index.js")),
      (mcp) => mcp.run,
    ),
  ),
);
