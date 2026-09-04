import {
  Array,
  Context,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Optic,
  Option,
  Path,
  pipe,
  Ref,
  Schema,
  Stream,
} from "effect";
import { constant } from "effect/Function";
import { Command } from "effect/unstable/cli";
import { Rpc, RpcGroup, RpcServer } from "effect/unstable/rpc";
import type {
  CodeActionParams,
  CompletionParams,
  DefinitionParams,
  HoverParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  TextDocumentIdentifier,
} from "vscode-languageserver-protocol";
import { TextDocument, type DocumentUri } from "vscode-languageserver-textdocument";
import { AppService } from "../services/app-service.js";
import { ConfigService } from "../services/config-service.js";
import { FileUtils } from "../services/file-utils.js";
import { Mint } from "../services/mint.js";
import { idAt, idSpanAt, markerAt } from "./marker.js";
import { layerLspRpc } from "./serialization.js";

// the client sends whole documents on open and deltas on change
const INCREMENTAL_SYNC = 2;

// payloads are handed over as they came off the wire, the types are the
// client's promise about them rather than something we check
function unsafe<A>() {
  return Schema.Unknown as unknown as Schema.Codec<A, unknown>;
}

// what the server answers `initialize` with, the one response shape that has
// to survive encoding
const InitializeResult = Schema.Struct({
  capabilities: Schema.Struct({
    textDocumentSync: Schema.Struct({
      openClose: Schema.Boolean,
      change: Schema.Int,
    }),
    definitionProvider: Schema.Boolean,
    hoverProvider: Schema.Boolean,
    codeActionProvider: Schema.Boolean,
    completionProvider: Schema.Struct({
      triggerCharacters: Schema.Array(Schema.String),
    }),
  }),
  serverInfo: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
  }),
});

const Position = Schema.Struct({
  line: Schema.Int,
  character: Schema.Int,
});

const PositionRange = Schema.Struct({
  start: Position,
  end: Position,
});

const Location = Schema.Struct({
  uri: Schema.URLFromString,
  range: PositionRange,
});

const TASK_START = PositionRange.make({
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
});

const Hover = Schema.Struct({
  contents: Schema.Struct({
    kind: Schema.Literal("markdown"),
    value: Schema.String,
  }),
});

const TextEdit = Schema.Struct({
  range: PositionRange,
  newText: Schema.String,
});

// 18 is `Reference`, the kind clients render for a pointer to something else
const REFERENCE_ITEM = 18;

const EMPTY_COMPLETION = { isIncomplete: false, items: [] };

const CompletionList = Schema.Struct({
  isIncomplete: Schema.Boolean,
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      kind: Schema.Int,
      detail: Schema.String,
      textEdit: TextEdit,
    }),
  ),
});

// the client does the writing: it fills in the task and rewrites the marker as
// one undoable step. Deliberately no `create`, which would put an empty file on
// disk behind the editor's back, leaving the buffer unsavable without a bang
const CodeAction = Schema.Struct({
  title: Schema.String,
  kind: Schema.Literal("quickfix"),
  edit: Schema.Struct({
    documentChanges: Schema.Array(
      Schema.Struct({
        textDocument: Schema.Struct({
          uri: Schema.URLFromString,
          version: Schema.NullOr(Schema.Int),
        }),
        edits: Schema.Array(TextEdit),
      }),
    ),
  }),
});

