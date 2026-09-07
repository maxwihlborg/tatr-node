import { Layer, Logger, pipe } from "effect";
import { Command } from "effect/unstable/cli";
import { RpcServer } from "effect/unstable/rpc";
import { AppService, ConfigService, FileUtils, Mint } from "../services/index.js";
import { LanguageServerRpcGroup, LanguageServerRpcHandlers } from "./rpc.js";
import { layerLspRpcSerialization } from "./serialization.js";

const LspLayer = RpcServer.layer(LanguageServerRpcGroup).pipe(
  Layer.provide(LanguageServerRpcHandlers),
  Layer.provide(Mint.layer),
  Layer.provide(AppService.layer),
  Layer.provide(ConfigService.layer),
  Layer.provide(FileUtils.layer),
  Layer.provide(RpcServer.layerProtocolStdio),
  Layer.provide(layerLspRpcSerialization),
  Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)),
);

export const lspStart = pipe(
  Command.make("lsp"),
  Command.withDescription("Start the simple LSP server"),
  Command.withHandler(() => Layer.launch(LspLayer)),
);
