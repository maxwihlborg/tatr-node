import {
  Array,
  Context,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Optic,
  Option,
  Order,
  Path,
  pipe,
  Ref,
  Stream,
} from "effect";
import { constant } from "effect/Function";
import { Command } from "effect/unstable/cli";
import { RpcServer } from "effect/unstable/rpc";
import { TextDocumentIdentifier } from "vscode-languageserver-protocol";
import { TextDocument, type DocumentUri } from "vscode-languageserver-textdocument";
import { AppService } from "../services/app-service.js";
import { ConfigService } from "../services/config-service.js";
import { byLocation, FileUtils } from "../services/file-utils.js";
import { Mint } from "../services/mint.js";
import { EMPTY_COMPLETION, INCREMENTAL_SYNC, REFERENCE_ITEM, TASK_START } from "./constants.js";
import { idAt, idSpanAt, markerAt } from "./marker.js";
import { LanguageServerRpcGroup } from "./rpc.js";
import {
  CodeAction,
  CompletionItem,
  CompletionList,
  Hover,
  Position,
  PositionRange,
} from "./schema.js";
import { layerLspRpcSerialization } from "./serialization.js";
import { runCollectSorted } from "../lib/functions.js";

class TatrLanguageServer extends Context.Service<TatrLanguageServer>()(
  "@tatr/cli/TatrLanguageServer",
  {
    make: Effect.gen(function* () {
      const app = yield* AppService;
      const config = yield* ConfigService;
      const fs = yield* FileSystem.FileSystem;
      const fu = yield* FileUtils;
      const mint = yield* Mint;
      const path = yield* Path.Path;

      /** A task a code action made, kept whole rather than as a pointer: until
       * the client writes it, this note is the only copy there is. */
      interface CreatedTask {
        readonly uri: URL;
        readonly text: string;
      }

      const createdRef = yield* Ref.make<Record<string, CreatedTask>>({});
      const docsRef = yield* Ref.make<Record<DocumentUri, TextDocument>>({});

      const _created = Optic.id<Record<string, CreatedTask>>();
      const _document = Optic.id<Record<DocumentUri, TextDocument>>();

      function rememberTask(id: string, task: CreatedTask) {
        return Ref.update(createdRef, _created.optionalKey(id).modify(constant(task)));
      }

      function getRememberedTask(id: string) {
        return Effect.map(Ref.get(createdRef), (c) =>
          Option.fromUndefinedOr(_created.optionalKey(id).get(c)),
        );
      }

      function forgetTask(id: string) {
        return Ref.update(createdRef, _created.optionalKey(id).modify(constant(undefined)));
      }

      function updateDocument(id: DocumentUri, fn: (doc: TextDocument) => TextDocument) {
        return Ref.update(
          docsRef,
          _document.optionalKey(id).modify((doc) => doc && fn(doc)),
        );
      }

      function getDocument(id: DocumentUri) {
        return Effect.map(Ref.get(docsRef), (d) =>
          Option.fromUndefinedOr(_document.optionalKey(id).get(d)),
        );
      }

      function setDocument(id: DocumentUri, doc: TextDocument) {
        return Ref.update(
          docsRef,
          _document.optionalKey(id).modify(() => doc),
        );
      }

      function removeDocument(id: DocumentUri) {
        return Ref.update(docsRef, _document.optionalKey(id).modify(constant(undefined)));
      }

      function getIdAtPosition(textDocument: TextDocumentIdentifier, position: Position) {
        return getDocument(textDocument.uri).pipe(
          Effect.map(
            Option.flatMap((doc) =>
              idAt(
                doc.getText({
                  start: { line: position.line, character: 0 },
                  end: { line: position.line + 1, character: 0 },
                }),
                position.character,
              ),
            ),
          ),
        );
      }

      function getTaskInDocument(textDocument: TextDocumentIdentifier, id: string) {
        return path.fromFileUrl(new URL(textDocument.uri)).pipe(
          Effect.flatMap((fileUrl) => config.getTaskFilePathFromRootUri(path.dirname(fileUrl), id)),
          Effect.flatMap(app.readTask),
        );
      }

      function listPendingIn(taskDir: string, onDisk: ReadonlySet<string>) {
        return Effect.gen(function* () {
          const pending = new Map<string, string>();

          function claim(file: Option.Option<string>, text: () => string) {
            if (Option.isNone(file) || onDisk.has(file.value) || pending.has(file.value)) {
              return;
            }
            if (Option.isNone(config.taskIdOfFileIn(taskDir, file.value))) {
              return;
            }
            pending.set(file.value, text());
          }

          // Open first: where the client has both, its buffer is the fresher
          // of the two, and the note is what that buffer started as
          const docs = yield* Ref.get(docsRef);

          for (const [uri, doc] of Object.entries(docs)) {
            claim(yield* Effect.option(path.fromFileUrl(new URL(uri))), () => doc.getText());
          }

          const created = yield* Ref.get(createdRef);

          for (const task of Object.values(created)) {
            claim(yield* Effect.option(path.fromFileUrl(task.uri)), () => task.text);
          }

          return pending;
        });
      }

      /**
       * The tasks of a directory, read from the client's copy wherever it holds one:
       * a task open for editing is fresher than its file, and one a code action
       * just made may not be written yet.
       */
      function listTasksIn(taskDir: string) {
        return Stream.unwrap(
          Effect.gen(function* () {
            const files = yield* Stream.runCollect(app.listFilesIn(taskDir));
            const pending = yield* listPendingIn(taskDir, new Set(files));

            return Stream.concat(
              Stream.fromIterable(files).pipe(
                Stream.filterMapEffect((file) =>
                  path.toFileUrl(file).pipe(
                    Effect.flatMap((uri) => getDocument(uri.href)),
                    Effect.flatMap(
                      Option.match({
                        onSome: (doc) => app.parseTask(file, doc.getText()),
                        onNone: () => app.readTask(file),
                      }),
                    ),
                    Effect.result,
                  ),
                ),
              ),
              Stream.fromIterable(pending).pipe(
                Stream.filterMapEffect(([file, text]) => Effect.result(app.parseTask(file, text))),
              ),
            );
          }),
        );
      }

      /**
       * A remembered task is a bridge until the client writes the file, so the
       * first lookup that reads it off disk drops the note.
       */
      function getTaskUri(textDocument: TextDocumentIdentifier, id: string) {
        return getTaskInDocument(textDocument, id).pipe(
          Effect.tap(() => forgetTask(id)),
          Effect.flatMap((task) => path.toFileUrl(task.file)),
          Effect.catch((err) =>
            Effect.flatMap(
              getRememberedTask(id),
              Option.match({
                onSome: (pending) => Effect.succeed(pending.uri),
                onNone: () => Effect.fail(err),
              }),
            ),
          ),
        );
      }

      const handlers = LanguageServerRpcGroup.toLayer({
        ["ping"]: () => {
          return Effect.succeed("pong");
        },
        ["initialize"]: () => {
          return Effect.succeed({
            capabilities: {
              textDocumentSync: { openClose: true, change: INCREMENTAL_SYNC },
              definitionProvider: true,
              hoverProvider: true,
              referencesProvider: true,
              codeActionProvider: true,
              completionProvider: { triggerCharacters: ["[", "("] },
            },
            serverInfo: { name: "tatr", version: __VERSION__ },
          });
        },
        ["initialized"]: () => {
          return Effect.void;
        },
        ["shutdown"]: () => {
          return Effect.succeed(null);
        },
        /**
         * The client only sends this once it has our shut down reply, and the
         * spec wants the process gone, not unwound
         */
        ["exit"]: () => {
          return Effect.sync(() => process.exit(0));
        },
        ["textDocument/didOpen"]: ({ textDocument }) => {
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
        ["textDocument/didChange"]: ({ textDocument, contentChanges }) => {
          return updateDocument(textDocument.uri, (doc) =>
            TextDocument.update(doc, contentChanges, textDocument.version),
          );
        },
        ["textDocument/didClose"]: ({ textDocument }) => {
          return removeDocument(textDocument.uri);
        },
        ["textDocument/definition"]: Effect.fnUntraced(
          function* ({ textDocument, position }) {
            const id = yield* getIdAtPosition(textDocument, position);
            if (Option.isNone(id)) {
              return null;
            }

            return {
              uri: yield* getTaskUri(textDocument, id.value),
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
        ["textDocument/references"]: Effect.fnUntraced(
          function* ({ textDocument, position, context }) {
            const file = yield* path.fromFileUrl(new URL(textDocument.uri));
            const from = path.dirname(file);

            let id = yield* getIdAtPosition(textDocument, position);

            // Off an id inside a task file, the task the file *is* stands in
            // for the one under the cursor: asking for references anywhere in
            // a task is asking who points at that task
            if (Option.isNone(id)) {
              const taskDir = yield* config.getTaskDirFromRootUri(from);

              id = config.taskIdOfFileIn(taskDir, file);
            }

            if (Option.isNone(id)) {
              return [];
            }

            const root = yield* config.getRootDirFromRootUri(from);

            const references = yield* fu.grep(id.value, root).pipe(
              // The id is a plain word, so a hit is only a reference where it
              // is written as one, which is the same call `definition` makes
              Stream.filter((match) =>
                Option.contains(idAt(match.text, match.character), id.value),
              ),
              runCollectSorted(byLocation),
              Effect.flatMap(
                Effect.forEach((match) =>
                  Effect.map(path.toFileUrl(match.file), (uri) => ({
                    uri,
                    range: {
                      start: { line: match.line, character: match.character },
                      end: { line: match.line, character: match.character + match.length },
                    },
                  })),
                ),
              ),
            );

            if (!context.includeDeclaration) {
              return references;
            }

            // No search finds the declaration: a task's id is in the name of
            // its file, not in anything the file holds. Asking the same way
            // `definition` does covers the task the client has not written yet
            const declaration = yield* Effect.option(getTaskUri(textDocument, id.value));

            if (Option.isNone(declaration)) {
              return references;
            }

            return [{ uri: declaration.value, range: TASK_START }, ...references];
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
        ["textDocument/hover"]: Effect.fnUntraced(
          function* ({ textDocument, position }) {
            const id = yield* getIdAtPosition(textDocument, position);
            if (Option.isNone(id)) {
              return null;
            }

            const uri = yield* getTaskUri(textDocument, id.value);

            // The client may be holding a task it has not written yet, in which
            // case its copy is the only one there is
            const value = yield* getDocument(uri.href).pipe(
              Effect.flatMap(
                Option.match({
                  onSome: (doc) => Effect.succeed(doc.getText()),
                  onNone: () => Effect.flatMap(path.fromFileUrl(uri), fs.readFileString),
                }),
              ),
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
        ["textDocument/codeAction"]: Effect.fnUntraced(
          function* ({ textDocument, range }) {
            const doc = yield* getDocument(textDocument.uri);
            if (Option.isNone(doc)) {
              return [];
            }

            const line = doc.value.getText({
              start: { line: range.start.line, character: 0 },
              end: { line: range.start.line + 1, character: 0 },
            });

            const marker = markerAt(line);
            if (Option.isNone(marker)) {
              return [];
            }

            const id = yield* mint.nextId;
            const taskFile = yield* Effect.flatMap(
              path.fromFileUrl(new URL(textDocument.uri)),
              (file) => config.getTaskFilePathFromRootUri(path.dirname(file), id),
            );
            const taskUri = yield* path.toFileUrl(taskFile);

            const text = app.formatTask({
              title: marker.value.title.length > 0 ? marker.value.title : id,
              tags: Option.liftPredicate(marker.value.tags, Array.isReadonlyArrayNonEmpty),
              priority: Option.none(),
              body: Option.none(),
            });

            yield* rememberTask(id, { uri: taskUri, text });

            return [
              CodeAction.make({
                title: `Create tatr task for ${marker.value.word}`,
                kind: "quickfix",
                edit: {
                  documentChanges: [
                    {
                      textDocument: { uri: taskUri, version: null },
                      edits: [
                        {
                          range: TASK_START,
                          newText: text,
                        },
                      ],
                    },
                    {
                      textDocument: {
                        uri: new URL(textDocument.uri),
                        version: doc.value.version,
                      },
                      edits: [
                        {
                          range: {
                            start: { line: range.start.line, character: marker.value.from },
                            end: { line: range.start.line, character: marker.value.to },
                          },
                          newText: `${marker.value.word}(${id}):`,
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
        ["textDocument/completion"]: Effect.fnUntraced(
          function* ({ textDocument, position }) {
            const doc = yield* getDocument(textDocument.uri);
            if (Option.isNone(doc)) {
              return EMPTY_COMPLETION;
            }

            const line = doc.value.getText({
              start: { line: position.line, character: 0 },
              end: { line: position.line + 1, character: 0 },
            });

            const span = idSpanAt(line, position.character);
            if (Option.isNone(span)) {
              return EMPTY_COMPLETION;
            }

            const taskDir = yield* Effect.flatMap(
              path.fromFileUrl(new URL(textDocument.uri)),
              (file) => config.getTaskDirFromRootUri(path.dirname(file)),
            );

            const range = PositionRange.make({
              start: { line: position.line, character: span.value.from },
              end: { line: position.line, character: span.value.to },
            });

            const items = yield* listTasksIn(taskDir).pipe(
              Stream.filter((task) => !task.info.closed),
              // The id is what gets written, the title is what gets read, so
              // clients filter on the title
              Stream.map((task) =>
                CompletionItem.make({
                  label: task.info.title,
                  kind: REFERENCE_ITEM,
                  detail: task.id,
                  textEdit: { range, newText: task.id },
                }),
              ),
              runCollectSorted(CompletionItem.orderByLabel),
            );

            return CompletionList.make({
              isIncomplete: false,
              items,
            });
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
      });

      return {
        start: RpcServer.layer(LanguageServerRpcGroup).pipe(
          Layer.provide(handlers), //
          Layer.launch,
        ),
      };
    }),
  },
) {
  static layer = Layer.effect(this, this.make);
}

const LspLayer = TatrLanguageServer.layer.pipe(
  Layer.provide(Mint.layer),
  Layer.provide(AppService.layer),
  Layer.provide(ConfigService.layer),
  Layer.provide(FileUtils.layer),
  Layer.provideMerge(RpcServer.layerProtocolStdio),
  Layer.provide(layerLspRpcSerialization),
  Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true)),
);

export const lspStart = pipe(
  Command.make("lsp"),
  Command.withDescription("Start the simple LSP server"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const lsp = yield* TatrLanguageServer;
      yield* lsp.start;
    }),
  ),
  Command.provide(LspLayer),
);
