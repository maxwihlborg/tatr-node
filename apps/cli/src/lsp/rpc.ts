import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import type {
  CodeActionParams,
  CompletionParams,
  DefinitionParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  HoverParams,
  ReferenceParams,
} from "vscode-languageserver-protocol";
import { CodeAction, CompletionList, Hover, InitializeResult, Location } from "./schema.js";

/**
 * Payloads are handed over as they came off the wire, the types are the
 * client's promise about them rather than something we check
 */
export function Unchecked<A>() {
  return Schema.Unknown as Schema.Codec<A, unknown>;
}

export const LanguageServerRpcGroup = RpcGroup.make(
  Rpc.make("ping", {
    payload: Schema.Unknown,
    success: Schema.String,
  }),
  Rpc.make("initialize", {
    payload: Schema.Unknown,
    success: InitializeResult,
  }),
  Rpc.make("initialized", {
    payload: Schema.Unknown,
    success: Schema.Void,
  }),
  Rpc.make("shutdown", {
    payload: Schema.Unknown,
    success: Schema.Null,
  }),
  Rpc.make("exit", {
    payload: Schema.Unknown,
    success: Schema.Void,
  }),
  Rpc.make("textDocument/didOpen", {
    payload: Unchecked<DidOpenTextDocumentParams>(),
    success: Schema.Void,
  }),
  Rpc.make("textDocument/didChange", {
    payload: Unchecked<DidChangeTextDocumentParams>(),
    success: Schema.Void,
  }),
  Rpc.make("textDocument/didClose", {
    payload: Unchecked<DidCloseTextDocumentParams>(),
    success: Schema.Void,
  }),
  Rpc.make("textDocument/definition", {
    payload: Unchecked<DefinitionParams>(),
    success: Schema.NullOr(Location),
  }),
  Rpc.make("textDocument/references", {
    payload: Unchecked<ReferenceParams>(),
    success: Schema.Array(Location),
  }),
  Rpc.make("textDocument/hover", {
    payload: Unchecked<HoverParams>(),
    success: Schema.NullOr(Hover),
  }),
  Rpc.make("textDocument/codeAction", {
    payload: Unchecked<CodeActionParams>(),
    success: Schema.Array(CodeAction),
  }),
  Rpc.make("textDocument/completion", {
    payload: Unchecked<CompletionParams>(),
    success: CompletionList,
  }),
);
