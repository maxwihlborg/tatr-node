import { Effect, pipe } from "effect";
import { Command } from "effect/unstable/cli";

export const lspStart = pipe(
  Command.make("lsp"),
  Command.withDescription("Start the simple LSP server"),
  Command.withHandler(() =>
    Effect.flatMap(
      Effect.promise(() => import("../lsp/index.js")),
      (lsp) => lsp.run,
    ),
  ),
);