class TatrLSP extends Context.Service<TatrLSP>()("@tatr/cli/lsp", {
  make: Effect.gen(function* () {
    const config = yield* ConfigService;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const app = yield* AppService;
    const mint = yield* Mint;

    const state = yield* Ref.make<Record<DocumentUri, TextDocument>>({});

    // tasks handed out by a code action live in the client's buffer until it
    // saves, so the file on disk has nothing to parse yet
    const created = yield* Ref.make<Record<string, URL>>({});

    const _created = Optic.id<Record<string, URL>>();

    function rememberTask(id: string, uri: URL) {
      return Ref.update(created, _created.optionalKey(id).modify(constant(uri)));
    }

    function getRememberedTask(id: string) {
      return Effect.map(Ref.get(created), (tasks) => _created.optionalKey(id).get(tasks));
    }

    function forgetTask(id: string) {
      return Ref.update(created, _created.optionalKey(id).modify(constant(undefined)));
    }

    const _document = Optic.id<Record<DocumentUri, TextDocument>>();

    function updateDocument(
      id: DocumentUri,
      fn: (c: TextDocument | undefined) => TextDocument | undefined,
    ) {
      return Ref.update(state, _document.optionalKey(id).modify(fn));
    }

    function getDocument(id: DocumentUri) {
      return Effect.map(Ref.get(state), (s) => _document.optionalKey(id).get(s));
    }

    function setDocument(id: DocumentUri, doc: TextDocument) {
      return Ref.update(
        state,
        _document.optionalKey(id).modify(() => doc),
      );
    }

    function removeDocument(id: DocumentUri) {
      return Ref.update(state, _document.optionalKey(id).modify(constant(undefined)));
    }

    const LspGroup = RpcGroup.make(
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
        payload: unsafe<DidOpenTextDocumentParams>(),
        success: Schema.Void,
      }),
      Rpc.make("textDocument/didChange", {
        payload: unsafe<DidChangeTextDocumentParams>(),
        success: Schema.Void,
      }),
      Rpc.make("textDocument/didClose", {
        payload: unsafe<DidCloseTextDocumentParams>(),
        success: Schema.Void,
      }),
      Rpc.make("textDocument/definition", {
        payload: unsafe<DefinitionParams>(),
        success: Schema.NullOr(Location),
      }),
      Rpc.make("textDocument/hover", {
        payload: unsafe<HoverParams>(),
        success: Schema.NullOr(Hover),
      }),
      Rpc.make("textDocument/codeAction", {
        payload: unsafe<CodeActionParams>(),
        success: Schema.Array(CodeAction),
      }),
      Rpc.make("textDocument/completion", {
        payload: unsafe<CompletionParams>(),
        success: CompletionList,
      }),
      Rpc.make("ping", {
        payload: Schema.Unknown,
        success: Schema.String,
      }),
    );

    function getIdAtPosition(
      textDocument: TextDocumentIdentifier,
      position: { line: number; character: number },
    ) {
      return Effect.map(getDocument(textDocument.uri), (doc) => {
        if (!doc) {
          return undefined;
        }

        return idAt(
          doc.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line + 1, character: 0 },
          }),
          position.character,
        );
      });
    }

    function getTaskInDocument(textDocument: TextDocumentIdentifier, id: string) {
      return pipe(
        path.fromFileUrl(new URL(textDocument.uri)),
        Effect.flatMap((fileUrl) => config.getTaskDirFromRootUri(path.dirname(fileUrl))),
        Effect.flatMap((taskDir) => app.readTask(path.resolve(taskDir, `${id}.md`))),
      );
    }

    /**
     * The tasks of a dir, read from the client's copy wherever it holds one:
     * a task open for editing is fresher than its file, and one a code action
     * just made may not be written yet.
     */
    function listTasksIn(taskDir: string) {
      return pipe(
        app.listFilesIn(taskDir),
        Stream.mapEffect((file) =>
          Effect.flatMap(path.toFileUrl(file), (uri) =>
            Effect.map(getDocument(uri.href), (doc) => ({ file, doc })),
          ),
        ),
        Stream.filterMapEffect(({ file, doc }) =>
          Effect.result(doc ? app.parseTask(file, doc.getText()) : app.readTask(file)),
        ),
      );
    }

    /**
     * A remembered task is a bridge until the client writes the file, so the
     * first lookup that reads it off disk drops the note.
     */
    function getTaskUri(textDocument: TextDocumentIdentifier, id: string) {
      return pipe(
        getTaskInDocument(textDocument, id),
        Effect.tap(() => forgetTask(id)),
        Effect.flatMap((task) => path.toFileUrl(task.file)),
        Effect.catch((err) =>
          Effect.flatMap(getRememberedTask(id), (remembered) =>
            remembered ? Effect.succeed(remembered) : Effect.fail(err),
          ),
        ),
      );
    }

    const handlers = LspGroup.toLayer({
      initialize: () => {
        return Effect.succeed({
          capabilities: {
            textDocumentSync: { openClose: true, change: INCREMENTAL_SYNC },
            definitionProvider: true,
            hoverProvider: true,
            codeActionProvider: true,
            completionProvider: { triggerCharacters: ["[", "("] },
          },
          serverInfo: { name: "tatr", version: __VERSION__ },
        });
      },
      initialized: () => Effect.void,
      shutdown: () => Effect.succeed(null),
      // the client only sends this once it has our shutdown reply, and the
      // spec wants the process gone, not unwound
      exit: () => Effect.sync(() => process.exit(0)),
      "textDocument/didOpen": ({ textDocument }) => {
        return setDocument(
          textDocument.uri,
          TextDocument.create(
            textDocument.uri,
            textDocument.languageId,
            textDocument.version,
            textDocument.text,
          ),
        );
      },
      "textDocument/didChange": ({ textDocument, contentChanges }) => {
        return updateDocument(
          textDocument.uri,
          (doc) => doc && TextDocument.update(doc, contentChanges, textDocument.version),
        );
      },
      "textDocument/didClose": ({ textDocument }) => {
        return removeDocument(textDocument.uri);
      },
      "textDocument/definition": Effect.fnUntraced(
        function* ({ textDocument, position }) {
          const id = yield* getIdAtPosition(textDocument, position);
          if (!id) {
            return null;
          }

          return {
            uri: yield* getTaskUri(textDocument, id),
            range: TASK_START,
          };
        },
        Effect.catch((err) => {
          switch (err._tag) {
            case "ConfigError":
            case "BadArgument":
              return Effect.as(Effect.logDebug(err.message), null);
            default: {
              return Effect.succeed(null);
            }
          }
        }),
      ),
      "textDocument/hover": Effect.fnUntraced(
        function* ({ textDocument, position }) {
          const id = yield* getIdAtPosition(textDocument, position);
          if (!id) {
            return null;
          }

          const uri = yield* getTaskUri(textDocument, id);

          // The client may be holding a task it has not written yet, in which
          // case its copy is the only one there is
          const opened = yield* getDocument(uri.href);
          const value =
            opened != null
              ? opened.getText()
              : yield* Effect.flatMap(path.fromFileUrl(uri), (filepath) =>
                  fs.readFileString(filepath),
                );

          // A task file is `markdown` already, front matter and all
          return Hover.make({
            contents: {
              kind: "markdown",
              value,
            },
          });
        },
        Effect.catch((err) => {
          switch (err._tag) {
            case "ConfigError":
            case "BadArgument":
              return Effect.as(Effect.logDebug(err.message), null);
            default: {
              return Effect.succeed(null);
            }
          }
        }),
      ),
      "textDocument/codeAction": Effect.fnUntraced(
        function* ({ textDocument, range }) {
          const doc = yield* getDocument(textDocument.uri);
          if (!doc) {
            return [];
          }

          const line = doc.getText({
            start: { line: range.start.line, character: 0 },
            end: { line: range.start.line + 1, character: 0 },
          });

          const marker = markerAt(line);
          if (!marker) {
            return [];
          }

          // minted here so the edit can name the file it creates, which costs
          // an id when the action is offered but never taken
          const id = yield* mint.nextId;
          const taskDir = yield* Effect.flatMap(
            path.fromFileUrl(new URL(textDocument.uri)),
            (file) => config.getTaskDirFromRootUri(path.dirname(file)),
          );
          const taskUri = yield* path.toFileUrl(path.resolve(taskDir, `${id}.md`));

          yield* rememberTask(id, taskUri);

          return [
            CodeAction.make({
              title: `Create tatr task for ${marker.word}`,
              kind: "quickfix",
              edit: {
                documentChanges: [
                  {
                    textDocument: { uri: taskUri, version: null },
                    edits: [
                      {
                        range: TASK_START,
                        newText: app.formatTask({
                          title: marker.title.length > 0 ? marker.title : id,
                          tags: Option.liftPredicate(marker.tags, Array.isReadonlyArrayNonEmpty),
                          priority: Option.none(),
                          body: Option.none(),
                        }),
                      },
                    ],
                  },
                  {
                    textDocument: { uri: new URL(textDocument.uri), version: doc.version },
                    edits: [
                      {
                        range: {
                          start: { line: range.start.line, character: marker.from },
                          end: { line: range.start.line, character: marker.to },
                        },
                        newText: `${marker.word}(${id}):`,
                      },
                    ],
                  },
                ],
              },
            }),
          ];
        },
        Effect.catch((err) => {
          switch (err._tag) {
            case "ConfigError":
            case "BadArgument":
              return Effect.as(Effect.logDebug(err.message), []);
            default: {
              return Effect.succeed([]);
            }
          }
        }),
      ),
      "textDocument/completion": Effect.fnUntraced(
        function* ({ textDocument, position }) {
          const doc = yield* getDocument(textDocument.uri);
          if (!doc) {
            return EMPTY_COMPLETION;
          }

          const line = doc.getText({
            start: { line: position.line, character: 0 },
            end: { line: position.line + 1, character: 0 },
          });

          const span = idSpanAt(line, position.character);
          if (!span) {
            return EMPTY_COMPLETION;
          }

          const taskDir = yield* Effect.flatMap(
            path.fromFileUrl(new URL(textDocument.uri)),
            (file) => config.getTaskDirFromRootUri(path.dirname(file)),
          );

          const range = {
            start: { line: position.line, character: span.from },
            end: { line: position.line, character: span.to },
          };

          const items = yield* pipe(
            listTasksIn(taskDir),
            Stream.filter((task) => !task.info.closed),
            // the id is what gets written, the title is what gets read, so
            // clients filter on the title
            Stream.map((task) => ({
              label: task.info.title,
              kind: REFERENCE_ITEM,
              detail: task.id,
              textEdit: { range, newText: task.id },
            })),
            Stream.runCollect,
          );

          return CompletionList.make({ isIncomplete: false, items });
        },
        Effect.catch((err) => {
          switch (err._tag) {
            case "ConfigError":
            case "BadArgument":
              return Effect.as(Effect.logDebug(err.message), EMPTY_COMPLETION);
            default: {
              return Effect.succeed(EMPTY_COMPLETION);
            }
          }
        }),
      ),
      ping: () => Effect.succeed("pong"),
    });

    return {
      start: Layer.launch(Layer.provide(RpcServer.layer(LspGroup), handlers)),
    };
  }),
}) {
  static layer = Layer.effect(this, this.make);
}

const LspLayer = TatrLSP.layer.pipe(
  Layer.provide(Mint.layer),
  Layer.provide(AppService.layer),
  Layer.provide(ConfigService.layer),
  Layer.provide(FileUtils.layer),
  Layer.provideMerge(RpcServer.layerProtocolStdio),
  Layer.provideMerge(layerLspRpc),
  Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)),
);

export const lspStart = pipe(
  Command.make("lsp"),
  Command.withDescription("Start the simple LSP server"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const lsp = yield* TatrLSP;
      yield* lsp.start;
    }),
  ),
  Command.provide(LspLayer),
);
